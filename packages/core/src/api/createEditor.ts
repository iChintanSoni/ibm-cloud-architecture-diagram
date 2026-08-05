import type { Catalog } from "../catalog/catalog.js";
import {
  boundsOf,
  boundsOfElements,
  fitRectWithPadding,
} from "../scene/bounds.js";
import { CONTAINER_CHILD_PADDING_PX } from "../scene/containerPadding.js";
import { CommandBus } from "../commands/commandBus.js";
import {
  addElement,
  alignElements,
  distributeElements,
  autoGrowContainer,
  autoRouteConnector,
  batch,
  hideElements,
  lockElements,
  moveElements,
  removeElement,
  reparentElement,
  retargetConnector,
  setManualWaypoints,
  setZOrder,
  showElements,
  rotateElement,
  unlockElements,
  updateConformance,
  updateElement,
} from "../commands/commands.js";
import type { Command } from "../commands/types.js";
import { reflowChildren } from "../interaction/resize.js";
import { SelectionManager } from "../interaction/selection.js";
import type { SnapGuide } from "../interaction/snapping.js";
import { computeTabOrder } from "../interaction/tabOrder.js";
import { applyIcad, toIcad, type IcadDocument } from "../io/icad.js";
import { exportPng, exportSvg } from "../io/export.js";
import { Linter } from "../linter/linter.js";
import { applyQuickFix, applyQuickFixes } from "../linter/quickFix.js";
import type { Diagnostic, Severity } from "../linter/types.js";
import { portPoint, type Point } from "../render/port.js";
import { SvgRenderer, type ResolvedTheme } from "../render/svgRenderer.js";
import { measureText } from "../render/textMetrics.js";
import { ViewportController } from "../render/viewport.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import { pickPorts } from "../routing/pickPorts.js";
import { routeConnectorInScene } from "../routing/routeConnector.js";
import { Scene, type SceneChangeEvent } from "../scene/scene.js";
import {
  isContainer,
  type ActorElement,
  type BoxElement,
  type CanvasSettings,
  type ConnectorAnnotation,
  type ConnectorDirection,
  type ConnectorElement,
  type ConnectorType,
  type ConformanceSeverity,
  type ElementId,
  type EndpointLabels,
  type FlowColor,
  type ExportGate,
  type FrameElement,
  type GroupElement,
  type IconNodeElement,
  type Label,
  type PortRef,
  type SceneElement,
  type Style,
  type TextElement,
  type ZoneElement,
  type ZoneKind,
} from "../scene/types.js";
import {
  createTemplateDocument,
  type DiagramTemplateId,
} from "../templates/templates.js";
import { generateId } from "../util/id.js";
import { Emitter } from "../util/emitter.js";
import {
  bringForward,
  bringToFront,
  paintOrder,
  sendBackward,
  sendToBack,
  type SiblingReorder,
} from "../scene/zOrder.js";
import { computeAlignMoves, type AlignMode } from "../scene/align.js";
import {
  computeDistributeMoves,
  type DistributeMode,
} from "../scene/distribute.js";

export interface CreateEditorOptions {
  container: HTMLElement;
  catalog: Catalog;
  theme?: CanvasSettings["theme"];
}

export interface PlacementOptions {
  id?: ElementId;
  at: { x: number; y: number };
  w?: number;
  h?: number;
  parentId?: ElementId;
  label?: string;
}

export interface ContainerPlacementOptions extends PlacementOptions {
  catalogRef?: string;
  style?: Style;
}

export interface FramePlacementOptions extends Omit<
  PlacementOptions,
  "label" | "parentId"
> {
  name: string;
  order?: number;
}

/** Editor.connect's options shape, extracted so it's shareable with connectNearest and applyBatch. */
export interface ConnectOptions {
  connectorType?: ConnectorType;
  direction?: ConnectorDirection;
  flowColor?: FlowColor;
  cardinality?: EndpointLabels;
  sequence?: string;
  annotation?: ConnectorAnnotation;
  label?: string;
  id?: ElementId;
}

/** One operation in an Editor.applyBatch() call — see that method's doc comment. */
export type BatchOperation =
  | ({ kind: "add_box" } & ContainerPlacementOptions)
  | ({ kind: "add_group" } & ContainerPlacementOptions)
  | ({ kind: "add_zone" } & ContainerPlacementOptions & { zoneKind?: ZoneKind })
  | ({ kind: "add_actor" } & PlacementOptions & { catalogRef?: string })
  | ({ kind: "add_icon"; catalogRef: string } & PlacementOptions)
  | ({ kind: "add_text" } & Omit<PlacementOptions, "label"> & { text: string })
  | ({ kind: "add_frame" } & FramePlacementOptions)
  | ({ kind: "connect"; from: PortRef; to: PortRef } & ConnectOptions)
  | ({
      kind: "connect_nearest";
      fromId: ElementId;
      toId: ElementId;
    } & ConnectOptions);

export interface BatchOpResult {
  index: number;
  kind: BatchOperation["kind"];
  id: ElementId;
}

export interface BatchOpError {
  index: number;
  kind: BatchOperation["kind"];
  /** Present only if the op declared an explicit id. */
  id?: ElementId;
  message: string;
}

export type BatchResult =
  | { applied: true; results: BatchOpResult[] }
  | { applied: false; errors: BatchOpError[] };

export interface ExportOptions {
  format: "svg" | "png";
  embedSource?: boolean;
  scale?: 1 | 2 | 3;
  background?: "transparent" | "white";
}

export interface ComplianceSummary {
  diagnostics: Diagnostic[];
  counts: Record<Severity, number>;
  blocked: boolean;
}

/** An in-progress ephemeral gesture returned by `Editor.beginInteraction` (D26). */
export interface Interaction {
  /** Applies a scene-space delta as a live preview. Call repeatedly, e.g. once per pointer-move.
   * `dropTargetId` (M17.6, docs/10-canvas-parity-plan.md) is the container currently under the
   * pointer that this drag would reparent into if released now, or `undefined` for none —
   * `CanvasController` recomputes it every move, and only the last value passed in before
   * `commit()` is used. */
  update(dx: number, dy: number, dropTargetId?: ElementId): void;
  /** Dispatches the accumulated delta as one undoable command; no-ops if nothing moved. */
  commit(): void;
  /** Discards the preview and restores the pre-interaction visual state. Never touches the scene. */
  abort(): void;
}

/** An in-progress ephemeral resize gesture returned by `Editor.beginResizeInteraction` (M16.2). */
export interface ResizeInteraction {
  /** Applies a candidate scene-space bbox as a live preview. Call repeatedly, e.g. once per pointer-move. */
  update(geometry: Rect): void;
  /** Dispatches the last-previewed geometry as one undoable command; no-ops if nothing changed. */
  commit(): void;
  /** Discards the preview and restores the pre-interaction visual state. Never touches the scene. */
  abort(): void;
}

/** Editable element fields exposed to UI shells and future agent surfaces. */
export interface ElementPropertiesPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: Label;
  style?: Style;
  catalogRef?: string;
  zoneKind?: ZoneKind;
  text?: string;
  name?: string;
  order?: number;
  connectorType?: ConnectorType;
  direction?: ConnectorDirection;
  flowColor?: FlowColor;
  sequence?: string;
  annotation?: ConnectorAnnotation;
  /** Lock or unlock the element via the Properties panel (M18.4). */
  locked?: boolean;
  /** Hide or show the element via the Properties panel (M18.4). */
  hidden?: boolean;
  /** Opts out of the linter's container-child-padding advisory for a deliberate gutter (M27.6). */
  gutterExempt?: boolean;
  /** Rotation in degrees 0–359; 0 or absent means no rotation (M20). */
  rotation?: number;
}

export class ExportBlockedError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(
      `Export blocked by ${diagnostics.filter((item) => item.severity === "error").length} conformance error(s).`,
    );
    this.name = "ExportBlockedError";
  }
}

const DEFAULT_CONTAINER_SIZE = { w: 240, h: 160 };

/**
 * Pure element builders, one per addX()/connect() method below — each extracted so the same
 * construction logic can be shared with Editor.applyBatch (which needs to build elements without
 * dispatching them individually, see applyBatch's own doc comment) without duplicating it. Every
 * addX()/connect() method itself becomes "build, then dispatch(addElement(...))" — behavior is
 * unchanged, this is purely a lift of the existing object-literal construction into a named
 * function. buildFrameElement is the one exception that takes a Scene explicitly (order's default
 * reads existing frame orders) rather than defaulting from `this.scene` implicitly, so it gives
 * correct distinct orders when called against a batch's scratch scene too.
 */
function buildIconElement(
  catalog: Catalog,
  catalogRef: string,
  opts: PlacementOptions,
): IconNodeElement {
  const meta = catalog.resolve(catalogRef);
  if (!meta) throw new Error(`Unknown catalog icon: "${catalogRef}"`);
  const id = opts.id ?? generateId("icon");
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef,
    x: opts.at.x,
    y: opts.at.y,
    w: 48,
    h: 48,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.label ? { label: { text: opts.label } } : {}),
  };
}

function buildBoxElement(opts: ContainerPlacementOptions): BoxElement {
  const id = opts.id ?? generateId("box");
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: opts.at.x,
    y: opts.at.y,
    w: opts.w ?? DEFAULT_CONTAINER_SIZE.w,
    h: opts.h ?? DEFAULT_CONTAINER_SIZE.h,
    ...(opts.catalogRef ? { catalogRef: opts.catalogRef } : {}),
    ...(opts.style ? { style: opts.style } : {}),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.label ? { label: { text: opts.label } } : {}),
  };
}

function buildGroupElement(opts: ContainerPlacementOptions): GroupElement {
  const id = opts.id ?? generateId("group");
  return {
    id,
    type: "group",
    semantic: "deployedTo",
    x: opts.at.x,
    y: opts.at.y,
    w: opts.w ?? DEFAULT_CONTAINER_SIZE.w,
    h: opts.h ?? DEFAULT_CONTAINER_SIZE.h,
    ...(opts.catalogRef ? { catalogRef: opts.catalogRef } : {}),
    ...(opts.style ? { style: opts.style } : {}),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.label ? { label: { text: opts.label } } : {}),
  };
}

function buildZoneElement(
  opts: ContainerPlacementOptions & { zoneKind?: ZoneKind },
): ZoneElement {
  const id = opts.id ?? generateId("zone");
  return {
    id,
    type: "zone",
    semantic: "boundary",
    zoneKind: opts.zoneKind ?? "az",
    x: opts.at.x,
    y: opts.at.y,
    w: opts.w ?? DEFAULT_CONTAINER_SIZE.w,
    h: opts.h ?? DEFAULT_CONTAINER_SIZE.h,
    ...(opts.catalogRef ? { catalogRef: opts.catalogRef } : {}),
    ...(opts.style ? { style: opts.style } : {}),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.label ? { label: { text: opts.label } } : {}),
  };
}

function buildActorElement(
  opts: PlacementOptions & { catalogRef?: string },
): ActorElement {
  const id = opts.id ?? generateId("actor");
  return {
    id,
    type: "actor",
    semantic: "actor",
    x: opts.at.x,
    y: opts.at.y,
    w: opts.w ?? 48,
    h: opts.h ?? 48,
    ...(opts.catalogRef ? { catalogRef: opts.catalogRef } : {}),
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
    ...(opts.label ? { label: { text: opts.label } } : {}),
  };
}

/** Fallback single-line height for a new text element — h isn't measured (only w is, via
 * measureText below): wrapping/multi-line text elements aren't a concept this builder handles,
 * matching svgRenderer.ts's own unbounded single-line rendering of the "text" element type. */
const DEFAULT_TEXT_ELEMENT_HEIGHT_PX = 20;
/** Floor on an auto-sized text element's width, so a very short or empty string doesn't collapse
 * to a near-zero-width (and thus effectively invisible/unselectable) element. */
const MIN_TEXT_ELEMENT_WIDTH_PX = 20;

function buildTextElement(
  opts: Omit<PlacementOptions, "label"> & { text: string },
): TextElement {
  const id = opts.id ?? generateId("text");
  return {
    id,
    type: "text",
    semantic: "node",
    text: opts.text,
    x: opts.at.x,
    y: opts.at.y,
    // Auto-sized from the actual string (M27.4) rather than a flat guess, so this element's own
    // stored bounding box — used for rotation pivot, hit-testing, and as a hard routing obstacle
    // (routeConnector.ts's obstaclesFor) — reflects where the text really paints instead of an
    // arbitrary constant that's routinely too wide (short strings) or too narrow (long ones).
    w:
      opts.w ??
      Math.max(MIN_TEXT_ELEMENT_WIDTH_PX, Math.ceil(measureText(opts.text))),
    h: opts.h ?? DEFAULT_TEXT_ELEMENT_HEIGHT_PX,
    ...(opts.parentId ? { parentId: opts.parentId } : {}),
  };
}

function buildFrameElement(
  scene: Scene,
  opts: FramePlacementOptions,
): FrameElement {
  const id = opts.id ?? generateId("frame");
  const currentOrders = scene
    .all()
    .filter((element): element is FrameElement => element.type === "frame")
    .map((element) => element.order);
  return {
    id,
    type: "frame",
    semantic: "boundary",
    name: opts.name,
    order: opts.order ?? Math.max(0, ...currentOrders) + 1,
    x: opts.at.x,
    y: opts.at.y,
    w: opts.w ?? 800,
    h: opts.h ?? 500,
  };
}

function buildConnectorBase(
  from: PortRef,
  to: PortRef,
  opts: ConnectOptions,
): ConnectorElement {
  const id = opts.id ?? generateId("conn");
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from,
    to,
    connectorType: opts.connectorType ?? "association",
    routing: "auto",
    ...(opts.direction ? { direction: opts.direction } : {}),
    ...(opts.flowColor ? { flowColor: opts.flowColor } : {}),
    ...(opts.cardinality ? { cardinality: opts.cardinality } : {}),
    ...(opts.sequence ? { sequence: opts.sequence } : {}),
    ...(opts.annotation ? { annotation: opts.annotation } : {}),
    ...(opts.label ? { label: { text: opts.label } } : {}),
  };
}

/**
 * Builds one BatchOperation into a real SceneElement, reading `scratch` (Editor.applyBatch's
 * shadow scene) for anything that needs to resolve another element — connector routing/port-
 * picking, and add_frame's scene-derived `order` default. Throws with a message identifying the
 * problem (unknown element id, unknown catalogRef, self-connect, connector-as-endpoint) rather
 * than returning a fallback, so applyBatch's per-op error collection has something concrete to
 * report; routeConnectorInScene itself stays silent (empty waypoints) on an unresolvable endpoint,
 * so the existence checks below happen before calling it, not after.
 */
function buildBatchElement(
  catalog: Catalog,
  scratch: Scene,
  op: BatchOperation,
): SceneElement {
  switch (op.kind) {
    case "add_box":
      return buildBoxElement(op);
    case "add_group":
      return buildGroupElement(op);
    case "add_zone":
      return buildZoneElement(op);
    case "add_actor":
      return buildActorElement(op);
    case "add_icon":
      return buildIconElement(catalog, op.catalogRef, op);
    case "add_text":
      return buildTextElement(op);
    case "add_frame":
      return buildFrameElement(scratch, op);
    case "connect": {
      if (!scratch.has(op.from.elementId))
        throw new Error(
          `Unknown element "${op.from.elementId}" — no such id in the current document or earlier in this batch.`,
        );
      if (!scratch.has(op.to.elementId))
        throw new Error(
          `Unknown element "${op.to.elementId}" — no such id in the current document or earlier in this batch.`,
        );
      const base = buildConnectorBase(op.from, op.to, op);
      return { ...base, waypoints: routeConnectorInScene(scratch, base) };
    }
    case "connect_nearest": {
      const from = scratch.get(op.fromId);
      const to = scratch.get(op.toId);
      if (!from)
        throw new Error(
          `Unknown element "${op.fromId}" — no such id in the current document or earlier in this batch.`,
        );
      if (!to)
        throw new Error(
          `Unknown element "${op.toId}" — no such id in the current document or earlier in this batch.`,
        );
      if (op.fromId === op.toId)
        throw new Error(`Cannot connect "${op.fromId}" to itself.`);
      if (from.type === "connector" || to.type === "connector")
        throw new Error(
          `Cannot connect "${op.fromId}" to "${op.toId}" — a connector can't be an endpoint of another connector.`,
        );
      const ports = pickPorts(from, to);
      const base = buildConnectorBase(
        { elementId: op.fromId, port: ports.from },
        { elementId: op.toId, port: ports.to },
        op,
      );
      return { ...base, waypoints: routeConnectorInScene(scratch, base) };
    }
  }
}

/** Scene-space offset each successive Ctrl/Cmd+V (with no explicit paste point) or duplicate
 * cascades by — matching the existing 16px buffer convention (`groupElements`'s own default pad),
 * so a stamped-out staircase of pastes/duplicates stays visually distinguishable. */
const PASTE_OFFSET = 16;

/** Mirrors this file's own `addXxx()` id-prefix convention (M16.5) so a pasted/duplicated element's
 * id looks like any other freshly-created one of its type, not a copy-suffixed variant. */
function clonePrefix(type: SceneElement["type"]): string {
  if (type === "iconNode") return "icon";
  if (type === "connector") return "conn";
  return type;
}

function resolveTheme(preference: CanvasSettings["theme"]): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/**
 * The public, framework-agnostic surface of the engine
 * (docs/02-architecture.md#public-api-coreapi). Shells and the future MCP
 * server both drive the editor through this API only.
 */
export class Editor {
  readonly scene: Scene;
  readonly commands: CommandBus;
  readonly selection: SelectionManager;
  readonly catalog: Catalog;
  /** Ephemeral pan/zoom camera — not part of undo history or the `.icad` document. */
  readonly viewport: ViewportController;

  private renderer: SvgRenderer;
  private linter: Linter;
  private changeEmitter = new Emitter<{ change: SceneChangeEvent }>();
  private resizeObserver?: ResizeObserver;
  private focusedId: ElementId | undefined;
  /** In-memory clipboard (M16.5) — deep-cloned elements at copy-time, session-only. Deliberately
   * not the OS clipboard: `apps/vscode`'s webview sandbox makes async `navigator.clipboard`
   * permissioning inconsistent across shells (the same reason M15 skipped PNG export there), and
   * an internal clipboard is trivially keyboard-testable with no permission prompt either way —
   * cross-window paste is out of scope, not an oversight. */
  private clipboard: SceneElement[] = [];
  /** The top-level ids `copy()`/`cut()` were actually given, before expansion to descendants/
   * internal connectors — `paste()` re-selects only these (mapped to their new ids), matching how
   * a drag/nudge only ever "selects" what the user directly acted on. */
  private clipboardRootIds: ElementId[] = [];
  /** Cascades each successive Ctrl/Cmd+V with no explicit paste point a bit further from the
   * original, standard paste behavior; reset whenever the clipboard is replaced. */
  private pasteCount = 0;

  constructor(options: CreateEditorOptions) {
    this.catalog = options.catalog;
    this.scene = new Scene({
      canvas: {
        theme: options.theme ?? "auto",
        grid: 8,
        background: "transparent",
      },
      catalog: { id: options.catalog.id, version: options.catalog.version },
    });
    this.commands = new CommandBus(this.scene);
    this.selection = new SelectionManager();
    this.linter = new Linter({ catalog: this.catalog });
    this.renderer = new SvgRenderer(
      options.container,
      this.catalog,
      resolveTheme(this.scene.canvas.theme),
    );
    this.viewport = new ViewportController();

    this.scene.on((event) => {
      if (this.focusedId && !this.scene.has(this.focusedId))
        this.focusedId = undefined;
      // A coalesced "update"-reason change (Scene._transaction) never added/removed/reparented/
      // reordered anything, so a scoped repaint of just the affected ids is safe and much cheaper
      // than a full render() at diagram scale (C13, docs/10-canvas-parity-plan.md). Every command
      // that could have changed containment or z-order reports a different reason and falls
      // through to the full render() below. Empty ids (e.g. a conformance-only change) needs no
      // element repaint at all — the lint refresh below still runs.
      if (event.ids.length > 0) {
        if (event.reason === "update") this.renderer.renderElements(event.ids);
        else this.renderer.render(this.scene);
      }
      this.renderer.setDiagnostics(this.linter.run(this.scene));
      this.changeEmitter.emit("change", event);
    });
    this.selection.on((ids) => this.renderer.setSelection(ids));
    this.viewport.on((state) => this.renderer.applyViewport(state));
    this.renderer.render(this.scene);
    this.renderer.setDiagnostics(this.linter.run(this.scene));
    this.renderer.applyViewport(this.viewport.get());

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() =>
        this.renderer.applyViewport(this.viewport.get()),
      );
      this.resizeObserver.observe(options.container);
    }
  }

  /** Updates the auto/light/dark preference and repaints the canvas to match. */
  setTheme(preference: CanvasSettings["theme"]): void {
    this.scene.canvas = { ...this.scene.canvas, theme: preference };
    this.renderer.setTheme(resolveTheme(preference));
    this.renderer.render(this.scene);
  }

  loadIcad(input: unknown): void {
    applyIcad(this.scene, input);
    this.commands.clear();
    this.selection.clear();
    this.setTheme(this.scene.canvas.theme);
  }

  /**
   * Replaces the current document with a reusable IBM-level starter template. Pass
   * `{ seedExampleContent: false }` for an empty canvas that still carries the level's
   * `diagramLevel` meta (and so still runs that level's full linter rule set) — see
   * `CreateTemplateDocumentOptions`.
   */
  newDocument(
    templateId: DiagramTemplateId,
    options?: { seedExampleContent?: boolean },
  ): void {
    this.loadIcad(
      createTemplateDocument(templateId, {
        catalog: { id: this.catalog.id, version: this.catalog.version },
        theme: this.scene.canvas.theme,
        ...(options?.seedExampleContent !== undefined
          ? { seedExampleContent: options.seedExampleContent }
          : {}),
      }),
    );
  }

  toIcad(): IcadDocument {
    return toIcad(this.scene);
  }

  addIcon(catalogRef: string, opts: PlacementOptions): ElementId {
    const element = buildIconElement(this.catalog, catalogRef, opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  addBox(opts: ContainerPlacementOptions): ElementId {
    const element = buildBoxElement(opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  addGroup(opts: ContainerPlacementOptions): ElementId {
    const element = buildGroupElement(opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  addZone(
    opts: ContainerPlacementOptions & { zoneKind?: ZoneKind },
  ): ElementId {
    const element = buildZoneElement(opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  addActor(opts: PlacementOptions & { catalogRef?: string }): ElementId {
    const element = buildActorElement(opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  addText(opts: Omit<PlacementOptions, "label"> & { text: string }): ElementId {
    const element = buildTextElement(opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  addFrame(opts: FramePlacementOptions): ElementId {
    const element = buildFrameElement(this.scene, opts);
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  /** Applies an exact presentation order to every frame as one undoable command. */
  reorderFrames(frameIds: ElementId[]): void {
    const frames = this.scene
      .all()
      .filter((element): element is FrameElement => element.type === "frame");
    if (new Set(frameIds).size !== frameIds.length) {
      throw new Error("Frame order cannot contain duplicate ids");
    }
    if (
      frameIds.length !== frames.length ||
      frameIds.some((id) => this.scene.get(id)?.type !== "frame")
    ) {
      throw new Error("Frame order must contain every frame exactly once");
    }
    const commands = frameIds.flatMap((id, index) => {
      const current = this.scene.get(id) as FrameElement;
      const order = index + 1;
      return current.order === order
        ? []
        : [updateElement(this.scene, id, { order })];
    });
    if (commands.length > 0)
      this.commands.dispatch(batch("reorder frames", commands));
  }

  connect(from: PortRef, to: PortRef, opts: ConnectOptions = {}): ElementId {
    const base = buildConnectorBase(from, to, opts);
    const element: ConnectorElement = {
      ...base,
      waypoints: routeConnectorInScene(this.scene, base),
    };
    this.commands.dispatch(addElement(element));
    return element.id;
  }

  /** Overrides a connector's route with explicit waypoints (D13's manual escape hatch). */
  setConnectorWaypoints(
    id: ElementId,
    waypoints: Array<{ x: number; y: number }>,
  ): void {
    this.commands.dispatch(setManualWaypoints(this.scene, id, waypoints));
  }

  /**
   * Live waypoint drag preview (M19) — updates the renderer's preview path without dispatching
   * any command. Pass `null` to clear the preview. Call `setConnectorWaypoints` once to commit.
   */
  previewConnectorWaypoints(
    id: ElementId,
    waypoints: Array<{ x: number; y: number }> | null,
  ): void {
    this.renderer.previewConnectorWaypoints(id, waypoints);
  }

  /** Switches a manually-routed connector back to auto-routing. */
  autoRouteConnector(id: ElementId): void {
    this.commands.dispatch(autoRouteConnector(this.scene, id));
  }

  /**
   * Changes one or both endpoint targets of a connector (M19 endpoint
   * retargeting). Provide the new `from` port-ref, the new `to` port-ref, or
   * both. Auto-routing connectors are re-routed immediately; manual connectors
   * keep their current waypoints.
   */
  retargetConnector(
    id: ElementId,
    from: PortRef | undefined,
    to: PortRef | undefined,
  ): void {
    this.commands.dispatch(retargetConnector(this.scene, id, from, to));
  }

  /**
   * Updates inspector-editable fields as one undo step. Position edits use
   * move-with semantics so nested contents travel with a container; geometry
   * changes continue to reroute attached automatic connectors.
   */
  updateElementProperties(id: ElementId, patch: ElementPropertiesPatch): void {
    const current = this.scene.get(id);
    if (!current) throw new Error(`Cannot update unknown element "${id}"`);

    const commands: Command[] = [];
    const nextX = patch.x ?? current.x;
    const nextY = patch.y ?? current.y;
    const dx = nextX - current.x;
    const dy = nextY - current.y;
    if (dx !== 0 || dy !== 0)
      commands.push(moveElements(this.scene, [id], dx, dy));

    // Rotation is a separate command (normalise + skip-if-equal), not a plain field patch.
    const { x: _x, y: _y, rotation, ...fieldPatch } = patch;
    if (
      rotation !== undefined &&
      current.type !== "connector" &&
      current.type !== "frame"
    ) {
      const norm = ((rotation % 360) + 360) % 360;
      const currentNorm = (((current.rotation ?? 0) % 360) + 360) % 360;
      if (norm !== currentNorm)
        commands.push(rotateElement(this.scene, id, norm));
    }
    if (Object.keys(fieldPatch).length > 0) {
      commands.push(
        updateElement(this.scene, id, fieldPatch as Partial<SceneElement>),
      );
    }

    if (commands.length === 0) return;
    this.commands.dispatch(
      commands.length === 1
        ? commands[0]!
        : batch("update element properties", commands),
    );
  }

  /** Changes containment membership as an undoable editor operation. */
  setElementParent(id: ElementId, parentId: ElementId | undefined): void {
    if (this.scene.get(id)?.parentId === parentId) return;
    if (parentId !== undefined) {
      const parent = this.scene.get(parentId);
      if (!parent) throw new Error(`Cannot use unknown parent "${parentId}"`);
      if (
        parent.type !== "box" &&
        parent.type !== "group" &&
        parent.type !== "zone" &&
        parent.type !== "frame"
      ) {
        throw new Error(`Element "${parentId}" cannot contain other elements`);
      }
    }
    this.commands.dispatch(reparentElement(this.scene, id, parentId));
  }

  lint(): Diagnostic[] {
    const diagnostics = this.linter.run(this.scene);
    this.renderer.setDiagnostics(diagnostics);
    return diagnostics;
  }

  complianceSummary(): ComplianceSummary {
    const diagnostics = this.lint();
    const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
    for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;
    return {
      diagnostics,
      counts,
      blocked:
        this.scene.conformance.exportGate === "block" && counts.error > 0,
    };
  }

  applyQuickFix(diagnostic: Diagnostic): boolean {
    if (!diagnostic.quickFix) return false;
    this.commands.dispatch(applyQuickFix(diagnostic));
    return true;
  }

  applyQuickFixes(ruleId?: string): number {
    const diagnostics = this.lint().filter(
      (diagnostic) =>
        diagnostic.quickFix &&
        (ruleId === undefined || diagnostic.ruleId === ruleId),
    );
    if (diagnostics.length === 0) return 0;
    this.commands.dispatch(
      applyQuickFixes(
        diagnostics,
        ruleId ? `fix all ${ruleId} issues` : "fix all validation issues",
      ),
    );
    return diagnostics.length;
  }

  setExportGate(exportGate: ExportGate): void {
    this.commands.dispatch(updateConformance(this.scene, { exportGate }));
  }

  setRuleSeverity(ruleId: string, severity?: ConformanceSeverity): void {
    this.commands.dispatch(
      updateConformance(this.scene, {
        ruleSeverity: {
          ruleId,
          ...(severity !== undefined ? { severity } : {}),
        },
      }),
    );
  }

  export(opts: ExportOptions & { format: "svg" }): Promise<string>;
  export(opts: ExportOptions & { format: "png" }): Promise<Blob>;
  export(opts: ExportOptions): Promise<string> | Promise<Blob> {
    const summary = this.complianceSummary();
    if (summary.blocked) throw new ExportBlockedError(summary.diagnostics);
    if (opts.format === "svg") {
      return exportSvg(this.scene, this.renderer, {
        ...(opts.embedSource !== undefined
          ? { embedSource: opts.embedSource }
          : {}),
      });
    }
    return exportPng(this.scene, this.renderer, {
      ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
      ...(opts.background !== undefined ? { background: opts.background } : {}),
    });
  }

  on(listener: (event: SceneChangeEvent) => void): () => void {
    return this.changeEmitter.on("change", listener);
  }

  onSelectionChange(listener: (ids: ElementId[]) => void): () => void {
    return this.selection.on(listener);
  }

  /** Scene-space bounding box of one or more elements (containers include their contents). */
  boundsOf(ids: ElementId[]): Rect | undefined {
    return boundsOf(this.scene, ids);
  }

  /**
   * Pans/zooms the viewport to frame the given elements — used by Find
   * (docs/06-editor-ux.md#find-on-canvas-f) and frame presentation
   * (docs/06-editor-ux.md#frames-sections--presentation).
   */
  focusOnElements(
    ids: ElementId[],
    opts?: { padding?: number; maxScale?: number },
  ): void {
    const rect = this.boundsOf(ids);
    if (!rect) return;
    this.viewport.focusOn(rect, this.renderer.containerSize(), opts);
  }

  /** Fits the viewport to the whole diagram's current extent. */
  fitToContent(opts?: { padding?: number; maxScale?: number }): void {
    this.focusOnElements(
      this.scene.all().map((el) => el.id),
      opts,
    );
  }

  zoomIn(): void {
    const size = this.renderer.containerSize();
    this.viewport.zoomBy(1.2, this.sceneCenter(size));
  }

  zoomOut(): void {
    const size = this.renderer.containerSize();
    this.viewport.zoomBy(1 / 1.2, this.sceneCenter(size));
  }

  resetView(): void {
    this.viewport.reset();
  }

  private sceneCenter(size: { w: number; h: number }): {
    x: number;
    y: number;
  } {
    const { x, y, scale } = this.viewport.get();
    return { x: x + size.w / (2 * scale), y: y + size.h / (2 * scale) };
  }

  /**
   * Meaningful keyboard tab order (docs/07-accessibility.md#canvas-the-hard-20):
   * containers before children, siblings west→east, connectors last.
   */
  tabOrder(): ElementId[] {
    return computeTabOrder(this.scene).map((el) => el.id);
  }

  /**
   * The element keyboard focus is currently on — independent of `selection`.
   * Tab/Shift+Tab move this without changing what's selected (so a screen
   * reader's "active descendant" and the app's "what nudge/delete/Properties
   * act on" can differ, e.g. while building a multi-selection with
   * Shift+Space); Enter/Space act on whatever this currently points at.
   */
  focusedElement(): ElementId | undefined {
    return this.focusedId;
  }

  /** Moves real DOM focus (and the roving tabindex) to `id` without touching `selection`. */
  focusElement(id: ElementId): void {
    if (!this.scene.has(id)) return;
    this.focusedId = id;
    this.renderer.focusElement(id);
  }

  /** Moves keyboard focus to the next element in tab order, wrapping around. */
  focusNext(): void {
    this.stepFocus(1);
  }

  /** Moves keyboard focus to the previous element in tab order, wrapping around. */
  focusPrevious(): void {
    this.stepFocus(-1);
  }

  private stepFocus(direction: 1 | -1): void {
    const order = this.tabOrder();
    if (order.length === 0) return;
    const currentIndex = this.focusedId ? order.indexOf(this.focusedId) : -1;
    const base =
      currentIndex === -1 ? (direction === 1 ? -1 : 0) : currentIndex;
    const nextIndex =
      (((base + direction) % order.length) + order.length) % order.length;
    const nextId = order[nextIndex]!;
    this.focusElement(nextId);
    this.ensureVisible(nextId);
  }

  /** Pans/zooms only if `id` isn't already fully inside the current viewport, to avoid jarring re-centering. */
  ensureVisible(id: ElementId): void {
    const bbox = this.boundsOf([id]);
    if (!bbox) return;
    const { x, y, scale } = this.viewport.get();
    const size = this.renderer.containerSize();
    const visible = { x, y, w: size.w / scale, h: size.h / scale };
    const contained =
      bbox.x >= visible.x &&
      bbox.y >= visible.y &&
      bbox.x + bbox.w <= visible.x + visible.w &&
      bbox.y + bbox.h <= visible.y + visible.h;
    if (!contained) this.focusOnElements([id]);
  }

  /** Nudges every given element by a scene-space delta (e.g. an arrow-key press), reusing move-with
   * semantics — the keyboard equivalent of a mouse drag (M16.1), so it shares that gesture's own
   * auto-grow behavior too (`commitMove`, M17.4). */
  nudgeElements(ids: ElementId[], dx: number, dy: number): void {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0 || (dx === 0 && dy === 0)) return;
    this.commitMove(existing, dx, dy);
  }

  /**
   * Dispatches a committed move as one undo step — shared by `nudgeElements` and
   * `beginInteraction()`'s own `commit()`. With no `dropTargetId`, grows the moved elements' shared
   * parent to fit afterward if it no longer comfortably contains them (M17.4,
   * docs/10-canvas-parity-plan.md); this only applies when every one of `ids` shares the same
   * defined parent (an ambiguous multi-parent selection, or top-level elements with no parent at
   * all, simply skips it — there's no single container to grow). With one, reparents every one of
   * `ids` into it instead (M17.6) and grows *that* container to fit — `CanvasController` has
   * already confirmed it differs from their current shared parent and isn't one of `ids` or their
   * own descendant (a cycle `reparentElement` would otherwise throw on) before ever setting it.
   * `autoGrowContainer`'s own `do()` reads the *current* scene fresh, so batching it last means it
   * naturally sees the move/reparent already applied.
   */
  private commitMove(
    ids: ElementId[],
    dx: number,
    dy: number,
    dropTargetId?: ElementId,
  ): void {
    const commands: Command[] = [moveElements(this.scene, ids, dx, dy)];
    if (dropTargetId !== undefined) {
      for (const id of ids)
        commands.push(reparentElement(this.scene, id, dropTargetId));
      commands.push(autoGrowContainer(this.scene, dropTargetId));
    } else {
      const parentId = this.scene.sharedParentId(ids);
      if (parentId !== undefined)
        commands.push(autoGrowContainer(this.scene, parentId));
    }
    this.commands.dispatch(
      commands.length === 1 ? commands[0]! : batch("move elements", commands),
    );
  }

  /**
   * Begins an ephemeral move interaction — a live drag preview (D26, docs/00-decision-log.md)
   * that bypasses the scene, the command bus, and the linter until `commit()`. Every `update()`
   * call is a plain SVG attribute write (`SvgRenderer.previewTransform`), so a gesture never
   * floods undo history or re-runs the linter per pointer-move; `commit()` collapses the whole
   * gesture into the exact same `moveElements` command `nudgeElements` above already uses, so
   * move-with and connector-reroute-on-commit semantics are identical, not reimplemented.
   * `ids` may be a partial selection (e.g. just a dragged container) — descendants are resolved
   * and previewed too, since elements are flat DOM siblings that don't inherit a parent's
   * transform (see `previewTransform`'s own doc comment). `commit()` no longer clamps the move to
   * the dragged elements' own parent's 16px inset the way it used to (M15–M16.1): `snapMove` (the
   * gesture's own caller, `CanvasController`) stopped doing that in M17.4, and `commit()` grows the
   * parent to fit instead (`commitMove`) — "auto-grow... instead of letting it escape," not
   * "refuse to overlap and get stuck."
   */
  beginInteraction(ids: ElementId[]): Interaction {
    const existing = ids.filter((id) => this.scene.has(id));
    const targets = new Set(existing);
    for (const id of existing) {
      for (const descendant of this.scene.descendantsOf(id))
        targets.add(descendant.id);
    }
    const previewIds = [...targets];
    let dx = 0;
    let dy = 0;
    let dropTargetId: ElementId | undefined;

    return {
      update: (nextDx, nextDy, nextDropTargetId) => {
        dx = nextDx;
        dy = nextDy;
        dropTargetId = nextDropTargetId;
        this.renderer.previewTransform(previewIds, dx, dy);
      },
      commit: () => {
        this.renderer.previewTransform(previewIds, 0, 0);
        // Reparenting (M17.6) counts as a real change even on a net-zero delta (rare — e.g. a
        // drag that lands back at its start point while still over a different container) —
        // dropTargetId already excludes the elements' own current shared parent
        // (CanvasController's own check), so "set" here always means "actually different."
        const reparenting =
          dropTargetId !== undefined &&
          dropTargetId !== this.scene.sharedParentId(existing);
        if (existing.length > 0 && (dx !== 0 || dy !== 0 || reparenting)) {
          this.commitMove(
            existing,
            dx,
            dy,
            reparenting ? dropTargetId : undefined,
          );
        }
      },
      abort: () => {
        this.renderer.previewTransform(previewIds, 0, 0);
      },
    };
  }

  /**
   * Begins an ephemeral resize interaction (M16.2, docs/10-canvas-parity-plan.md) — a live
   * preview via `SvgRenderer.previewResize()` that bypasses the scene, the command bus, and the
   * linter until `commit()`. Unlike `beginInteraction()`'s move, this deliberately does **not**
   * use move-with/`moveElements`: an edge/corner handle that shifts the element's own x or y (e.g.
   * dragging the west edge) must not cascade that shift onto descendants the way a real move does
   * — only the resized element's own geometry changes directly, so this dispatches a bare
   * `updateElement` patch for it rather than `moveElements`. Parent-inset clamping (M17.3) is the
   * caller's job (`CanvasController` applies `clampRectToParentInset` before calling `update()`),
   * mirroring how `beginInteraction()`'s own move preview takes whatever delta `CanvasController`
   * already ran through `snapMove` — this method previews exactly the geometry it's given either
   * way. `commit()` additionally reflows any direct children back inside the new bounds (M17.4's
   * own "auto-grow" for a *dragged child* has a resize counterpart here: shrinking a container
   * pulls its children back in, `reflowChildren`, rather than letting them poke out or growing the
   * container back) as extra `updateElement` patches in the same batch — still one undo step,
   * children included.
   */
  beginResizeInteraction(id: ElementId): ResizeInteraction {
    const original = this.scene.get(id);
    let latest: Rect | undefined;
    return {
      update: (geometry) => {
        latest = geometry;
        this.renderer.previewResize(id, geometry);
      },
      commit: () => {
        this.renderer.previewResize(id, null);
        if (
          !original ||
          !latest ||
          (latest.x === original.x &&
            latest.y === original.y &&
            latest.w === original.w &&
            latest.h === original.h)
        ) {
          return;
        }
        const commands: Command[] = [updateElement(this.scene, id, latest)];
        const children = this.scene.childrenOf(id);
        if (children.length > 0) {
          const patches = reflowChildren(children, latest);
          for (const [childId, patch] of patches) {
            commands.push(updateElement(this.scene, childId, patch));
          }
        }
        this.commands.dispatch(
          commands.length === 1
            ? commands[0]!
            : batch("resize element", commands),
        );
      },
      abort: () => {
        this.renderer.previewResize(id, null);
      },
    };
  }

  /** Deletes the given elements — and everything nested inside them — as one undoable step. */
  deleteElements(ids: ElementId[]): void {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0) return;
    const commands = existing.map((id) => removeElement(this.scene, id));
    this.commands.dispatch(
      commands.length === 1 ? commands[0]! : batch("delete elements", commands),
    );
    this.selection.clear();
  }

  /**
   * `ids` plus every descendant (move-with's own containment expansion) plus any connector whose
   * *both* endpoints land in that expanded set — a connector between two copied icons should
   * follow them, but one crossing the copy boundary (only one endpoint inside) can't sensibly be
   * duplicated, so it's left out. Connectors aren't reached by `descendantsOf` on their own (they
   * aren't nested via `parentId`), hence the separate pass.
   */
  private collectCopySet(ids: ElementId[]): SceneElement[] {
    const targets = new Set<ElementId>();
    for (const id of ids) {
      if (!this.scene.has(id)) continue;
      targets.add(id);
      for (const descendant of this.scene.descendantsOf(id))
        targets.add(descendant.id);
    }
    for (const el of this.scene.all()) {
      if (
        el.type === "connector" &&
        targets.has(el.from.elementId) &&
        targets.has(el.to.elementId)
      ) {
        targets.add(el.id);
      }
    }
    return [...targets].map((id) => this.scene.get(id)!);
  }

  /**
   * Clones `source` with fresh ids, shifted by `offset` — shared by `paste()` and
   * `duplicateElements()`. An internal reference (a cloned element's `parentId`, or a cloned
   * connector's `from`/`to`) remaps to the new id only if the referenced element was *also* part
   * of `source`; otherwise it's left pointing at the original still-live element — copying a lone
   * child without its container re-parents the copy under that same original container, exactly
   * like copying a connector without its endpoints keeps it attached to the same real elements.
   * Returns an undoable `Command` plus the id map so callers can translate specific source ids
   * (e.g. the original top-level selection) forward to their pasted counterparts.
   */
  private cloneElementsForPaste(
    source: SceneElement[],
    offset: { dx: number; dy: number },
  ): { command: Command; idMap: Map<ElementId, ElementId> } {
    const idMap = new Map<ElementId, ElementId>();
    for (const el of source) idMap.set(el.id, generateId(clonePrefix(el.type)));

    const cloned: SceneElement[] = source.map((el) => {
      const newId = idMap.get(el.id)!;
      const parentId = el.parentId
        ? (idMap.get(el.parentId) ?? el.parentId)
        : el.parentId;
      if (el.type === "connector") {
        return {
          ...el,
          id: newId,
          parentId,
          from: {
            ...el.from,
            elementId: idMap.get(el.from.elementId) ?? el.from.elementId,
          },
          to: {
            ...el.to,
            elementId: idMap.get(el.to.elementId) ?? el.to.elementId,
          },
          waypoints: el.waypoints?.map((p) => ({
            x: p.x + offset.dx,
            y: p.y + offset.dy,
          })),
        } as SceneElement;
      }
      return {
        ...el,
        id: newId,
        parentId,
        x: el.x + offset.dx,
        y: el.y + offset.dy,
      } as SceneElement;
    });
    const newIds = cloned.map((el) => el.id);

    const command: Command = {
      label: "paste",
      do: (s) => {
        for (const el of cloned) s._put(el, "add");
        // Auto-routed connectors are re-routed against the now-inserted clones (obstacle
        // avoidance needs the real scene); a manual connector keeps the shifted waypoints above.
        for (const el of cloned) {
          if (el.type === "connector" && el.routing !== "manual") {
            s._put(
              { ...el, waypoints: routeConnectorInScene(s, el) },
              "update",
            );
          }
        }
      },
      undo: (s) => {
        for (const id of newIds) s._remove(id);
      },
    };
    return { command, idMap };
  }

  /** Whether `paste()` would do anything right now — e.g. a shell's context menu disabling its own
   * "Paste" entry rather than rendering one that's a guaranteed no-op. */
  canPaste(): boolean {
    return this.clipboard.length > 0;
  }

  /**
   * Snapshots `ids` (expanded to descendants + internal connectors) into the in-memory clipboard,
   * ready for `paste()` — no-ops (leaving any existing clipboard contents untouched) if none of
   * `ids` still exist.
   */
  copy(ids: ElementId[]): SceneElement[] {
    const roots = ids.filter((id) => this.scene.has(id));
    const set = this.collectCopySet(roots);
    if (set.length === 0) return [];
    this.clipboard = set.map((el) => structuredClone(el));
    this.clipboardRootIds = roots;
    this.pasteCount = 0;
    return this.clipboard;
  }

  /** Copies, then deletes the originals as one undoable step (the copy itself isn't undo history). */
  cut(ids: ElementId[]): SceneElement[] {
    const copied = this.copy(ids);
    if (copied.length === 0) return [];
    this.deleteElements(this.clipboardRootIds);
    return copied;
  }

  /**
   * Clones the clipboard into the scene as one undoable step and selects the new copies — no-ops
   * if nothing's been copied yet. `at`, if given, centers the pasted content's combined bounding
   * box there (mouse-driven "paste at cursor," `CanvasController`'s own last-tracked pointer
   * point); omitted, each successive press cascades `PASTE_OFFSET` further from the original
   * (standard paste behavior), so pure-keyboard use — no pointer position to speak of — still
   * produces a sensible, distinguishable stack.
   */
  paste(at?: Point): ElementId[] {
    if (this.clipboard.length === 0) return [];
    let dx: number;
    let dy: number;
    if (at) {
      const bbox = boundsOfElements(this.clipboard);
      dx = bbox ? at.x - (bbox.x + bbox.w / 2) : 0;
      dy = bbox ? at.y - (bbox.y + bbox.h / 2) : 0;
    } else {
      this.pasteCount += 1;
      dx = PASTE_OFFSET * this.pasteCount;
      dy = PASTE_OFFSET * this.pasteCount;
    }
    const { command, idMap } = this.cloneElementsForPaste(this.clipboard, {
      dx,
      dy,
    });
    this.commands.dispatch(command);
    const newRootIds = this.clipboardRootIds
      .map((id) => idMap.get(id))
      .filter((id): id is ElementId => id !== undefined);
    this.selection.set(newRootIds);
    return newRootIds;
  }

  /**
   * Clones `ids` (expanded to descendants + internal connectors) in place, offset by
   * `PASTE_OFFSET`, as one undoable step, and selects the new copies — deliberately independent of
   * `copy()`/`cut()`/`paste()`'s clipboard, so duplicating doesn't clobber whatever's pending
   * there for a later paste elsewhere. Also `CanvasController`'s Alt-drag-clone (M16.5): the drag
   * itself re-targets onto these returned ids instead of the originals, so the originals stay put.
   */
  duplicateElements(ids: ElementId[]): ElementId[] {
    const roots = ids.filter((id) => this.scene.has(id));
    const set = this.collectCopySet(roots);
    if (set.length === 0) return [];
    const { command, idMap } = this.cloneElementsForPaste(set, {
      dx: PASTE_OFFSET,
      dy: PASTE_OFFSET,
    });
    this.commands.dispatch(command);
    const newRootIds = roots.map((id) => idMap.get(id)!);
    this.selection.set(newRootIds);
    return newRootIds;
  }

  /**
   * Groups 2+ elements into a new Group container sized to their combined
   * bounds (+ padding), reparenting all of them into it as one undoable step
   * (docs/06-editor-ux.md#core-interactions). Nests the new group under the
   * elements' shared parent when they all have the same one, otherwise the
   * group lands at canvas root. Selects the new group. No-ops (returns
   * undefined) for fewer than two known elements.
   */
  groupElements(
    ids: ElementId[],
    opts: { padding?: number } = {},
  ): ElementId | undefined {
    const existing = [...new Set(ids)].filter((id) => this.scene.has(id));
    if (existing.length < 2) return undefined;
    const bbox = this.boundsOf(existing);
    if (!bbox) return undefined;

    const padding = opts.padding ?? CONTAINER_CHILD_PADDING_PX;
    const parents = new Set(existing.map((id) => this.scene.get(id)!.parentId));
    const parentId = parents.size === 1 ? [...parents][0] : undefined;

    // Shares its bbox+padding sizing with `autoFitContainer` (M17.4) — no `existing` rect here
    // since the group doesn't exist in the scene yet, so this is purely "fit the contents."
    const fitted = fitRectWithPadding(bbox, padding);
    const groupId = generateId("group");
    const group: GroupElement = {
      id: groupId,
      type: "group",
      semantic: "deployedTo",
      ...fitted,
      ...(parentId ? { parentId } : {}),
    };

    const commands: Command[] = [
      addElement(group),
      ...existing.map((id) => reparentElement(this.scene, id, groupId)),
      // Without this, the new group (added with no explicit z, tied at 0 with everything else)
      // paints *over* the members it was just built to contain — Map insertion order puts a
      // just-added element last, and containerFill() is always opaque (docs/10-canvas-parity-plan.md
      // M18). No overrides needed: setZOrder's do() recomputes paintOrder() fresh once this batch's
      // earlier add/reparent sub-commands have actually run, so it sees the group's real containment.
      setZOrder(this.scene, undefined, "group elements"),
    ];
    this.commands.dispatch(batch("group elements", commands));
    this.selection.set([groupId]);
    return groupId;
  }

  /**
   * Removes a container but keeps its contents, reparenting them to the
   * container's own parent as one undoable step, then selects the freed
   * elements. No-ops for an unknown id or a non-container element.
   */
  ungroupElement(id: ElementId): void {
    const container = this.scene.get(id);
    if (!container || !isContainer(container)) return;
    const children = this.scene.childrenOf(id);
    const parentId = container.parentId;
    const originalChildren = children.map((child) => ({ ...child }));

    // Hand-written rather than composed from reparentElement + removeElement: the latter's
    // cascading delete snapshots descendants at *construction* time, which would still be
    // [container, ...children] before the reparents below ever run, deleting the children too.
    const command: Command = {
      label: "ungroup",
      do(s) {
        for (const child of children) {
          const current = s.get(child.id);
          if (!current) continue;
          const next = { ...current, parentId } as SceneElement;
          if (parentId === undefined) delete next.parentId;
          s._put(next, "update");
        }
        s._remove(container.id);
      },
      undo(s) {
        s._put(container, "add");
        for (const original of originalChildren) s._put(original, "update");
      },
    };
    this.commands.dispatch(command);
    this.selection.set(children.map((child) => child.id));
  }

  /**
   * Shared plumbing for the four z-order commands below (docs/10-canvas-parity-plan.md M18).
   * `reorder` is applied per sibling bracket (elements sharing a parent) among `ids`, never
   * globally — the renderer paints one flat, non-nested list (`scene.all()`), so a global z change
   * on a container could push it in front of its own descendants; scoping to siblings makes that
   * structurally impossible. Returns `false` on a no-op (empty/unknown selection, or already at
   * the requested position) so callers can skip a live-region announcement, mirroring how
   * `ungroupElement`'s own no-op is guarded at the call site.
   */
  private applyZOrder(
    ids: ElementId[],
    label: string,
    reorder: SiblingReorder,
  ): boolean {
    const selected = new Set(ids.filter((id) => this.scene.has(id)));
    if (selected.size === 0) return false;
    const overrides = new Map<ElementId | undefined, ElementId[]>();
    for (const parentId of new Set(
      [...selected].map((id) => this.scene.get(id)!.parentId),
    )) {
      const bracket = this.scene
        .all()
        .filter((el) => el.parentId === parentId)
        .map((el) => el.id);
      overrides.set(parentId, reorder(bracket, selected));
    }
    const order = paintOrder(this.scene, overrides);
    if (order.every((id, index) => this.scene.get(id)?.z === index))
      return false;
    this.commands.dispatch(setZOrder(this.scene, overrides, label));
    return true;
  }

  /** Moves every selected element to the front of its own sibling bracket. */
  bringToFront(ids: ElementId[]): boolean {
    return this.applyZOrder(ids, "bring to front", bringToFront);
  }

  /** Moves every selected element to the back of its own sibling bracket. */
  sendToBack(ids: ElementId[]): boolean {
    return this.applyZOrder(ids, "send to back", sendToBack);
  }

  /** Steps every selected element one position toward the front of its own sibling bracket. */
  bringForward(ids: ElementId[]): boolean {
    return this.applyZOrder(ids, "bring forward", bringForward);
  }

  /** Steps every selected element one position toward the back of its own sibling bracket. */
  sendBackward(ids: ElementId[]): boolean {
    return this.applyZOrder(ids, "send backward", sendBackward);
  }

  /**
   * Shared plumbing for the six align commands (M18.2, docs/10-canvas-parity-plan.md). Computes
   * every alignable element's move via `computeAlignMoves` (which itself excludes connectors and
   * already-aligned elements) and, on a no-op (fewer than two alignable elements, or nothing that
   * actually moves), skips the dispatch and returns `false` so callers can skip a live-region
   * announcement — same convention `applyZOrder` above uses.
   */
  private applyAlign(
    ids: ElementId[],
    mode: AlignMode,
    label: string,
  ): boolean {
    const moves = computeAlignMoves(this.scene, ids, mode);
    if (moves.length === 0) return false;
    this.commands.dispatch(alignElements(this.scene, moves, label));
    return true;
  }

  /** Aligns every selected element's left edge to the selection's own leftmost edge. */
  alignLeft(ids: ElementId[]): boolean {
    return this.applyAlign(ids, "left", "align left");
  }

  /** Aligns every selected element's horizontal center to the selection's own horizontal center. */
  alignCenterHorizontal(ids: ElementId[]): boolean {
    return this.applyAlign(ids, "centerH", "align center");
  }

  /** Aligns every selected element's right edge to the selection's own rightmost edge. */
  alignRight(ids: ElementId[]): boolean {
    return this.applyAlign(ids, "right", "align right");
  }

  /** Aligns every selected element's top edge to the selection's own topmost edge. */
  alignTop(ids: ElementId[]): boolean {
    return this.applyAlign(ids, "top", "align top");
  }

  /** Aligns every selected element's vertical center to the selection's own vertical center. */
  alignMiddle(ids: ElementId[]): boolean {
    return this.applyAlign(ids, "middle", "align middle");
  }

  /** Aligns every selected element's bottom edge to the selection's own bottommost edge. */
  alignBottom(ids: ElementId[]): boolean {
    return this.applyAlign(ids, "bottom", "align bottom");
  }

  private applyDistribute(
    ids: ElementId[],
    mode: DistributeMode,
    label: string,
  ): boolean {
    const moves = computeDistributeMoves(this.scene, ids, mode);
    if (moves.length === 0) return false;
    this.commands.dispatch(distributeElements(this.scene, moves, label));
    return true;
  }

  /** Distributes selected elements so horizontal gaps between them are equal.
   * Anchors the leftmost and rightmost elements; requires at least three
   * distributable (non-connector) elements. */
  distributeHorizontal(ids: ElementId[]): boolean {
    return this.applyDistribute(ids, "horizontal", "distribute horizontal");
  }

  /** Distributes selected elements so vertical gaps between them are equal.
   * Anchors the topmost and bottommost elements; requires at least three
   * distributable (non-connector) elements. */
  distributeVertical(ids: ElementId[]): boolean {
    return this.applyDistribute(ids, "vertical", "distribute vertical");
  }

  // ── Lock / Hide (M18.4, docs/10-canvas-parity-plan.md) ─────────────────────

  /**
   * Locks the given elements (and all their descendants) — prevents drag, resize,
   * reparent, and delete via the UI. Returns `true` when at least one element was
   * actually changed (some weren't already locked). Skips already-locked ids.
   */
  lockElements(ids: ElementId[]): boolean {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0) return false;
    const allIds = new Set(existing);
    for (const id of existing) {
      for (const d of this.scene.descendantsOf(id)) allIds.add(d.id);
    }
    const anyChange = [...allIds].some((id) => !this.scene.get(id)?.locked);
    if (!anyChange) return false;
    this.commands.dispatch(lockElements(this.scene, existing));
    return true;
  }

  /**
   * Unlocks the given elements (and all their descendants). Returns `true` when
   * at least one element was actually changed.
   */
  unlockElements(ids: ElementId[]): boolean {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0) return false;
    const allIds = new Set(existing);
    for (const id of existing) {
      for (const d of this.scene.descendantsOf(id)) allIds.add(d.id);
    }
    const anyChange = [...allIds].some((id) => this.scene.get(id)?.locked);
    if (!anyChange) return false;
    this.commands.dispatch(unlockElements(this.scene, existing));
    return true;
  }

  /**
   * Hides the given elements (and all their descendants). Returns `true` when at
   * least one element was actually changed.
   */
  hideElements(ids: ElementId[]): boolean {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0) return false;
    const allIds = new Set(existing);
    for (const id of existing) {
      for (const d of this.scene.descendantsOf(id)) allIds.add(d.id);
    }
    const anyChange = [...allIds].some((id) => !this.scene.get(id)?.hidden);
    if (!anyChange) return false;
    this.commands.dispatch(hideElements(this.scene, existing));
    return true;
  }

  /**
   * Shows the given elements (and all their descendants). Returns `true` when at
   * least one element was actually changed.
   */
  showElements(ids: ElementId[]): boolean {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0) return false;
    const allIds = new Set(existing);
    for (const id of existing) {
      for (const d of this.scene.descendantsOf(id)) allIds.add(d.id);
    }
    const anyChange = [...allIds].some((id) => this.scene.get(id)?.hidden);
    if (!anyChange) return false;
    this.commands.dispatch(showElements(this.scene, existing));
    return true;
  }

  /**
   * Rotates a single element to `degrees` (0–359, normalised). Connectors and Frames are excluded
   * — connectors derive their shape entirely from endpoints + routing, and Frame is excluded from
   * all direct-manipulation operations. Returns `false` if the element doesn't exist, is a
   * connector or frame, or is already at the target rotation (M20, docs/10-canvas-parity-plan.md).
   */
  rotateElement(id: ElementId, degrees: number): boolean {
    const el = this.scene.get(id);
    if (!el || el.type === "connector" || el.type === "frame") return false;
    const normalised = ((degrees % 360) + 360) % 360;
    const current = el.rotation ?? 0;
    const currentNorm = ((current % 360) + 360) % 360;
    if (normalised === currentNorm) return false;
    this.commands.dispatch(rotateElement(this.scene, id, normalised));
    return true;
  }

  /**
   * Connects two elements without requiring exact ports — picks a reasonable
   * port pair from their relative position (`pickPorts`) — for mouse
   * drag-to-connect and keyboard connect mode alike
   * (docs/06-editor-ux.md#core-interactions).
   */
  connectNearest(
    fromId: ElementId,
    toId: ElementId,
    opts: {
      connectorType?: ConnectorType;
      direction?: ConnectorDirection;
      flowColor?: FlowColor;
      cardinality?: EndpointLabels;
      sequence?: string;
      annotation?: ConnectorAnnotation;
      label?: string;
    } = {},
  ): ElementId | undefined {
    const from = this.scene.get(fromId);
    const to = this.scene.get(toId);
    if (
      !from ||
      !to ||
      from.type === "connector" ||
      to.type === "connector" ||
      fromId === toId
    )
      return undefined;
    const ports = pickPorts(from, to);
    const id = this.connect(
      { elementId: fromId, port: ports.from },
      { elementId: toId, port: ports.to },
      opts,
    );
    this.selection.set([id]);
    return id;
  }

  /**
   * Adds several elements and/or connectors as one call and one undo step — for building a whole
   * diagram section at once instead of one addX()/connect() call per element (docs/09-roadmap.md
   * M23.4). All-or-nothing: every op is validated against a disposable scratch Scene (seeded with
   * a copy of the real one) before anything touches the real scene or dispatches anything, so a
   * connect op can reference an element added earlier in the same batch (the scratch scene sees it
   * by the time later ops are validated) while still giving a hard atomicity guarantee — if any op
   * is invalid, nothing is applied and every failing op is reported, not just the first.
   *
   * Deliberately not "dispatch each command via CommandBus.dispatch as constructed, coalesce into
   * one undo entry after the fact": CommandBus only pushes an undo entry once a dispatch completes
   * without throwing, so a command whose own scene-reading logic (routing, port-picking) is
   * deferred to do()-time against the *real* scene would, if it threw partway through a batch,
   * leave the real scene silently and partially mutated with no undo entry to revert it. Building
   * against a scratch scene first avoids that failure mode entirely — nothing real is touched
   * until every op has already proven it will succeed.
   *
   * An op that needs to be referenced by a later op in the same batch (a connect endpoint, or a
   * child's parentId) must be given an explicit id — there's no "local index" placeholder
   * resolution.
   */
  applyBatch(ops: BatchOperation[]): BatchResult {
    if (ops.length === 0) return { applied: true, results: [] };

    const scratch = new Scene();
    scratch._replaceAll(this.scene.all());

    const commands: Command[] = [];
    const results: BatchOpResult[] = [];
    const errors: BatchOpError[] = [];

    ops.forEach((op, index) => {
      try {
        const element = buildBatchElement(this.catalog, scratch, op);
        if (scratch.has(element.id)) {
          throw new Error(
            `Duplicate id "${element.id}" — already used by a pre-existing element or an earlier operation in this batch.`,
          );
        }
        scratch._put(element, "add");
        commands.push(addElement(element));
        results.push({ index, kind: op.kind, id: element.id });
      } catch (err) {
        errors.push({
          index,
          kind: op.kind,
          ...("id" in op && op.id ? { id: op.id } : {}),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    if (errors.length > 0) return { applied: false, errors };

    this.commands.dispatch(batch("scene_apply", commands));
    return { applied: true, results };
  }

  /** Reveals (or hides, when omitted) port markers on an element — hover for mouse, or the source while keyboard-connecting. */
  setHoveredElement(id?: ElementId): void {
    this.renderer.setHoveredElement(id);
  }

  /** Rubber-band preview at arbitrary scene points — mouse drag-to-connect, before a drop target is known. */
  setConnectorDraftPoints(from: Point, to: Point): void {
    this.renderer.setConnectorDraft(from, to);
  }

  /** Rubber-band preview snapped to two elements' nearest ports — keyboard connect mode. */
  previewConnectorBetween(fromId: ElementId, toId: ElementId): void {
    const from = this.scene.get(fromId);
    const to = this.scene.get(toId);
    if (!from || !to) return;
    const ports = pickPorts(from, to);
    this.renderer.setConnectorDraft(
      portPoint(from, ports.from),
      portPoint(to, ports.to),
    );
  }

  /** Clears any connector rubber-band preview. */
  clearConnectorDraft(): void {
    this.renderer.setConnectorDraft(undefined, undefined);
  }

  /** Rubber-band preview for marquee selection (M16.3) — pass `undefined` to hide it. */
  setMarqueeRect(rect: Rect | undefined): void {
    this.renderer.setMarqueeRect(rect);
  }

  /** Faint outline(s) for the container(s) currently drilled into (M16.4) — pass `[]` to clear. */
  setDrillPath(ids: ElementId[]): void {
    this.renderer.setDrillPath(ids);
  }

  /** Alignment guide lines during a live drag (M17.2) — the exact `SnapGuide[]` `snapMove()`
   * already returns; pass `[]` to clear at drag end/abort. */
  setSnapGuides(guides: SnapGuide[]): void {
    this.renderer.setSnapGuides(guides);
  }

  /** Live position/dimension HUD during a drag or resize gesture (M17.2) — pass `undefined` to
   * clear it at commit/abort. */
  setGestureReadout(readout: { text: string; at: Point } | undefined): void {
    this.renderer.setGestureReadout(readout);
  }

  /** Shows or hides the background grid (M17.2) — a view preference, not part of the document. */
  /**
   * Live rotation preview (M20): re-renders a single element at `degrees` rotation without touching
   * the scene or command bus. Pass `null` to clear the preview and restore the last-committed
   * rotation. Uses the same `previewGeometry` map that `previewResize` already uses, extended with
   * a rotation-only variant via a renderer-level `previewRotation` call.
   */
  rotateElementPreview(id: ElementId, degrees: number | null): void {
    this.renderer.previewRotation(id, degrees);
  }

  setGridVisible(visible: boolean): void {
    this.renderer.setGridVisible(visible);
  }

  /** Highlights the container a live drag would reparent into if released now (M17.6,
   * docs/10-canvas-parity-plan.md) — pass `undefined` to clear it. */
  setDropTarget(id: ElementId | undefined): void {
    this.renderer.setDropTarget(id);
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.renderer.destroy();
  }
}

export function createEditor(options: CreateEditorOptions): Editor {
  return new Editor(options);
}
