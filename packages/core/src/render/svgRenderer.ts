import type { Catalog } from "../catalog/catalog.js";
import {
  RESIZE_HANDLES,
  resizeCursor,
  type ResizeHandle,
} from "../interaction/resize.js";
import type { SnapGuide } from "../interaction/snapping.js";
import { computeTabOrder } from "../interaction/tabOrder.js";
import type { Diagnostic, Severity } from "../linter/types.js";
import { accessibleName, accessibleRole } from "../scene/accessibleName.js";
import { formatConnectorAnnotation } from "../scene/connectorAnnotation.js";
import type { Scene } from "../scene/scene.js";
import type {
  ConnectorAnnotation,
  ConnectorElement,
  ConnectorType,
  SceneElement,
} from "../scene/types.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import {
  connectorAnchorPoint,
  connectorPathPoints,
} from "../routing/routeConnector.js";
import { PRIMARY_TO_SECONDARY_FILL } from "../theme/colorPalette.js";
import {
  CONTAINER_GLYPH_INSET,
  CONTAINER_GLYPH_SIZE,
  CONTAINER_LABEL_FONT_SIZE_PX,
  CONTAINER_LABEL_GAP,
  containerLabelMaxWidth,
} from "./containerLabel.js";
import { createSvgElement, setAttrs } from "./dom.js";
import { pointAtFraction, portPoint, type Point } from "./port.js";
import { ellipsize, wrapText } from "./textMetrics.js";
import type { ViewportState } from "./viewport.js";

/** Used when the container reports a zero-size rect (e.g. detached in tests/jsdom). */
const FALLBACK_VIEWPORT_SIZE = { w: 800, h: 600 };

const ICON_CONTAINER = 48;
/**
 * Every catalog asset's glyph is normalized (packages/catalog-build/src/extract.ts's
 * GLYPH_VIEWBOX) to fill a 0..24 coordinate space — IBM's own real glyph box (confirmed against
 * upstream source, e.g. load-balancer--local.svg's `<g transform="translate(12, 12)">` wrapping a
 * 24x24 glyph), not the 0..20 space ICAD previously assumed (D25, docs/00-decision-log.md). Both
 * glyph use-sites below must declare this same viewBox so the shared asset isn't misframed —
 * their on-screen *display* size (width/height) is independent and differs per use-site.
 */
const GLYPH_VIEWBOX_SIZE = 24;

/** IBM's own icon glyph renders at 24x24, inset 12px within the 48x48 tile — 1:1 with GLYPH_VIEWBOX_SIZE. */
const NODE_GLYPH_SIZE = 24;
const NODE_GLYPH_INSET = (ICON_CONTAINER - NODE_GLYPH_SIZE) / 2;

/**
 * Every container (Box/Group/Zone) carries a short colored accent bar flush on the left edge,
 * next to the icon/label — confirmed in not_released_in_drawio.xml's own Group stencil defs (a
 * 4-wide rect drawn before the icon, filled the same color as the container's own stroke) and
 * visually in images/DeployedTo.png / the IKS/ROKS reference renders (D24), and directly in the
 * kit's own worked example (Public Network, IBM Cloud, Region, OpenShift, Zone all carry one —
 * canvas-parity-plan.md's C7). The stencil's own geometry (4x48 within a 220x140
 * library-thumbnail tile) is a preview-tile constant, not proportional to a real container's
 * height, so this is a fixed height clamped to short containers. Frame is the one container type
 * that deliberately has no tab — it's an ICAD-only presentation affordance with no IBM semantic.
 */
const SIDEBAR_TAB_WIDTH = 4;
const SIDEBAR_TAB_HEIGHT = 32;

/** Background grid (M17.2). Fixed global id, same precedent as `MARKER_DEFS`' own ids — every
 * `SvgRenderer` instance defines identical markup for it, so accidental duplicate ids across
 * multiple live instances in one document (already true of markers, e.g. in tests) resolve to the
 * same visual result regardless of which instance's `<defs>` the browser matches first. */
const GRID_PATTERN_ID = "icad-grid-pattern";

/**
 * Single-line ellipsis width caps (px) for connector-adjacent text — label, protocol annotation,
 * cardinality, and sequence badge all float freely along a connector's path rather than being
 * bound to a parent container's geometry the way containerLabelText/labelText are, so there's no
 * natural "available width" to derive from layout. Picked generously (each comfortably fits IBM's
 * own worked-example strings, e.g. "HTTPS TLS1.3:443") so truncation stays a rare last resort
 * rather than a routine occurrence; the sequence badge's is deliberately tight since it's meant to
 * hold a short index like "2a", not prose.
 */
const CONNECTOR_LABEL_MAX_WIDTH = 200;
const CONNECTOR_ANNOTATION_MAX_WIDTH = 220;
const CARDINALITY_LABEL_MAX_WIDTH = 60;
const SEQUENCE_BADGE_MAX_WIDTH = 16;

/** Used when an icon/actor label has no parent to derive available width from (e.g. detached in
 * tests, or a top-level element) — generous enough that wrapping stays rare in that fallback case. */
const FALLBACK_LABEL_MAX_WIDTH = 200;
/** Vertical spacing between stacked label lines, ~1.1x DEFAULT_FONT_SIZE_PX (textMetrics.ts) —
 * enough to keep ascenders/descenders of adjacent lines from touching at the unset root font-size
 * labelText inherits (~16-18px). */
const LABEL_LINE_HEIGHT_PX = 18;
/** Side length of the single tiled grid rect, scene units — large enough that no realistic pan
 * ever scrolls past its edge (docs/09-roadmap.md#m12--performance-at-scale's benchmark tops out at
 * 2,000 elements, nowhere near this span) without needing to track/resize it against the live
 * viewport. */
const GRID_EXTENT = 1_000_000;

export type ResolvedTheme = "light" | "dark";

interface Palette {
  stroke: string;
  zone: string;
  frame: string;
  /** Faint background grid stroke (M17.2, docs/10-canvas-parity-plan.md) — deliberately not one
   * of the 9 IBM category colors; it's chrome, not diagram content. */
  grid: string;
}

const PALETTES: Record<ResolvedTheme, Palette> = {
  light: {
    stroke: "#161616",
    zone: "#8d8d8d",
    frame: "#a8a8a8",
    grid: "#e0e0e0",
  },
  dark: {
    stroke: "#f4f4f4",
    zone: "#a8a8a8",
    frame: "#6f6f6f",
    grid: "#333333",
  },
};

/**
 * Independent of connectorType (docs/05-ibm-spec-conformance.md#connector-nomenclature).
 * Public's `#4376BB` is a distinct "link blue" from IBM's own Connectors.drawio reference —
 * not one of the 9 category colors (which is why it doesn't match Blue 60 `#0f62fe`).
 */
const FLOW_COLORS = { private: "#198038", public: "#4376BB" } as const;

/**
 * Tunnel-band colors (D-level fidelity fix): `single` is `Connectors.drawio`'s own literal
 * `fillColor=#FFD7D9` (confirmed directly against the vector source — not derived from the
 * connector's own stroke color, unlike ICAD's previous opacity-based approximation). The
 * double-tunnel variant's second/outer band has no literal fillColor anywhere in
 * `Connectors.drawio` — it renders via a proprietary `mxgraph.ibm2mondrian` shape not resolvable
 * from the stencil's plain style strings — so `double` uses Carbon's own Yellow 30 (`#f1c21b`) as
 * a reasoned, real-IBM-palette placeholder pending direct IBM Design confirmation, the same
 * posture D21 takes for other unconfirmed specifics.
 */
const TUNNEL_BAND_COLORS = { single: "#FFD7D9", double: "#f1c21b" } as const;

type MarkerId =
  | "icad-dot"
  | "icad-arrow"
  | "icad-arrow-open"
  | "icad-arrow-hollow"
  | "icad-diamond-open"
  | "icad-diamond-filled"
  | "icad-box";
type MarkerKind =
  | "none"
  | "dot"
  | "arrow"
  | "arrow-open"
  | "arrow-hollow"
  | "diamond-open"
  | "diamond-filled"
  | "box";

const MARKER_IDS: Record<Exclude<MarkerKind, "none">, MarkerId> = {
  dot: "icad-dot",
  arrow: "icad-arrow",
  "arrow-open": "icad-arrow-open",
  "arrow-hollow": "icad-arrow-hollow",
  "diamond-open": "icad-diamond-open",
  "diamond-filled": "icad-diamond-filled",
  box: "icad-box",
};

interface ConnectorStyleSpec {
  /** stroke-dasharray value; solid when omitted. */
  dash?: string;
  /** Renders a translucent highlighted band behind the line (1 = single, 2 = double). */
  band?: 1 | 2;
  /** Renders a second parallel line alongside the main one. */
  doubleLine?: boolean;
  endMarker: MarkerKind;
  startMarker?: MarkerKind;
}

/** Connection types carry a bidirectional/unidirectional variant; relationships don't. */
const CONNECTION_TYPES = new Set<ConnectorType>([
  "logical-connection",
  "connection",
  "physical-connection",
  "tunneling-connection",
  "traffic-through-double-tunnel",
]);

/**
 * Line style + arrowheads per docs/05-ibm-spec-conformance.md#connector-nomenclature, confirmed
 * against `Connectors.drawio`'s own style strings. Relationships (dependency/association/
 * aggregation/composition) use the open-V `endArrow=open` marker there, distinct from
 * implementation/extends's hollow *closed* triangle (`endArrow=block;endFill=0`) — the two are
 * visually different arrowheads in IBM's own reference, not the same marker reused.
 * "tunneling-connection" renders what `Connectors.drawio` actually labels "Traffic Through
 * Tunnel/Encapsulation" — "Tunneling Connection" itself is a caption cell with no edge behind it,
 * not a distinct line style (see InspectorPanel's CONNECTOR_TYPE_LABELS for the display-name fix).
 */
const CONNECTOR_STYLE: Record<ConnectorType, ConnectorStyleSpec> = {
  "logical-connection": { dash: "4 3", endMarker: "arrow" },
  connection: { endMarker: "arrow" },
  "physical-connection": {
    doubleLine: true,
    startMarker: "box",
    endMarker: "box",
  },
  "tunneling-connection": { band: 1, endMarker: "arrow" },
  "traffic-through-double-tunnel": { band: 2, endMarker: "arrow" },
  dependency: { dash: "4 3", endMarker: "arrow-open" },
  association: { endMarker: "arrow-open" },
  aggregation: { endMarker: "arrow-open", startMarker: "diamond-open" },
  composition: { endMarker: "arrow-open", startMarker: "diamond-filled" },
  implementation: { dash: "4 3", endMarker: "arrow-hollow" },
  extends: { endMarker: "arrow-hollow" },
};

/**
 * Offsets a rectilinear (axis-aligned) polyline to a parallel path, used for
 * the "physical connection" double-line style. Each segment is shifted along
 * its perpendicular normal, and consecutive orthogonal segments are mitered
 * by intersecting their offset lines exactly, giving a clean parallel
 * corner. Manual, non-axis-aligned waypoints fall back to a per-segment
 * offset without mitering, which can leave a visible seam at bends — an
 * accepted simplification since the router only ever produces orthogonal
 * segments.
 */
function offsetRectilinear(points: Point[], offset: number): Point[] {
  if (points.length < 2) return points;
  const segments = points.slice(0, -1).map((p, i) => {
    const q = points[i + 1]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * offset;
    const ny = (dx / len) * offset;
    return {
      a: { x: p.x + nx, y: p.y + ny },
      b: { x: q.x + nx, y: q.y + ny },
      horizontal: Math.abs(dy) < 0.01,
    };
  });
  const out: Point[] = [segments[0]!.a];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const next = segments[i + 1];
    if (!next) {
      out.push(seg.b);
      break;
    }
    if (seg.horizontal !== next.horizontal) {
      out.push(
        seg.horizontal
          ? { x: next.a.x, y: seg.a.y }
          : { x: seg.a.x, y: next.a.y },
      );
    } else {
      out.push(seg.b);
    }
  }
  return out;
}

function toPointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Scene-space position of a resize handle on `el`'s own bbox (M16.2). */
function resizeHandlePoint(el: Rect, handle: ResizeHandle): Point {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const x = handle.includes("w")
    ? el.x
    : handle.includes("e")
      ? el.x + el.w
      : cx;
  const y = handle.includes("n")
    ? el.y
    : handle.includes("s")
      ? el.y + el.h
      : cy;
  return { x, y };
}

/**
 * Recolors a catalog glyph fragment's white fills to `color` — used only for the container
 * corner glyph (containerCornerGlyph), which sits directly on a container's own light fill with
 * no tile behind it (unlike a full node/actor icon, D25's white-on-tile stays white). Every
 * catalog asset's glyph paths are white per extract.ts's normalizeIcon(), so a plain string
 * replace on that literal is sufficient — no SVG parsing needed for an already-normalized,
 * build-time-controlled asset.
 */
function recolorGlyph(fragment: string, color: string): string {
  return fragment.replace(/fill="(#fff(?:fff)?|white)"/gi, `fill="${color}"`);
}

const MARKER_DEFS: Array<{
  id: MarkerId;
  d: string;
  colorAttr: "fill" | "stroke";
  fixedFill?: string;
  refX?: number;
}> = [
  {
    id: "icad-dot",
    d: "M5,2 A3,3 0 1,0 5,8 A3,3 0 1,0 5,2",
    colorAttr: "fill",
    refX: 5,
  },
  { id: "icad-arrow", d: "M0,0 L10,5 L0,10 z", colorAttr: "fill" },
  // Open chevron, no closing base line — IBM's relationship arrowhead (Connectors.drawio:
  // endArrow=open), distinct from the closed hollow triangle below (endArrow=block;endFill=0).
  {
    id: "icad-arrow-open",
    d: "M1,1 L9,5 L1,9",
    colorAttr: "stroke",
    fixedFill: "none",
  },
  {
    id: "icad-arrow-hollow",
    d: "M0,0 L10,5 L0,10 z",
    colorAttr: "stroke",
    fixedFill: "none",
  },
  {
    id: "icad-diamond-open",
    d: "M0,5 L5,0 L10,5 L5,10 z",
    colorAttr: "stroke",
    fixedFill: "white",
  },
  {
    id: "icad-diamond-filled",
    d: "M0,5 L5,0 L10,5 L5,10 z",
    colorAttr: "fill",
  },
  // Hollow square end-cap for "physical connection" (Connectors.drawio: shape=link;endArrow=box;endFill=0).
  {
    id: "icad-box",
    d: "M1,1 L9,1 L9,9 L1,9 Z",
    colorAttr: "stroke",
    fixedFill: "none",
  },
];

/**
 * Renders a Scene to a live SVG DOM tree (docs/02-architecture.md#rendering-svg-dom).
 * Reconciliation is keyed by element id: existing nodes are updated in place,
 * stale nodes (removed from the scene) are dropped. Stroke/text colors follow
 * the resolved light/dark theme (docs/06-editor-ux.md#themes); icon containers
 * stay white-on-black per the IBM icon spec regardless of theme.
 */
export class SvgRenderer {
  readonly svg: SVGSVGElement;
  private layer: SVGGElement;
  private overlayLayer: SVGGElement;
  private gridPattern: SVGPatternElement;
  private gridPatternPath: SVGPathElement;
  private gridRect: SVGRectElement;
  /** Last grid spacing applied to the pattern — guards against re-setting identical attributes on
   * every render() call, mirroring lastOrderSignature's own cheap-no-op-when-unchanged shape. */
  private lastGridSize: number | undefined;
  private nodes = new Map<string, SVGElement>();
  private palette: Palette;
  private diagnostics: Diagnostic[] = [];
  private selectedIds = new Set<string>();
  private focusedId: string | undefined;
  private hoveredPortsId: string | undefined;
  private draftConnector: { from: Point; to: Point } | undefined;
  private marqueeRect: Rect | undefined;
  /** Alignment guide lines (M17.2, docs/10-canvas-parity-plan.md) — the exact `SnapGuide[]`
   * `snapMove()` already computes during drag; empty outside an in-progress drag. */
  private snapGuides: SnapGuide[] = [];
  /** Live position/dimension HUD (M17.2) shown during drag/resize — cleared (`undefined`) outside
   * a gesture. `at` is where the label anchors, scene-space. */
  private gestureReadout: { text: string; at: Point } | undefined;
  /** Ancestor-to-innermost chain of containers currently "drilled into" (M16.4,
   * docs/10-canvas-parity-plan.md) — rendered as a faint outline each, distinct from the active
   * selection's dashed one, so both are visible at once per IBM's prescribed model. Empty outside
   * a drill scope. */
  private drillPath: string[] = [];
  /** Container a live drag would reparent into if released now (M17.6,
   * docs/10-canvas-parity-plan.md) — `undefined` outside a drag or when nothing valid is hovered. */
  private dropTargetId: string | undefined;
  private currentScene?: Scene;
  /** Live resize preview geometry (M16.2, docs/10-canvas-parity-plan.md), keyed by element id —
   * checked by renderOverlays() so the selection outline/handles track the previewed bbox rather
   * than the last-committed one. Empty outside an in-progress resize gesture. */
  private previewGeometry = new Map<string, Rect>();
  /** Live rotation preview map (M20): maps element id → candidate rotation degrees. */
  private previewRotationMap = new Map<string, number>();
  /** Live waypoint preview (M19): inner waypoints being dragged, not yet committed to the scene —
   * checked by renderElement/renderOverlays so the connector path and handles update live. Cleared
   * on commit/abort. */
  private previewWaypoints = new Map<string, Array<{ x: number; y: number }>>();
  /** Guards syncDomOrder's reorder walk (C10, docs/10-canvas-parity-plan.md) — the id sequence
   * last reconciled into the DOM, so an unchanged z-order costs one string comparison, not an
   * O(n) appendChild-as-move-to-end pass on every render. */
  private lastOrderSignature = "";

  constructor(
    private container: HTMLElement,
    private catalog: Catalog,
    theme: ResolvedTheme = "light",
  ) {
    this.palette = PALETTES[theme];

    this.svg = createSvgElement("svg");
    setAttrs(this.svg, { width: "100%", height: "100%" });
    this.svg.setAttribute("data-icad-root", "true");
    // Without this, a real mouse drag starting on or crossing a label (an SVG <text> node, e.g.
    // "Application tier") triggers the browser's native text-selection highlight instead of (or
    // alongside) drag-to-move (M16.1) — CDP-dispatched synthetic pointer events don't exercise the
    // browser's selection machinery, so this was invisible to automated testing and only surfaced
    // with a real mouse. Set on the SVG root, not per-shell CSS, so both `apps/web` and
    // `apps/vscode` get it for free (D2, docs/00-decision-log.md).
    this.svg.style.setProperty("user-select", "none");
    this.svg.style.setProperty("-webkit-user-select", "none");

    const defs = createSvgElement("defs");
    for (const def of MARKER_DEFS) {
      const marker = createSvgElement("marker");
      setAttrs(marker, {
        id: def.id,
        viewBox: "0 0 10 10",
        refX: def.refX ?? 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse",
      });
      const path = createSvgElement("path");
      setAttrs(path, {
        d: def.d,
        fill:
          def.colorAttr === "fill"
            ? "context-stroke"
            : (def.fixedFill ?? "none"),
        stroke: def.colorAttr === "stroke" ? "context-stroke" : undefined,
        "stroke-width": def.colorAttr === "stroke" ? 1.2 : undefined,
      });
      marker.appendChild(path);
      defs.appendChild(marker);
    }
    // Background grid (M17.2, docs/10-canvas-parity-plan.md): an SVG <pattern>, not per-line
    // elements — patternUnits="userSpaceOnUse" tiles in the same scene-space coordinate system
    // the viewBox already maps, so it scales and pans for free with zero extra work on pan/zoom
    // and costs a constant handful of DOM nodes regardless of diagram size or zoom level.
    this.gridPatternPath = createSvgElement("path");
    setAttrs(this.gridPatternPath, {
      fill: "none",
      stroke: this.palette.grid,
      "stroke-width": 1,
    });
    this.gridPattern = createSvgElement("pattern");
    setAttrs(this.gridPattern, {
      id: GRID_PATTERN_ID,
      patternUnits: "userSpaceOnUse",
    });
    this.gridPattern.appendChild(this.gridPatternPath);
    defs.appendChild(this.gridPattern);
    this.svg.appendChild(defs);

    // A single huge tiled rect rather than sizing it to the current viewport — cheap (one DOM
    // node; the browser only ever rasterizes the visible slice of a tiled pattern fill) and never
    // needs resizing/repositioning as the viewport pans or zooms, unlike per-line grid rendering
    // would. Bottommost layer: below both elements and overlays, and never a hit-test/pointer
    // target (`elements` fill this.layer, not this rect).
    this.gridRect = createSvgElement("rect");
    setAttrs(this.gridRect, {
      x: -GRID_EXTENT / 2,
      y: -GRID_EXTENT / 2,
      width: GRID_EXTENT,
      height: GRID_EXTENT,
      fill: `url(#${GRID_PATTERN_ID})`,
    });
    this.gridRect.setAttribute("aria-hidden", "true");
    this.gridRect.setAttribute("pointer-events", "none");
    // Chrome, not diagram content (see GRID_PATTERN_ID above) — exportSvg/exportPng strip it by
    // this marker, the same way they strip the "overlays" layer.
    this.gridRect.setAttribute("data-icad-grid", "true");
    this.svg.appendChild(this.gridRect);

    this.layer = createSvgElement("g");
    this.layer.setAttribute("data-icad-layer", "elements");
    this.svg.appendChild(this.layer);

    this.overlayLayer = createSvgElement("g");
    this.overlayLayer.setAttribute("data-icad-layer", "overlays");
    this.overlayLayer.setAttribute("aria-hidden", "true");
    this.overlayLayer.setAttribute("pointer-events", "none");
    this.svg.appendChild(this.overlayLayer);

    this.container.appendChild(this.svg);
  }

  /** Updates the resolved theme; call render(scene) afterwards to repaint. Recolors the grid
   * immediately (cheap, scene-independent) rather than waiting on the caller's render(). */
  setTheme(theme: ResolvedTheme): void {
    this.palette = PALETTES[theme];
    this.gridPatternPath.setAttribute("stroke", this.palette.grid);
  }

  /** Shows or hides the background grid (M17.2, docs/10-canvas-parity-plan.md) — a view
   * preference, not part of the document, mirroring theme's own "call any time" shape. */
  setGridVisible(visible: boolean): void {
    this.gridRect.style.display = visible ? "" : "none";
  }

  /** Applies the camera (docs/06-editor-ux.md#core-interactions) as the root SVG's viewBox. */
  applyViewport(viewport: ViewportState): void {
    const rect = this.container.getBoundingClientRect();
    const w = (rect.width || FALLBACK_VIEWPORT_SIZE.w) / viewport.scale;
    const h = (rect.height || FALLBACK_VIEWPORT_SIZE.h) / viewport.scale;
    setAttrs(this.svg, { viewBox: `${viewport.x} ${viewport.y} ${w} ${h}` });
  }

  /** Current container size in CSS pixels, falling back off-DOM (e.g. tests). */
  containerSize(): { w: number; h: number } {
    const rect = this.container.getBoundingClientRect();
    return {
      w: rect.width || FALLBACK_VIEWPORT_SIZE.w,
      h: rect.height || FALLBACK_VIEWPORT_SIZE.h,
    };
  }

  render(scene: Scene): void {
    this.currentScene = scene;
    if (scene.canvas.grid !== this.lastGridSize) {
      this.lastGridSize = scene.canvas.grid;
      const size = scene.canvas.grid;
      setAttrs(this.gridPattern, { width: size, height: size });
      this.gridPatternPath.setAttribute("d", `M ${size} 0 L 0 0 0 ${size}`);
    }
    const elements = scene.all();
    const seen = new Set<string>();

    for (const el of elements) {
      seen.add(el.id);
      const node = this.renderElement(el, scene);
      if (!this.nodes.has(el.id)) {
        this.layer.appendChild(node);
      }
      this.nodes.set(el.id, node);
    }

    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
        this.selectedIds.delete(id);
        if (this.focusedId === id) this.focusedId = undefined;
      }
    }
    this.syncDomOrder(elements);
    this.renderOverlays(scene);
    this.syncTabIndexes(scene);
  }

  /**
   * Re-renders only the given elements (plus any connector attached to one of them, added below)
   * from the scene's current committed state — e.g. after a position-only mutation where
   * re-running full render()'s per-element pass over the whole scene would be wasteful. Still
   * skips add/remove reconciliation and DOM reordering, both of which imply a containment/z-order
   * change that full render() must handle instead — callers whose change could have altered either
   * must call render(). `createEditor.ts`'s `scene.on()` subscription enforces this by only taking
   * this path for a coalesced "update"-reason change (`Scene._transaction`); every command that
   * adds/removes/reparents/reorders reports a reason that forces the full-render fallback there.
   *
   * A connector's rendered *endpoints* are always re-derived live from its attached elements'
   * current position (`connectorPathPoints`, `routeConnector.ts`), independent of routing mode —
   * only a manual connector's inner waypoints are frozen. So a connector attached to a moved
   * element needs repainting here too, even though nothing rerouted it and its own id wasn't in
   * `ids`.
   */
  renderElements(ids: string[]): void {
    if (!this.currentScene) return;
    const scene = this.currentScene;
    const targets = new Set(ids);
    for (const el of scene.all()) {
      if (
        el.type === "connector" &&
        (targets.has(el.from.elementId) || targets.has(el.to.elementId))
      ) {
        targets.add(el.id);
      }
    }
    for (const id of targets) {
      const el = scene.get(id);
      if (!el) continue;
      this.nodes.set(id, this.renderElement(el, scene));
    }
    this.syncTabIndexes(scene);
  }

  /**
   * Reorders existing DOM nodes to match scene.all()'s z-order (paint order doubles as SVG
   * stacking order, docs/07-accessibility.md#canvas-the-hard-20) — previously never happened
   * (C10, docs/10-canvas-parity-plan.md): a z-order change repainted the element in place but
   * never actually moved it in the DOM. Guarded by lastOrderSignature so the common case (no
   * element added/removed/re-ordered since the last render) costs one string comparison, not an
   * O(n) walk.
   *
   * Walks the *current* DOM order alongside the desired one, moving a node only when it's
   * actually out of place (`insertBefore` it just ahead of the next-correct node) rather than
   * unconditionally `appendChild`-ing every element whenever the signature changes at all (C14,
   * docs/10-canvas-parity-plan.md) — the previous blanket re-append detached-and-reinserted every
   * node on *any* add/remove/reorder, including ones whose relative position never changed, which
   * silently blurs keyboard focus off a real element (e.g. Ctrl+D/paste dropping focus to
   * `<body>`, discovered live in a real browser: jsdom doesn't model focus-on-detach, so no
   * existing test caught it). A node already immediately after the last-confirmed-in-place one is
   * left completely untouched, DOM focus included.
   *
   * C14's minimal-move fix only reduces *unnecessary* reorders — it can't help a z-order command
   * (M18), whose whole point is a genuine reorder of the focused node itself: `insertBefore` on an
   * attached, focused element is still a detach-then-reinsert, which still blurs it in a real
   * browser (C15, docs/10-canvas-parity-plan.md; again invisible to jsdom). Explicitly restore
   * focus below if the reorder is what knocked it out.
   */
  private syncDomOrder(elements: SceneElement[]): void {
    const signature = elements.map((el) => el.id).join(" ");
    if (signature === this.lastOrderSignature) return;
    this.lastOrderSignature = signature;
    const activeBefore = this.layer.ownerDocument?.activeElement ?? null;
    const hadFocus = activeBefore !== null && this.layer.contains(activeBefore);
    let ref: ChildNode | null = this.layer.firstChild;
    for (const el of elements) {
      const node = this.nodes.get(el.id);
      if (!node) continue;
      if (node === ref) {
        ref = ref.nextSibling;
      } else {
        this.layer.insertBefore(node, ref);
      }
    }
    if (hadFocus && this.layer.ownerDocument?.activeElement !== activeBefore) {
      (activeBefore as SVGElement).focus();
    }
  }

  nodeFor(id: string): SVGElement | undefined {
    return this.nodes.get(id);
  }

  /** Validation badges are editor-only overlays and are stripped during export. */
  setDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = diagnostics;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /**
   * Mirrors SelectionManager state with a lightweight editor-only outline
   * (docs/07-accessibility.md#canvas-the-hard-20). Never moves real DOM
   * focus itself: focus follows `focusedId` (`focusElement()`), a separate
   * concept from selection, so callers that merely highlight a selection
   * (Find, frame presentation) don't steal focus from whatever the user is
   * typing into.
   */
  setSelection(ids: string[]): void {
    this.selectedIds = new Set(ids);
    if (!this.currentScene) return;
    this.renderOverlays(this.currentScene);
    this.syncTabIndexes(this.currentScene);
  }

  /**
   * Moves real DOM focus and the roving tabindex to an element. Distinct
   * from setSelection: Tab alone never changes what's selected.
   */
  focusElement(id: string): void {
    this.focusedId = id;
    this.nodes.get(id)?.focus();
    if (!this.currentScene) return;
    this.syncTabIndexes(this.currentScene);
    this.renderOverlays(this.currentScene);
  }

  /**
   * Live drag preview (D26, docs/00-decision-log.md): sets — or clears, at `dx === dy === 0` — a
   * CSS-style `transform` directly on each id's own `<g>` node (and its selection outline, if
   * selected), bypassing `render()`/the linter/the scene entirely. Elements are flat DOM siblings,
   * not nested SVG groups (docs/07-accessibility.md#canvas-the-hard-20's `aria-owns` tree exists
   * precisely because containment isn't expressed via DOM nesting), so moving a container this way
   * does *not* carry its children — callers must pass every id that should visually move,
   * descendants included. Connectors are deliberately left untransformed and out of sync with a
   * live move; they re-route correctly once the caller commits a real command and `render()` runs
   * again — an accepted simplification, not an oversight, matching this file's other documented
   * trade-offs (see `offsetRectilinear`).
   */
  previewTransform(ids: string[], dx: number, dy: number): void {
    const transform = dx === 0 && dy === 0 ? null : `translate(${dx}, ${dy})`;
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) {
        if (transform) node.setAttribute("transform", transform);
        else node.removeAttribute("transform");
      }
      const outline = this.overlayLayer.querySelector(`[data-icad-id="${id}"]`);
      if (outline) {
        if (transform) outline.setAttribute("transform", transform);
        else outline.removeAttribute("transform");
      }
    }
  }

  /**
   * Live resize preview (M16.2, docs/10-canvas-parity-plan.md): re-renders a single element at a
   * candidate `{x,y,w,h}` without touching the scene, the command bus, or the linter — resize
   * changes intrinsic geometry `renderElement` reads directly off the element, so (unlike
   * `previewTransform`'s translate) this rebuilds the node rather than just moving it. Pass `null`
   * to restore the last-committed geometry. Also redraws overlays so the selection outline and
   * resize handles track the previewed bbox. Connectors attached to the resized element are left
   * unrouted until commit — the same accepted simplification `previewTransform` documents for move.
   */
  previewResize(id: string, geometry: Rect | null): void {
    if (!this.currentScene) return;
    const committed = this.currentScene.get(id);
    if (!committed) return;
    if (geometry) this.previewGeometry.set(id, geometry);
    else this.previewGeometry.delete(id);
    const merged = geometry
      ? ({ ...committed, ...geometry } as SceneElement)
      : committed;
    this.nodes.set(id, this.renderElement(merged, this.currentScene));
    this.renderOverlays(this.currentScene);
  }

  /** Overrides an element's geometry with its in-progress resize preview, if any (M16.2), and
   * its rotation with any in-progress rotation preview (M20). */
  private geometryOf(el: SceneElement): SceneElement {
    const geoPreview = this.previewGeometry.get(el.id);
    const rotPreview = this.previewRotationMap.get(el.id);
    if (!geoPreview && rotPreview === undefined) return el;
    return {
      ...el,
      ...(geoPreview ?? {}),
      ...(rotPreview !== undefined ? { rotation: rotPreview } : {}),
    } as SceneElement;
  }

  /**
   * Live rotation preview (M20, docs/10-canvas-parity-plan.md): re-renders a single element at a
   * candidate rotation without touching the scene, the command bus, or the linter. Pass `null` to
   * restore the last-committed rotation. Rotation is stored in `previewGeometry` alongside the
   * element's existing x/y/w/h so `geometryOf` picks it up for all overlay positioning (selection
   * outline, resize handles, rotation handle stem).
   */
  previewRotation(id: string, degrees: number | null): void {
    if (!this.currentScene) return;
    const committed = this.currentScene.get(id);
    if (
      !committed ||
      committed.type === "connector" ||
      committed.type === "frame"
    )
      return;
    if (degrees !== null) {
      const existing = this.previewGeometry.get(id) ?? {
        x: committed.x,
        y: committed.y,
        w: committed.w,
        h: committed.h,
      };
      this.previewGeometry.set(id, existing);
      // Store rotation in a separate preview map so geometryOf can pass it through.
      this.previewRotationMap.set(id, degrees);
    } else {
      this.previewRotationMap.delete(id);
    }
    const preview = this.previewRotationMap.get(id);
    const geoOverride = this.previewGeometry.get(id);
    const merged = {
      ...committed,
      ...(geoOverride ?? {}),
      ...(preview !== undefined
        ? { rotation: preview }
        : { rotation: committed.rotation }),
    } as typeof committed;
    if (degrees === null) {
      this.previewGeometry.delete(id);
      this.previewRotationMap.delete(id);
    }
    this.nodes.set(id, this.renderElement(merged, this.currentScene));
    this.renderOverlays(this.currentScene);
  }

  /**
   * Live waypoint drag preview (M19): re-renders a connector at a candidate waypoints array
   * without touching the scene, the command bus, or the linter. Pass `null` to restore the
   * last-committed waypoints. Also redraws overlays so the handles track the preview path.
   */
  previewConnectorWaypoints(
    id: string,
    waypoints: Array<{ x: number; y: number }> | null,
  ): void {
    if (!this.currentScene) return;
    const committed = this.currentScene.get(id);
    if (!committed || committed.type !== "connector") return;
    if (waypoints) this.previewWaypoints.set(id, waypoints);
    else this.previewWaypoints.delete(id);
    const merged: ConnectorElement = waypoints
      ? ({ ...committed, waypoints } as ConnectorElement)
      : (committed as ConnectorElement);
    this.nodes.set(id, this.renderElement(merged, this.currentScene));
    this.renderOverlays(this.currentScene);
  }

  /** Shows (or clears, when either point is omitted) a rubber-band preview line while drawing a connector. */
  setConnectorDraft(from?: Point, to?: Point): void {
    this.draftConnector = from && to ? { from, to } : undefined;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /** Rubber-band rectangle preview for marquee selection (M16.3, docs/10-canvas-parity-plan.md), or
   * clears it when passed `undefined`. The actual selection is computed by the caller
   * (`hitTestRect` + `selection.set()`) on every move — this only draws the drag rectangle itself. */
  setMarqueeRect(rect: Rect | undefined): void {
    this.marqueeRect = rect;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /** Alignment guide lines (M17.2, docs/10-canvas-parity-plan.md) — the exact `SnapGuide[]`
   * `snapMove()` returns during a live drag; pass `[]` to clear at drag end/abort. */
  setSnapGuides(guides: SnapGuide[]): void {
    this.snapGuides = guides;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /** Live position/dimension HUD shown during a drag or resize gesture (M17.2,
   * docs/10-canvas-parity-plan.md) — pass `undefined` to clear it at commit/abort. */
  setGestureReadout(readout: { text: string; at: Point } | undefined): void {
    this.gestureReadout = readout;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /**
   * Faint bounding-box context for the container(s) currently drilled into (M16.4,
   * docs/10-canvas-parity-plan.md), outermost first — draws alongside, not instead of, the normal
   * active-selection outline so both render at once (IBM's own prescribed model: "make sure the
   * inside bounding box is highlighted"). Pass `[]` to clear.
   */
  setDrillPath(ids: string[]): void {
    this.drillPath = ids;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /** Highlights the container a live drag would reparent into if released now (M17.6,
   * docs/10-canvas-parity-plan.md) — pass `undefined` to clear it. */
  setDropTarget(id: string | undefined): void {
    this.dropTargetId = id;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /** Reveals port markers (n/e/s/w) on a hovered element (docs/06-editor-ux.md#core-interactions), or clears them. */
  setHoveredElement(id?: string): void {
    this.hoveredPortsId = id;
    if (this.currentScene) this.renderOverlays(this.currentScene);
  }

  /** Keeps exactly one node in the natural tab sequence (roving tabindex), preferring keyboard focus over selection. */
  private syncTabIndexes(scene: Scene): void {
    const targetId =
      this.focusedId ??
      (this.selectedIds.size === 1
        ? [...this.selectedIds][0]
        : computeTabOrder(scene)[0]?.id);
    for (const [id, node] of this.nodes) {
      node.setAttribute("tabindex", id === targetId ? "0" : "-1");
    }
  }

  destroy(): void {
    this.svg.remove();
    this.nodes.clear();
  }

  private renderElement(el: SceneElement, scene: Scene): SVGElement {
    const existing = this.nodes.get(el.id);
    const g = (existing as SVGGElement) ?? createSvgElement("g");
    g.setAttribute("id", el.id);
    g.setAttribute("data-icad-id", el.id);
    g.setAttribute("data-icad-type", el.type);
    g.setAttribute("role", accessibleRole(el));
    g.setAttribute("aria-label", accessibleName(el, scene, this.catalog));
    // Screen-reader object tree (docs/07-accessibility.md#canvas-the-hard-20): containment is
    // a flat DOM list (paint order doubles as the SVG stacking order), so `aria-owns` is how
    // a container's contents are exposed as parent/child rather than a flat sequence.
    const childIds = scene.childrenOf(el.id).map((child) => child.id);
    if (childIds.length > 0) g.setAttribute("aria-owns", childIds.join(" "));
    else g.removeAttribute("aria-owns");
    // Hidden (M18.4): render at reduced opacity so the element is visible but de-emphasised;
    // pointer-events are left intact — hit-testing exclusion is handled in canvasController.ts.
    if (el.hidden) g.setAttribute("opacity", "0.3");
    else g.removeAttribute("opacity");
    // Locked (M18.4): aria-label already communicates state; no additional visual treatment is
    // needed beyond the Properties panel toggle and the Layers badge added in M18.5.
    if (el.locked) g.setAttribute("data-icad-locked", "true");
    else g.removeAttribute("data-icad-locked");
    // Rotation (M20, docs/10-canvas-parity-plan.md): rotate the whole <g> about the element's
    // own center so every visual part (fill, label, glyph, sidebar tab) turns together.
    // Connectors and connectors' <g> nodes never carry rotation.
    if (el.type !== "connector" && el.rotation) {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      g.setAttribute("transform", `rotate(${el.rotation} ${cx} ${cy})`);
    } else {
      g.removeAttribute("transform");
    }
    g.innerHTML = "";

    switch (el.type) {
      case "box": {
        const stroke = el.style?.stroke ?? this.palette.stroke;
        g.appendChild(
          this.rect(el, {
            stroke,
            dashed: false,
            fill: this.containerFill(el, scene),
          }),
        );
        g.appendChild(this.sidebarTab(el, stroke));
        if (el.catalogRef) g.appendChild(this.containerCornerGlyph(el));
        break;
      }
      case "group": {
        // Sidebar tab on every container, not Box alone (C7, docs/10-canvas-parity-plan.md) — IBM's
        // own worked examples (Public Network, IBM Cloud, Region, OpenShift, Zone) all carry one.
        const stroke = el.style?.stroke ?? this.palette.stroke;
        g.appendChild(
          this.rect(el, {
            stroke,
            dashed: true,
            fill: this.containerFill(el, scene),
          }),
        );
        g.appendChild(this.sidebarTab(el, stroke));
        if (el.catalogRef) g.appendChild(this.containerCornerGlyph(el));
        break;
      }
      case "zone": {
        // Fine-dotted (vs Group's coarser dash) per D24 — geographic boundary (availability
        // zone / on-prem) only; Region/VPC/Subnet are Box, not Zone, as of D24.
        const stroke = el.style?.stroke ?? this.palette.zone;
        g.appendChild(
          this.rect(el, {
            stroke,
            dashed: true,
            dashArray: "2 2",
            strokeWidth: 2,
            fill: this.containerFill(el, scene),
          }),
        );
        g.appendChild(this.sidebarTab(el, stroke));
        if (el.catalogRef) g.appendChild(this.containerCornerGlyph(el));
        break;
      }
      case "frame":
        g.appendChild(
          this.rect(el, {
            stroke: this.palette.frame,
            dashed: true,
            strokeWidth: 1,
          }),
        );
        break;
      case "actor": {
        // Solid black circle + white glyph is the IBM Actor spec itself (D25, not
        // theme-dependent) — falls back to IBM's own default black when no catalogRef is set
        // (e.g. a generic Actor placed without a specific icon) or it can't be resolved.
        const rect = this.rect(el, {
          stroke: "none",
          dashed: false,
          fill: this.tileColor(el.catalogRef, "#000000"),
        });
        rect.setAttribute("rx", String(el.h / 2));
        rect.setAttribute("ry", String(el.h / 2));
        g.appendChild(rect);
        if (el.catalogRef) g.appendChild(this.iconGlyph(el));
        break;
      }
      case "iconNode": {
        // Solid category-color tile + white glyph is the IBM icon spec itself (D25,
        // docs/00-decision-log.md), not theme-dependent. Falls back to a neutral gray if the
        // catalogRef can't be resolved (e.g. a stale reference against a since-changed catalog
        // version — Roadmap M13) rather than rendering a blank/black tile.
        g.appendChild(
          this.rect(el, {
            stroke: "none",
            dashed: false,
            fill: this.tileColor(el.catalogRef, "#8d8d8d"),
          }),
        );
        g.appendChild(this.iconGlyph(el));
        break;
      }
      case "text": {
        const text = createSvgElement("text");
        setAttrs(text, { x: el.x, y: el.y, fill: this.labelStroke(el, scene) });
        text.textContent = el.text;
        g.appendChild(text);
        break;
      }
      case "connector": {
        this.renderConnector(g, el, scene);
        break;
      }
    }

    if (el.type === "frame") {
      const title = createSvgElement("text");
      setAttrs(title, {
        x: el.x + 8,
        y: el.y + 18,
        fill: this.labelStroke(el, scene),
      });
      title.textContent = el.name;
      g.appendChild(title);
    } else if (
      (el.type === "box" || el.type === "group" || el.type === "zone") &&
      el.label?.text
    ) {
      g.appendChild(this.containerLabelText(el));
    } else if (
      "label" in el &&
      el.label?.text &&
      el.type !== "text" &&
      el.type !== "connector"
    ) {
      g.appendChild(this.labelText(el, scene));
    }

    return g;
  }

  private rect(
    el: SceneElement,
    opts: {
      stroke: string;
      dashed: boolean;
      strokeWidth?: number;
      fill?: string;
      dashArray?: string;
    },
  ): SVGRectElement {
    const rect = createSvgElement("rect");
    setAttrs(rect, {
      x: el.x,
      y: el.y,
      width: el.w,
      height: el.h,
      fill: el.style?.fill ?? opts.fill ?? "none",
      stroke: el.style?.stroke ?? opts.stroke,
      "stroke-width": el.style?.strokeWidth ?? opts.strokeWidth ?? 1,
      "stroke-dasharray":
        (el.style?.dashed ?? opts.dashed)
          ? (opts.dashArray ?? "6 4")
          : undefined,
    });
    return rect;
  }

  /** See SIDEBAR_TAB_WIDTH/HEIGHT above — Box-only, colored to match the box's own stroke. */
  private sidebarTab(el: SceneElement, color: string): SVGRectElement {
    const tab = createSvgElement("rect");
    setAttrs(tab, {
      x: el.x,
      y: el.y,
      width: SIDEBAR_TAB_WIDTH,
      height: Math.min(SIDEBAR_TAB_HEIGHT, el.h),
      fill: color,
    });
    return tab;
  }

  /**
   * Containers (box/group/zone) keep a hardcoded light fill regardless of theme, for
   * spec-fidelity/export consistency (see containerFill below). A label's parent, if any,
   * renders directly behind it, so a label whose parent is one of those container types must
   * stay dark even in dark theme, or it becomes low/no-contrast against that light fill.
   * Only labels with no such parent (frame titles, root-level elements) follow the theme palette,
   * since their background is the actual canvas, which does change with theme.
   */
  private labelStroke(el: SceneElement, scene: Scene): string {
    const parent = el.parentId ? scene.get(el.parentId) : undefined;
    if (
      parent &&
      (parent.type === "box" ||
        parent.type === "group" ||
        parent.type === "zone")
    ) {
      return "#161616";
    }
    return this.palette.stroke;
  }

  private containerFill(el: SceneElement, scene: Scene): string {
    if (el.style?.fill) return el.style.fill;
    const containerDepth = scene
      .ancestorsOf(el.id)
      .filter(
        (ancestor) =>
          ancestor.type === "box" ||
          ancestor.type === "group" ||
          ancestor.type === "zone" ||
          ancestor.type === "frame",
      ).length;
    if (containerDepth % 2 === 1) return "white";
    const stroke = (el.style?.stroke ?? "").toLowerCase();
    return PRIMARY_TO_SECONDARY_FILL[stroke] ?? "#f4f4f4";
  }

  /** The icon's own category-tile color from the catalog manifest (D25) — `fallback` covers both
   * a missing catalogRef and one that can't be resolved against the loaded catalog version. */
  private tileColor(catalogRef: string | undefined, fallback: string): string {
    const meta = catalogRef ? this.catalog.resolve(catalogRef) : undefined;
    return meta?.color ?? fallback;
  }

  private iconGlyph(el: SceneElement & { catalogRef?: string }): SVGSVGElement {
    const nested = createSvgElement("svg");
    setAttrs(nested, {
      x: el.x + NODE_GLYPH_INSET,
      y: el.y + NODE_GLYPH_INSET,
      width: NODE_GLYPH_SIZE,
      height: NODE_GLYPH_SIZE,
      viewBox: `0 0 ${GLYPH_VIEWBOX_SIZE} ${GLYPH_VIEWBOX_SIZE}`,
    });
    // Stays white-on-tile (D25) — no recolor, unlike containerCornerGlyph below.
    const fragment = el.catalogRef
      ? this.catalog.svg(el.catalogRef)
      : undefined;
    nested.innerHTML = fragment ?? "";
    return nested;
  }

  private containerCornerGlyph(
    el: SceneElement & { catalogRef?: string },
  ): SVGSVGElement {
    const nested = createSvgElement("svg");
    setAttrs(nested, {
      x: el.x + CONTAINER_GLYPH_INSET,
      y: el.y + CONTAINER_GLYPH_INSET,
      width: CONTAINER_GLYPH_SIZE,
      height: CONTAINER_GLYPH_SIZE,
      // The asset's own coordinate space (GLYPH_VIEWBOX_SIZE), not the smaller on-screen display
      // size above — this is what scales the shared 24-unit glyph down to fit a 20px corner icon,
      // rather than cropping it.
      viewBox: `0 0 ${GLYPH_VIEWBOX_SIZE} ${GLYPH_VIEWBOX_SIZE}`,
    });
    // No tile sits behind a corner glyph, so the now-always-white catalog asset (D25) is
    // recolored to the container's own accent — the same color as its sidebar tab/border —
    // rather than staying invisible-white on the container's own light fill.
    const fragment = el.catalogRef
      ? this.catalog.svg(el.catalogRef)
      : undefined;
    const color = el.style?.stroke ?? this.palette.stroke;
    nested.innerHTML = fragment ? recolorGlyph(fragment, color) : "";
    return nested;
  }

  /**
   * A container's own label sits beside its corner glyph, top-left, baseline-aligned with the
   * icon — not centered below the whole boundary — matching IBM's worked examples (Region, IBM
   * Cloud, IBM VPC, Kubernetes/OpenShift, Zone, and Subnet all place their title this way; see
   * CONTAINER_LABEL_GAP above). Applies to every container type (box/group/zone) alike, per C7's
   * same "not Box alone" reasoning for the sidebar tab and corner glyph above — this was originally
   * built for Group only and never generalized, so Box/Zone fell through to the generic
   * `labelText()`'s bottom-center placement instead (confirmed wrong against IBM's own
   * `iks_sr_mz_vpc` reference: every one of its container titles sits top-left beside its icon).
   * Always renders on the container's own fill (containerFill, which D24 keeps hardcoded light
   * regardless of theme), so the text stays dark unconditionally rather than following
   * labelStroke's parent-based theme check.
   */
  private containerLabelText(
    el: SceneElement & { catalogRef?: string },
  ): SVGTextElement {
    const text = createSvgElement("text");
    const hasIcon = Boolean(el.catalogRef);
    const x =
      el.x +
      CONTAINER_GLYPH_INSET +
      (hasIcon ? CONTAINER_GLYPH_SIZE + CONTAINER_LABEL_GAP : 0);
    const y = el.y + CONTAINER_GLYPH_INSET + CONTAINER_GLYPH_SIZE / 2 + 5;
    setAttrs(text, { x, y, fill: "#161616" });
    text.textContent = el.label?.text
      ? ellipsize(
          el.label.text,
          containerLabelMaxWidth(el),
          "end",
          CONTAINER_LABEL_FONT_SIZE_PX,
        )
      : "";
    return text;
  }

  /**
   * The available width for an icon/actor's own caption to wrap within before it would run past
   * its parent container's edge — mirrors containerLabelMaxWidth's "don't overflow the boundary"
   * intent, but centered rather than left-anchored, since these captions are centered under/over
   * their element (see labelText). Falls back to a generous flat width when there's no parent to
   * derive it from (a detached element in tests, or a top-level icon on the canvas itself, which
   * has no enclosing box/zone to respect).
   */
  private labelMaxWidth(el: SceneElement, scene: Scene): number {
    const parent = el.parentId ? scene.get(el.parentId) : undefined;
    if (!parent) return FALLBACK_LABEL_MAX_WIDTH;
    const centerX = el.x + el.w / 2;
    const left = centerX - parent.x;
    const right = parent.x + parent.w - centerX;
    return Math.max(0, 2 * Math.min(left, right));
  }

  private labelText(el: SceneElement, scene: Scene): SVGTextElement {
    const text = createSvgElement("text");
    const position = el.label?.position ?? "s";
    const centerX = el.x + el.w / 2;
    const singleLineY = position === "s" ? el.y + el.h + 14 : el.y - 6;
    const fill = this.labelStroke(el, scene);

    const raw = el.label?.text ?? "";
    const lines = raw
      ? wrapText(raw, this.labelMaxWidth(el, scene), { maxLines: 2 })
      : [];

    if (lines.length <= 1) {
      setAttrs(text, {
        x: centerX,
        y: singleLineY,
        fill,
        "text-anchor": "middle",
      });
      text.textContent = lines[0] ?? "";
      return text;
    }

    // Multi-line: explicit x/y per tspan (not relative dy chaining) so each line is independently
    // positioned and testable on its own, rather than only as an accumulated chain. Kept out of the
    // single-line path above entirely, so the common (unwrapped) case's DOM shape and attributes
    // stay exactly as before - this only engages once a caption genuinely needs a second line.
    setAttrs(text, { fill, "text-anchor": "middle" });
    const baseY =
      position === "s"
        ? singleLineY
        : singleLineY - (lines.length - 1) * LABEL_LINE_HEIGHT_PX;
    lines.forEach((line, i) => {
      const tspan = createSvgElement("tspan");
      setAttrs(tspan, { x: centerX, y: baseY + i * LABEL_LINE_HEIGHT_PX });
      tspan.textContent = line;
      text.appendChild(tspan);
    });
    return text;
  }

  /**
   * A connector renders as: an optional highlighted band (tunneling types),
   * the main line (dashed/solid per connectorType, with start/end markers
   * per docs/05's nomenclature), an optional parallel offset line (physical
   * connection's double-line style), and any label/cardinality text along
   * the path. Line color follows flowColor (green/blue) when set, otherwise
   * an explicit style override, otherwise the theme default.
   */
  private renderConnector(
    g: SVGGElement,
    el: ConnectorElement,
    scene: Scene,
  ): void {
    const points = connectorPathPoints(scene, el);
    const pointsAttr = toPointsAttr(points);
    const style =
      (CONNECTOR_STYLE as Record<string, ConnectorStyleSpec>)[
        el.connectorType
      ] ?? CONNECTOR_STYLE.association;
    const stroke =
      el.style?.stroke ??
      (el.flowColor ? FLOW_COLORS[el.flowColor] : this.palette.stroke);
    const strokeWidth = el.style?.strokeWidth ?? 2;

    if (style.band) {
      // Fixed IBM band colors (TUNNEL_BAND_COLORS), not derived from the connector's own stroke —
      // the pink/yellow highlight is the tunnel indicator itself, independent of flow color.
      // Drawn outermost (i=2, wider) first so the innermost (i=1, narrower) paints on top, per
      // the reference: a single tunnel band, or two concentric bands for the double variant.
      for (let i = style.band; i >= 1; i -= 1) {
        const band = createSvgElement("polyline");
        setAttrs(band, {
          points: pointsAttr,
          fill: "none",
          stroke:
            i === 2 ? TUNNEL_BAND_COLORS.double : TUNNEL_BAND_COLORS.single,
          "stroke-width": strokeWidth + i * 6,
        });
        g.appendChild(band);
      }
    }

    const isConnection = CONNECTION_TYPES.has(el.connectorType);
    // Physical connection's hollow box caps (both ends, per Connectors.drawio's symmetric
    // startArrow=box/endArrow=box) override the generic connection dot-start convention.
    const startMarker: MarkerKind =
      style.startMarker ?? (isConnection ? "dot" : "none");
    const endMarker: MarkerKind =
      style.endMarker === "box"
        ? "box"
        : isConnection && el.direction === "bidirectional"
          ? "dot"
          : style.endMarker;

    const line = createSvgElement("polyline");
    setAttrs(line, {
      points: pointsAttr,
      fill: "none",
      stroke,
      "stroke-width": strokeWidth,
      "stroke-dasharray": style.dash,
      "marker-start":
        startMarker !== "none" ? `url(#${MARKER_IDS[startMarker]})` : undefined,
      "marker-end":
        endMarker !== "none" ? `url(#${MARKER_IDS[endMarker]})` : undefined,
    });
    g.appendChild(line);

    if (style.doubleLine) {
      const parallel = createSvgElement("polyline");
      setAttrs(parallel, {
        points: toPointsAttr(offsetRectilinear(points, 3)),
        fill: "none",
        stroke,
        "stroke-width": strokeWidth,
        "stroke-dasharray": style.dash,
      });
      g.appendChild(parallel);
    }

    if (el.label?.text) {
      const mid = pointAtFraction(points, 0.5);
      const text = createSvgElement("text");
      setAttrs(text, {
        x: mid.x,
        // -4 with no explicit font-size (inheriting the root SVG's, ~16-18px) left only a few
        // px of clearance for a glyph roughly 3-4x that tall — the line visibly cut through the
        // bottom of the text. -10 with the same 11px font every sibling label on a connector
        // (cardinalityLabel, sequenceBadge, annotationLabel) already uses clears it, and clears
        // the sequence badge below (a 9px-radius circle straddling the line, mid.y-9..mid.y+9).
        y: mid.y - 10,
        fill: this.palette.stroke,
        "text-anchor": "middle",
        "font-size": 11,
      });
      text.textContent = ellipsize(
        el.label.text,
        CONNECTOR_LABEL_MAX_WIDTH,
        "end",
        11,
      );
      g.appendChild(text);
    }

    if (el.cardinality?.from)
      g.appendChild(this.cardinalityLabel(points, 0.1, el.cardinality.from));
    if (el.cardinality?.to)
      g.appendChild(this.cardinalityLabel(points, 0.9, el.cardinality.to));
    if (el.sequence) g.appendChild(this.sequenceBadge(points, el.sequence));
    if (el.annotation)
      g.appendChild(this.annotationLabel(points, el.annotation));
  }

  /**
   * IBM's structured protocol/encapsulation annotation (docs/05-ibm-spec-conformance.md#connector-
   * nomenclature), formatted via formatConnectorAnnotation and rendered below the connector's
   * midpoint — clear of the label above it (label sits at mid.y-4) and the sequence badge
   * straddling the line (radius 9, so it spans mid.y-9..mid.y+9).
   */
  private annotationLabel(
    points: Point[],
    annotation: ConnectorAnnotation,
  ): SVGTextElement {
    const mid = pointAtFraction(points, 0.5);
    const text = createSvgElement("text");
    setAttrs(text, {
      x: mid.x,
      y: mid.y + 20,
      fill: this.palette.stroke,
      "text-anchor": "middle",
      "font-size": 11,
    });
    text.textContent = ellipsize(
      formatConnectorAnnotation(annotation),
      CONNECTOR_ANNOTATION_MAX_WIDTH,
      "end",
      11,
    );
    return text;
  }

  private cardinalityLabel(
    points: Point[],
    t: number,
    text: string,
  ): SVGTextElement {
    const at = pointAtFraction(points, t);
    const el = createSvgElement("text");
    setAttrs(el, {
      x: at.x,
      y: at.y - 4,
      fill: this.palette.stroke,
      "text-anchor": "middle",
      "font-size": 11,
    });
    el.textContent = ellipsize(text, CARDINALITY_LABEL_MAX_WIDTH, "end", 11);
    return el;
  }

  /**
   * IBM's "sequencing or numbering for flowcharts or use cases" badge (docs/05-ibm-spec-
   * conformance.md#connector-nomenclature) — a small circled label straddling the connector's
   * midpoint, distinct from the connector's own text label (which floats above the line).
   */
  private sequenceBadge(points: Point[], text: string): SVGGElement {
    const at = pointAtFraction(points, 0.5);
    const badge = createSvgElement("g");
    const circle = createSvgElement("circle");
    setAttrs(circle, {
      cx: at.x,
      cy: at.y,
      r: 9,
      fill: "white",
      stroke: this.palette.stroke,
    });
    const label = createSvgElement("text");
    setAttrs(label, {
      x: at.x,
      y: at.y + 3,
      fill: this.palette.stroke,
      "text-anchor": "middle",
      "font-size": 10,
    });
    label.textContent = ellipsize(text, SEQUENCE_BADGE_MAX_WIDTH, "end", 10);
    badge.appendChild(circle);
    badge.appendChild(label);
    return badge;
  }

  private renderOverlays(scene: Scene): void {
    this.overlayLayer.innerHTML = "";

    // Drill scope (M16.4): a faint, undashed outline per entered container — deliberately a
    // different style from the active-selection outline below (solid vs. dashed, low opacity, no
    // inset) so a container that's also the current selection shows both without either reading
    // as a duplicate.
    for (const id of this.drillPath) {
      const raw = scene.get(id);
      if (!raw || raw.type === "connector") continue;
      const el = this.geometryOf(raw);
      const outline = createSvgElement("rect");
      outline.setAttribute("data-icad-drill-outline", id);
      setAttrs(outline, {
        x: el.x,
        y: el.y,
        width: el.w,
        height: el.h,
        fill: "none",
        stroke: "#0f62fe",
        "stroke-width": 1,
        "stroke-opacity": 0.35,
      });
      this.overlayLayer.appendChild(outline);
    }

    // Drop-target highlight (M17.6, docs/10-canvas-parity-plan.md): a distinct affirmative green
    // (Carbon Green 50), not the blue selection/drill family or the magenta guides — reads as "drop
    // here," not "this is selected" or "the canvas is telling you something about alignment."
    if (this.dropTargetId) {
      const raw = scene.get(this.dropTargetId);
      if (raw && raw.type !== "connector") {
        const el = this.geometryOf(raw);
        const highlight = createSvgElement("rect");
        highlight.setAttribute("data-icad-drop-target", this.dropTargetId);
        setAttrs(highlight, {
          x: el.x,
          y: el.y,
          width: el.w,
          height: el.h,
          fill: "#24a148",
          "fill-opacity": 0.12,
          stroke: "#24a148",
          "stroke-width": 2,
        });
        this.overlayLayer.appendChild(highlight);
      }
    }

    for (const rawId of this.selectedIds) {
      const raw = scene.get(rawId);
      if (!raw) continue;
      const el = this.geometryOf(raw);
      if (el.type === "connector") {
        // Merge live waypoint preview (M19) so the highlight and handles stay in sync with
        // the drag before it's committed to the scene.
        const previewWp = this.previewWaypoints.get(el.id);
        const elWithPreview: ConnectorElement = previewWp
          ? { ...(el as ConnectorElement), waypoints: previewWp }
          : (el as ConnectorElement);
        const highlight = createSvgElement("polyline");
        setAttrs(highlight, {
          points: toPointsAttr(connectorPathPoints(scene, elWithPreview)),
          fill: "none",
          stroke: "#0f62fe",
          "stroke-width": 5,
          "stroke-opacity": 0.35,
        });
        this.overlayLayer.appendChild(highlight);
      } else {
        const outline = createSvgElement("rect");
        // Tagged so previewTransform() (a live drag preview) can move this outline in lockstep
        // with its element — both are flat siblings in the DOM, not nested, so an element's own
        // transform never carries its selection outline along for free.
        outline.setAttribute("data-icad-id", el.id);
        setAttrs(outline, {
          x: el.x - 3,
          y: el.y - 3,
          width: el.w + 6,
          height: el.h + 6,
          fill: "none",
          stroke: "#0f62fe",
          "stroke-width": 2,
          "stroke-dasharray": "4 2",
        });
        // Rotate the selection outline in lockstep with the element (M20).
        if (el.rotation) {
          const cx = el.x + el.w / 2;
          const cy = el.y + el.h / 2;
          outline.setAttribute(
            "transform",
            `rotate(${el.rotation} ${cx} ${cy})`,
          );
        }
        this.overlayLayer.appendChild(outline);
      }
    }

    // 8-handle resize (M16.2, docs/10-canvas-parity-plan.md): only for a single non-connector,
    // non-frame selection — Frame is excluded everywhere else a pointer directly manipulates an
    // element (drag, hover-ports, connect-mode; see CanvasController), and multi-element
    // proportional resize isn't something IBM's own prescribed gesture (single inside-shape,
    // corner-drag) covers, so it's out of scope here rather than a gap.
    if (this.selectedIds.size === 1) {
      const raw = scene.get([...this.selectedIds][0]!);
      if (raw && raw.type !== "connector" && raw.type !== "frame") {
        const el = this.geometryOf(raw);
        // For rotated elements the handles are placed on the rotated corners/mid-edges
        // (M20): wrap them in a <g> that carries the same rotation transform.
        const handleGroup = createSvgElement("g");
        if (el.rotation) {
          const cx = el.x + el.w / 2;
          const cy = el.y + el.h / 2;
          handleGroup.setAttribute(
            "transform",
            `rotate(${el.rotation} ${cx} ${cy})`,
          );
        }
        for (const handle of RESIZE_HANDLES) {
          const point = resizeHandlePoint(el, handle);
          const marker = createSvgElement("rect");
          setAttrs(marker, {
            x: point.x - 4,
            y: point.y - 4,
            width: 8,
            height: 8,
            fill: "#ffffff",
            stroke: "#0f62fe",
            "stroke-width": 1.5,
            cursor: resizeCursor(handle),
            "pointer-events": "all",
            "data-icad-resize-handle": handle,
          });
          handleGroup.appendChild(marker);
        }
        this.overlayLayer.appendChild(handleGroup);

        // Rotation handle (M20, docs/10-canvas-parity-plan.md): a circle above the element's
        // top-center, connected by a short stem. Placed in the same rotated coordinate system
        // as the resize handles so it always appears "above" the element regardless of its
        // current rotation. Excluded for Frame (same reasoning as resize handles).
        const ROTATION_STEM = 24; // px above the top-center in the element's local frame
        const ROTATION_HANDLE_R = 6;
        const topCenter = resizeHandlePoint(el, "n");
        const stemEnd = { x: topCenter.x, y: topCenter.y - ROTATION_STEM };
        const rotHandleGroup = createSvgElement("g");
        if (el.rotation) {
          const cx = el.x + el.w / 2;
          const cy = el.y + el.h / 2;
          rotHandleGroup.setAttribute(
            "transform",
            `rotate(${el.rotation} ${cx} ${cy})`,
          );
        }
        const stem = createSvgElement("line");
        setAttrs(stem, {
          x1: topCenter.x,
          y1: topCenter.y,
          x2: stemEnd.x,
          y2: stemEnd.y,
          stroke: "#0f62fe",
          "stroke-width": 1,
          "pointer-events": "none",
        });
        rotHandleGroup.appendChild(stem);
        const rotHandle = createSvgElement("circle");
        setAttrs(rotHandle, {
          cx: stemEnd.x,
          cy: stemEnd.y,
          r: ROTATION_HANDLE_R,
          fill: "#ffffff",
          stroke: "#0f62fe",
          "stroke-width": 1.5,
          cursor: "grab",
          "pointer-events": "all",
          "data-icad-rotation-handle": el.id,
        });
        rotHandleGroup.appendChild(rotHandle);
        this.overlayLayer.appendChild(rotHandleGroup);
      }

      // M19 — Connector editing: waypoint drag handles, midpoint insert handles,
      // and endpoint retarget handles for a single selected connector.
      if (raw && raw.type === "connector") {
        // Merge live waypoint preview so handles track the dragged position.
        const previewWp = this.previewWaypoints.get(raw.id);
        const el: ConnectorElement = previewWp
          ? { ...(raw as ConnectorElement), waypoints: previewWp }
          : (raw as ConnectorElement);
        const fullPoints = connectorPathPoints(scene, el);
        const innerWaypoints = el.waypoints ?? [];

        // Waypoint drag handles (diamonds) — one per existing inner waypoint.
        innerWaypoints.forEach((wp, index) => {
          const handle = createSvgElement("rect");
          setAttrs(handle, {
            x: wp.x - 5,
            y: wp.y - 5,
            width: 10,
            height: 10,
            fill: "#ffffff",
            stroke: "#0f62fe",
            "stroke-width": 1.5,
            transform: `rotate(45 ${wp.x} ${wp.y})`,
            cursor: "move",
            "pointer-events": "all",
            "data-icad-waypoint-handle": `${el.id}:${index}`,
          });
          this.overlayLayer.appendChild(handle);
        });

        // Midpoint insert handles (circles with +) — one per segment between existing points,
        // but only for segments longer than a threshold to avoid clutter on short segments.
        const INSERT_MIN_LENGTH = 20;
        for (let i = 0; i < fullPoints.length - 1; i += 1) {
          const a = fullPoints[i]!;
          const b = fullPoints[i + 1]!;
          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
          if (segLen < INSERT_MIN_LENGTH) continue;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          // Insert index: the waypoint array index where a new point would be spliced.
          // fullPoints = [fromEndpoint, ...innerWaypoints, toEndpoint], so segment i between
          // fullPoints[i] and fullPoints[i+1] maps to inner-waypoint insert position i
          // (inserting before innerWaypoints[i], i.e. after any existing i-1 waypoint).
          const insertIndex = i;
          const circle = createSvgElement("circle");
          setAttrs(circle, {
            cx: mx,
            cy: my,
            r: 6,
            fill: "#ffffff",
            stroke: "#0f62fe",
            "stroke-width": 1.5,
            cursor: "crosshair",
            "pointer-events": "all",
            "data-icad-waypoint-insert": `${el.id}:${insertIndex}`,
          });
          this.overlayLayer.appendChild(circle);
          // "+" cross-hair inside the circle
          const hLine = createSvgElement("line");
          setAttrs(hLine, {
            x1: mx - 3,
            y1: my,
            x2: mx + 3,
            y2: my,
            stroke: "#0f62fe",
            "stroke-width": 1.5,
            "pointer-events": "none",
          });
          this.overlayLayer.appendChild(hLine);
          const vLine = createSvgElement("line");
          setAttrs(vLine, {
            x1: mx,
            y1: my - 3,
            x2: mx,
            y2: my + 3,
            stroke: "#0f62fe",
            "stroke-width": 1.5,
            "pointer-events": "none",
          });
          this.overlayLayer.appendChild(vLine);
        }

        // Endpoint retarget handles (hollow circles on from/to port positions).
        // Dragging one of these lets the user drop it on a different element port.
        const fromEl = scene.get(el.from.elementId);
        const toEl = scene.get(el.to.elementId);
        for (const [endpoint, portEl, port] of [
          ["from", fromEl, el.from.port] as const,
          ["to", toEl, el.to.port] as const,
        ]) {
          if (!portEl) continue;
          // Matches connectorPathPoints's own anchor (fanned out if this port is shared with
          // other connectors) rather than the raw port center, so the handle sits exactly where
          // the connector's line actually starts/ends instead of visibly detached from it.
          const pt = connectorAnchorPoint(scene, portEl.id, port, el.id);
          const circle = createSvgElement("circle");
          setAttrs(circle, {
            cx: pt.x,
            cy: pt.y,
            r: 7,
            fill: "#ffffff",
            stroke: "#ee5396",
            "stroke-width": 2,
            cursor: "crosshair",
            "pointer-events": "all",
            "data-icad-endpoint-handle": `${el.id}:${endpoint}`,
          });
          this.overlayLayer.appendChild(circle);
        }
      }
    }

    const byElement = new Map<string, Diagnostic[]>();
    for (const item of this.diagnostics) {
      if (!item.elementId || !scene.has(item.elementId)) continue;
      byElement.set(item.elementId, [
        ...(byElement.get(item.elementId) ?? []),
        item,
      ]);
    }
    for (const [id, diagnostics] of byElement) {
      const el = this.geometryOf(scene.get(id)!);
      const severity = highestSeverity(
        diagnostics.map((item) => item.severity),
      );
      const at =
        el.type === "connector"
          ? pointAtFraction(connectorPathPoints(scene, el), 0.5)
          : { x: el.x + el.w, y: el.y };
      const badge = createSvgElement("g");
      badge.setAttribute("data-icad-validation-badge", id);
      const title = createSvgElement("title");
      title.textContent = diagnostics.map((item) => item.message).join("\n");
      badge.appendChild(title);
      const circle = createSvgElement("circle");
      setAttrs(circle, {
        cx: at.x,
        cy: at.y,
        r: 8,
        fill:
          severity === "error"
            ? "#da1e28"
            : severity === "warn"
              ? "#f1c21b"
              : "#0f62fe",
        stroke: "#ffffff",
        "stroke-width": 1.5,
      });
      badge.appendChild(circle);
      const text = createSvgElement("text");
      setAttrs(text, {
        x: at.x,
        y: at.y + 3.5,
        fill: severity === "warn" ? "#161616" : "#ffffff",
        "font-size": 10,
        "font-weight": 600,
        "text-anchor": "middle",
      });
      text.textContent =
        diagnostics.length > 1 ? String(diagnostics.length) : "!";
      badge.appendChild(text);
      this.overlayLayer.appendChild(badge);
    }

    if (this.focusedId) {
      const raw = scene.get(this.focusedId);
      const el = raw ? this.geometryOf(raw) : undefined;
      if (el && el.type !== "connector") {
        const ring = createSvgElement("rect");
        setAttrs(ring, {
          x: el.x - 6,
          y: el.y - 6,
          width: el.w + 12,
          height: el.h + 12,
          fill: "none",
          stroke: "#0f62fe",
          "stroke-width": 1,
          "stroke-dasharray": "1 2",
        });
        this.overlayLayer.appendChild(ring);
      }
    }

    if (this.hoveredPortsId) {
      const el = scene.get(this.hoveredPortsId);
      if (el && el.type !== "connector" && el.type !== "frame") {
        for (const side of ["n", "e", "s", "w"] as const) {
          const point = portPoint(el, side);
          const marker = createSvgElement("circle");
          setAttrs(marker, {
            cx: point.x,
            cy: point.y,
            r: 6,
            fill: "#ffffff",
            stroke: "#0f62fe",
            "stroke-width": 1.5,
            "pointer-events": "all",
            "data-icad-port": `${el.id}:${side}`,
          });
          this.overlayLayer.appendChild(marker);
        }
      }
    }

    if (this.draftConnector) {
      const line = createSvgElement("line");
      setAttrs(line, {
        x1: this.draftConnector.from.x,
        y1: this.draftConnector.from.y,
        x2: this.draftConnector.to.x,
        y2: this.draftConnector.to.y,
        stroke: "#0f62fe",
        "stroke-width": 2,
        "stroke-dasharray": "4 3",
      });
      this.overlayLayer.appendChild(line);
    }

    if (this.marqueeRect) {
      const rect = createSvgElement("rect");
      setAttrs(rect, {
        x: this.marqueeRect.x,
        y: this.marqueeRect.y,
        width: this.marqueeRect.w,
        height: this.marqueeRect.h,
        fill: "#0f62fe",
        "fill-opacity": 0.1,
        stroke: "#0f62fe",
        "stroke-width": 1,
        "stroke-dasharray": "4 3",
      });
      this.overlayLayer.appendChild(rect);
    }

    // Alignment guides (M17.2, docs/10-canvas-parity-plan.md): a distinct color from the blue
    // selection/marquee family so a guide reads as "the canvas telling you something" rather than
    // "part of the current selection."
    for (const guide of this.snapGuides) {
      const line = createSvgElement("line");
      const isVertical = guide.orientation === "vertical";
      setAttrs(line, {
        x1: isVertical ? guide.position : guide.start,
        y1: isVertical ? guide.start : guide.position,
        x2: isVertical ? guide.position : guide.end,
        y2: isVertical ? guide.end : guide.position,
        stroke: "#ee5396",
        "stroke-width": 1,
        "stroke-dasharray": "2 2",
      });
      this.overlayLayer.appendChild(line);
    }

    // Live position/dimension HUD (M17.2): fixed dark-on-light styling regardless of the diagram's
    // own resolved theme, matching the validation badge's own precedent of theme-independent
    // overlay chrome — this is transient gesture chrome, not diagram content.
    if (this.gestureReadout) {
      const { text, at } = this.gestureReadout;
      const paddingX = 6;
      const height = 18;
      // No text-measurement API is reliably available off a real layout pass (and this is a
      // best-effort HUD, not something export or a screenshot diff ever depends on) — approximated
      // from character count, matching this file's other pragmatic size estimates.
      const width = text.length * 6.5 + paddingX * 2;
      const g = createSvgElement("g");
      g.setAttribute("data-icad-gesture-readout", "true");
      const bg = createSvgElement("rect");
      setAttrs(bg, {
        x: at.x,
        y: at.y - height,
        width,
        height,
        rx: 3,
        fill: "#161616",
      });
      g.appendChild(bg);
      const label = createSvgElement("text");
      setAttrs(label, {
        x: at.x + paddingX,
        y: at.y - height / 2 + 4,
        fill: "#ffffff",
        "font-size": 11,
      });
      label.textContent = text;
      g.appendChild(label);
      this.overlayLayer.appendChild(g);
    }
  }
}

function highestSeverity(severities: Severity[]): Severity {
  if (severities.includes("error")) return "error";
  if (severities.includes("warn")) return "warn";
  return "info";
}
