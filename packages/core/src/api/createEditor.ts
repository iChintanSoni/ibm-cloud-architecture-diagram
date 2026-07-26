import type { Catalog } from "../catalog/catalog.js";
import { boundsOf } from "../scene/bounds.js";
import { CommandBus } from "../commands/commandBus.js";
import {
  addElement,
  autoRouteConnector,
  batch,
  moveElements,
  removeElement,
  reparentElement,
  setManualWaypoints,
  updateConformance,
  updateElement,
} from "../commands/commands.js";
import type { Command } from "../commands/types.js";
import { SelectionManager } from "../interaction/selection.js";
import { computeTabOrder } from "../interaction/tabOrder.js";
import { applyIcad, toIcad, type IcadDocument } from "../io/icad.js";
import { exportPng, exportSvg } from "../io/export.js";
import { Linter } from "../linter/linter.js";
import { applyQuickFix, applyQuickFixes } from "../linter/quickFix.js";
import type { Diagnostic, Severity } from "../linter/types.js";
import { portPoint, type Point } from "../render/port.js";
import { SvgRenderer, type ResolvedTheme } from "../render/svgRenderer.js";
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

export interface CreateEditorOptions {
  container: HTMLElement;
  catalog: Catalog;
  theme?: CanvasSettings["theme"];
}

interface PlacementOptions {
  id?: ElementId;
  at: { x: number; y: number };
  w?: number;
  h?: number;
  parentId?: ElementId;
  label?: string;
}

interface ContainerPlacementOptions extends PlacementOptions {
  catalogRef?: string;
  style?: Style;
}

interface FramePlacementOptions extends Omit<
  PlacementOptions,
  "label" | "parentId"
> {
  name: string;
  order?: number;
}

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
  /** Applies a scene-space delta as a live preview. Call repeatedly, e.g. once per pointer-move. */
  update(dx: number, dy: number): void;
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

  /** Replaces the current document with a reusable IBM-level starter template. */
  newDocument(templateId: DiagramTemplateId): void {
    this.loadIcad(
      createTemplateDocument(templateId, {
        catalog: { id: this.catalog.id, version: this.catalog.version },
        theme: this.scene.canvas.theme,
      }),
    );
  }

  toIcad(): IcadDocument {
    return toIcad(this.scene);
  }

  addIcon(catalogRef: string, opts: PlacementOptions): ElementId {
    const meta = this.catalog.resolve(catalogRef);
    if (!meta) throw new Error(`Unknown catalog icon: "${catalogRef}"`);
    const id = opts.id ?? generateId("icon");
    const element: IconNodeElement = {
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
    this.commands.dispatch(addElement(element));
    return id;
  }

  addBox(opts: ContainerPlacementOptions): ElementId {
    const id = opts.id ?? generateId("box");
    const element: BoxElement = {
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
    this.commands.dispatch(addElement(element));
    return id;
  }

  addGroup(opts: ContainerPlacementOptions): ElementId {
    const id = opts.id ?? generateId("group");
    const element: GroupElement = {
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
    this.commands.dispatch(addElement(element));
    return id;
  }

  addZone(
    opts: ContainerPlacementOptions & { zoneKind?: ZoneKind },
  ): ElementId {
    const id = opts.id ?? generateId("zone");
    const element: ZoneElement = {
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
    this.commands.dispatch(addElement(element));
    return id;
  }

  addActor(opts: PlacementOptions & { catalogRef?: string }): ElementId {
    const id = opts.id ?? generateId("actor");
    const element: ActorElement = {
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
    this.commands.dispatch(addElement(element));
    return id;
  }

  addText(opts: Omit<PlacementOptions, "label"> & { text: string }): ElementId {
    const id = opts.id ?? generateId("text");
    const element: TextElement = {
      id,
      type: "text",
      semantic: "node",
      text: opts.text,
      x: opts.at.x,
      y: opts.at.y,
      w: opts.w ?? 120,
      h: opts.h ?? 20,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
    };
    this.commands.dispatch(addElement(element));
    return id;
  }

  addFrame(opts: FramePlacementOptions): ElementId {
    const id = opts.id ?? generateId("frame");
    const currentOrders = this.scene
      .all()
      .filter((element): element is FrameElement => element.type === "frame")
      .map((element) => element.order);
    const element: FrameElement = {
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
    this.commands.dispatch(addElement(element));
    return id;
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

  connect(
    from: PortRef,
    to: PortRef,
    opts: {
      connectorType?: ConnectorType;
      direction?: ConnectorDirection;
      flowColor?: FlowColor;
      cardinality?: EndpointLabels;
      sequence?: string;
      annotation?: ConnectorAnnotation;
      label?: string;
      id?: ElementId;
    } = {},
  ): ElementId {
    const id = opts.id ?? generateId("conn");
    const base: ConnectorElement = {
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
    const element: ConnectorElement = {
      ...base,
      waypoints: routeConnectorInScene(this.scene, base),
    };
    this.commands.dispatch(addElement(element));
    return id;
  }

  /** Overrides a connector's route with explicit waypoints (D13's manual escape hatch). */
  setConnectorWaypoints(
    id: ElementId,
    waypoints: Array<{ x: number; y: number }>,
  ): void {
    this.commands.dispatch(setManualWaypoints(this.scene, id, waypoints));
  }

  /** Switches a manually-routed connector back to auto-routing. */
  autoRouteConnector(id: ElementId): void {
    this.commands.dispatch(autoRouteConnector(this.scene, id));
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

    const { x: _x, y: _y, ...fieldPatch } = patch;
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

  export(opts: ExportOptions): string | Promise<Blob> {
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
  private ensureVisible(id: ElementId): void {
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

  /** Nudges every given element by a scene-space delta (e.g. an arrow-key press), reusing move-with semantics. */
  nudgeElements(ids: ElementId[], dx: number, dy: number): void {
    const existing = ids.filter((id) => this.scene.has(id));
    if (existing.length === 0 || (dx === 0 && dy === 0)) return;
    this.commands.dispatch(moveElements(this.scene, existing, dx, dy));
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
   * transform (see `previewTransform`'s own doc comment).
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

    return {
      update: (nextDx, nextDy) => {
        dx = nextDx;
        dy = nextDy;
        this.renderer.previewTransform(previewIds, dx, dy);
      },
      commit: () => {
        this.renderer.previewTransform(previewIds, 0, 0);
        if (existing.length > 0 && (dx !== 0 || dy !== 0)) {
          this.commands.dispatch(moveElements(this.scene, existing, dx, dy));
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
   * — only the resized element's own geometry changes, so this dispatches a bare `updateElement`
   * patch instead. Children reflowing to stay inside a resized container is explicitly deferred to
   * M17 ("container resize reflows children").
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
          original &&
          latest &&
          (latest.x !== original.x ||
            latest.y !== original.y ||
            latest.w !== original.w ||
            latest.h !== original.h)
        ) {
          this.commands.dispatch(updateElement(this.scene, id, latest));
        }
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

    const padding = opts.padding ?? 16;
    const parents = new Set(existing.map((id) => this.scene.get(id)!.parentId));
    const parentId = parents.size === 1 ? [...parents][0] : undefined;

    const groupId = generateId("group");
    const group: GroupElement = {
      id: groupId,
      type: "group",
      semantic: "deployedTo",
      x: bbox.x - padding,
      y: bbox.y - padding,
      w: bbox.w + padding * 2,
      h: bbox.h + padding * 2,
      ...(parentId ? { parentId } : {}),
    };

    const commands: Command[] = [
      addElement(group),
      ...existing.map((id) => reparentElement(this.scene, id, groupId)),
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

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.renderer.destroy();
  }
}

export function createEditor(options: CreateEditorOptions): Editor {
  return new Editor(options);
}
