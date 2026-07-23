import type { Catalog } from "../catalog/catalog.js";
import type { Scene } from "../scene/scene.js";
import type { ConnectorElement, ConnectorType, SceneElement } from "../scene/types.js";
import { connectorPathPoints } from "../routing/routeConnector.js";
import { createSvgElement, setAttrs } from "./dom.js";
import type { Point } from "./port.js";

const ICON_CONTAINER = 48;
const ICON_GLYPH = 20;
const ICON_OFFSET = (ICON_CONTAINER - ICON_GLYPH) / 2;

export type ResolvedTheme = "light" | "dark";

interface Palette {
  stroke: string;
  zone: string;
  frame: string;
}

const PALETTES: Record<ResolvedTheme, Palette> = {
  light: { stroke: "#161616", zone: "#8d8d8d", frame: "#a8a8a8" },
  dark: { stroke: "#f4f4f4", zone: "#a8a8a8", frame: "#6f6f6f" }
};

/** Independent of connectorType (docs/05-ibm-spec-conformance.md#connector-nomenclature). */
const FLOW_COLORS = { private: "#198038", public: "#0f62fe" } as const;

type MarkerId = "icad-arrow" | "icad-arrow-hollow" | "icad-diamond-open" | "icad-diamond-filled";
type MarkerKind = "none" | "arrow" | "arrow-hollow" | "diamond-open" | "diamond-filled";

const MARKER_IDS: Record<Exclude<MarkerKind, "none">, MarkerId> = {
  arrow: "icad-arrow",
  "arrow-hollow": "icad-arrow-hollow",
  "diamond-open": "icad-diamond-open",
  "diamond-filled": "icad-diamond-filled"
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
  "traffic-through-double-tunnel"
]);

/** Line style + arrowheads per docs/05-ibm-spec-conformance.md#connector-nomenclature. */
const CONNECTOR_STYLE: Record<ConnectorType, ConnectorStyleSpec> = {
  "logical-connection": { dash: "6 3 1 3", endMarker: "arrow" },
  connection: { endMarker: "arrow" },
  "physical-connection": { doubleLine: true, endMarker: "arrow" },
  "tunneling-connection": { band: 1, endMarker: "arrow" },
  "traffic-through-double-tunnel": { band: 2, endMarker: "arrow" },
  dependency: { dash: "4 3", endMarker: "arrow" },
  association: { endMarker: "arrow" },
  aggregation: { endMarker: "arrow", startMarker: "diamond-open" },
  composition: { endMarker: "arrow", startMarker: "diamond-filled" },
  implementation: { dash: "4 3", endMarker: "arrow-hollow" },
  extends: { endMarker: "arrow-hollow" }
};

/** Point at a fraction `t` (0..1) along a polyline's total length. */
function pointAtFraction(points: Point[], t: number): Point {
  const segments = points.slice(0, -1).map((p, i) => {
    const q = points[i + 1]!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const total = segments.reduce((a, b) => a + b, 0);
  if (total === 0) return points[0]!;
  let remaining = total * Math.min(1, Math.max(0, t));
  for (let i = 0; i < segments.length; i += 1) {
    const len = segments[i]!;
    if (remaining <= len || i === segments.length - 1) {
      const ratio = len === 0 ? 0 : remaining / len;
      const p = points[i]!;
      const q = points[i + 1]!;
      return { x: p.x + (q.x - p.x) * ratio, y: p.y + (q.y - p.y) * ratio };
    }
    remaining -= len;
  }
  return points[0]!;
}

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
      horizontal: Math.abs(dy) < 0.01
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
      out.push(seg.horizontal ? { x: next.a.x, y: seg.a.y } : { x: seg.a.x, y: next.a.y });
    } else {
      out.push(seg.b);
    }
  }
  return out;
}

function toPointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

const MARKER_DEFS: Array<{
  id: MarkerId;
  d: string;
  colorAttr: "fill" | "stroke";
  fixedFill?: string;
}> = [
  { id: "icad-arrow", d: "M0,0 L10,5 L0,10 z", colorAttr: "fill" },
  { id: "icad-arrow-hollow", d: "M0,0 L10,5 L0,10 z", colorAttr: "stroke", fixedFill: "none" },
  { id: "icad-diamond-open", d: "M0,5 L5,0 L10,5 L5,10 z", colorAttr: "stroke", fixedFill: "white" },
  { id: "icad-diamond-filled", d: "M0,5 L5,0 L10,5 L5,10 z", colorAttr: "fill" }
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
  private nodes = new Map<string, SVGElement>();
  private markers = new Map<MarkerId, { path: SVGPathElement; colorAttr: "fill" | "stroke" }>();
  private palette: Palette;

  constructor(
    private container: HTMLElement,
    private catalog: Catalog,
    theme: ResolvedTheme = "light"
  ) {
    this.palette = PALETTES[theme];

    this.svg = createSvgElement("svg");
    setAttrs(this.svg, { width: "100%", height: "100%" });
    this.svg.setAttribute("data-icad-root", "true");

    const defs = createSvgElement("defs");
    for (const def of MARKER_DEFS) {
      const marker = createSvgElement("marker");
      setAttrs(marker, {
        id: def.id,
        viewBox: "0 0 10 10",
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        orient: "auto-start-reverse"
      });
      const path = createSvgElement("path");
      setAttrs(path, {
        d: def.d,
        fill: def.colorAttr === "fill" ? this.palette.stroke : (def.fixedFill ?? "none"),
        stroke: def.colorAttr === "stroke" ? this.palette.stroke : undefined,
        "stroke-width": def.colorAttr === "stroke" ? 1.2 : undefined
      });
      marker.appendChild(path);
      defs.appendChild(marker);
      this.markers.set(def.id, { path, colorAttr: def.colorAttr });
    }
    this.svg.appendChild(defs);

    this.layer = createSvgElement("g");
    this.layer.setAttribute("data-icad-layer", "elements");
    this.svg.appendChild(this.layer);

    this.container.appendChild(this.svg);
  }

  /** Updates the resolved theme; call render(scene) afterwards to repaint. */
  setTheme(theme: ResolvedTheme): void {
    this.palette = PALETTES[theme];
    for (const { path, colorAttr } of this.markers.values()) {
      path.setAttribute(colorAttr, this.palette.stroke);
    }
  }

  render(scene: Scene): void {
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
      }
    }
  }

  nodeFor(id: string): SVGElement | undefined {
    return this.nodes.get(id);
  }

  destroy(): void {
    this.svg.remove();
    this.nodes.clear();
  }

  private renderElement(el: SceneElement, scene: Scene): SVGElement {
    const existing = this.nodes.get(el.id);
    const g = (existing as SVGGElement) ?? createSvgElement("g");
    g.setAttribute("data-icad-id", el.id);
    g.setAttribute("data-icad-type", el.type);
    g.innerHTML = "";

    switch (el.type) {
      case "box":
        g.appendChild(this.rect(el, { stroke: this.palette.stroke, dashed: false }));
        break;
      case "group":
        g.appendChild(this.rect(el, { stroke: this.palette.stroke, dashed: true }));
        break;
      case "zone":
        g.appendChild(this.rect(el, { stroke: this.palette.zone, dashed: true, strokeWidth: 2 }));
        break;
      case "frame":
        g.appendChild(this.rect(el, { stroke: this.palette.frame, dashed: true, strokeWidth: 1 }));
        break;
      case "actor": {
        const rect = this.rect(el, { stroke: this.palette.stroke, dashed: false });
        rect.setAttribute("rx", String(el.h / 2));
        rect.setAttribute("ry", String(el.h / 2));
        g.appendChild(rect);
        if (el.catalogRef) g.appendChild(this.iconGlyph(el));
        break;
      }
      case "iconNode": {
        // White fill + dark outline is part of the IBM icon spec itself
        // (docs/05-ibm-spec-conformance.md), not theme-dependent.
        const rect = createSvgElement("rect");
        setAttrs(rect, {
          x: el.x,
          y: el.y,
          width: ICON_CONTAINER,
          height: ICON_CONTAINER,
          fill: "white",
          stroke: "#161616",
          "stroke-width": 1
        });
        g.appendChild(rect);
        g.appendChild(this.iconGlyph(el));
        break;
      }
      case "text": {
        const text = createSvgElement("text");
        setAttrs(text, { x: el.x, y: el.y, fill: this.palette.stroke });
        text.textContent = el.text;
        g.appendChild(text);
        break;
      }
      case "connector": {
        this.renderConnector(g, el, scene);
        break;
      }
    }

    if ("label" in el && el.label?.text && el.type !== "text" && el.type !== "connector") {
      g.appendChild(this.labelText(el));
    }

    return g;
  }

  private rect(
    el: SceneElement,
    opts: { stroke: string; dashed: boolean; strokeWidth?: number }
  ): SVGRectElement {
    const rect = createSvgElement("rect");
    setAttrs(rect, {
      x: el.x,
      y: el.y,
      width: el.w,
      height: el.h,
      fill: el.style?.fill ?? "none",
      stroke: el.style?.stroke ?? opts.stroke,
      "stroke-width": el.style?.strokeWidth ?? opts.strokeWidth ?? 1,
      "stroke-dasharray": opts.dashed ? "6 4" : undefined
    });
    return rect;
  }

  private iconGlyph(el: SceneElement & { catalogRef?: string }): SVGSVGElement {
    const nested = createSvgElement("svg");
    setAttrs(nested, {
      x: el.x + ICON_OFFSET,
      y: el.y + ICON_OFFSET,
      width: ICON_GLYPH,
      height: ICON_GLYPH,
      viewBox: `0 0 ${ICON_GLYPH} ${ICON_GLYPH}`
    });
    const fragment = el.catalogRef ? this.catalog.svg(el.catalogRef) : undefined;
    nested.innerHTML = fragment ?? "";
    return nested;
  }

  private labelText(el: SceneElement): SVGTextElement {
    const text = createSvgElement("text");
    const position = el.label?.position ?? "s";
    const point = { x: el.x + el.w / 2, y: position === "s" ? el.y + el.h + 14 : el.y - 6 };
    setAttrs(text, { x: point.x, y: point.y, fill: this.palette.stroke, "text-anchor": "middle" });
    text.textContent = el.label?.text ?? "";
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
  private renderConnector(g: SVGGElement, el: ConnectorElement, scene: Scene): void {
    const points = connectorPathPoints(scene, el);
    const pointsAttr = toPointsAttr(points);
    const style = CONNECTOR_STYLE[el.connectorType];
    const stroke = el.style?.stroke ?? (el.flowColor ? FLOW_COLORS[el.flowColor] : this.palette.stroke);
    const strokeWidth = el.style?.strokeWidth ?? 1.5;

    if (style.band) {
      for (let i = style.band; i >= 1; i -= 1) {
        const band = createSvgElement("polyline");
        setAttrs(band, {
          points: pointsAttr,
          fill: "none",
          stroke,
          "stroke-opacity": 0.18,
          "stroke-width": strokeWidth + i * 6
        });
        g.appendChild(band);
      }
    }

    const startMarker =
      style.startMarker ??
      (CONNECTION_TYPES.has(el.connectorType) && el.direction === "bidirectional" ? style.endMarker : "none");

    const line = createSvgElement("polyline");
    setAttrs(line, {
      points: pointsAttr,
      fill: "none",
      stroke,
      "stroke-width": strokeWidth,
      "stroke-dasharray": style.dash,
      "marker-start": startMarker !== "none" ? `url(#${MARKER_IDS[startMarker]})` : undefined,
      "marker-end": style.endMarker !== "none" ? `url(#${MARKER_IDS[style.endMarker]})` : undefined
    });
    g.appendChild(line);

    if (style.doubleLine) {
      const parallel = createSvgElement("polyline");
      setAttrs(parallel, {
        points: toPointsAttr(offsetRectilinear(points, 3)),
        fill: "none",
        stroke,
        "stroke-width": strokeWidth,
        "stroke-dasharray": style.dash
      });
      g.appendChild(parallel);
    }

    if (el.label?.text) {
      const mid = pointAtFraction(points, 0.5);
      const text = createSvgElement("text");
      setAttrs(text, { x: mid.x, y: mid.y - 4, fill: this.palette.stroke, "text-anchor": "middle" });
      text.textContent = el.label.text;
      g.appendChild(text);
    }

    if (el.cardinality?.from) g.appendChild(this.cardinalityLabel(points, 0.1, el.cardinality.from));
    if (el.cardinality?.to) g.appendChild(this.cardinalityLabel(points, 0.9, el.cardinality.to));
  }

  private cardinalityLabel(points: Point[], t: number, text: string): SVGTextElement {
    const at = pointAtFraction(points, t);
    const el = createSvgElement("text");
    setAttrs(el, { x: at.x, y: at.y - 4, fill: this.palette.stroke, "text-anchor": "middle", "font-size": 11 });
    el.textContent = text;
    return el;
  }
}
