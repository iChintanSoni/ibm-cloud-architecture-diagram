import type { Catalog } from "../catalog/catalog.js";
import { boundsOf } from "../scene/bounds.js";
import { CommandBus } from "../commands/commandBus.js";
import {
  addElement,
  autoRouteConnector,
  batch,
  moveElements,
  reparentElement,
  setManualWaypoints,
  updateConformance,
  updateElement
} from "../commands/commands.js";
import type { Command } from "../commands/types.js";
import { SelectionManager } from "../interaction/selection.js";
import { applyIcad, toIcad, type IcadDocument } from "../io/icad.js";
import { exportPng, exportSvg } from "../io/export.js";
import { Linter } from "../linter/linter.js";
import { applyQuickFix, applyQuickFixes } from "../linter/quickFix.js";
import type { Diagnostic, Severity } from "../linter/types.js";
import { SvgRenderer, type ResolvedTheme } from "../render/svgRenderer.js";
import { ViewportController } from "../render/viewport.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import { routeConnectorInScene } from "../routing/routeConnector.js";
import { Scene, type SceneChangeEvent } from "../scene/scene.js";
import type {
  ActorElement,
  BoxElement,
  CanvasSettings,
  ConnectorDirection,
  ConnectorElement,
  ConnectorType,
  ConformanceSeverity,
  ElementId,
  EndpointLabels,
  FlowColor,
  ExportGate,
  FrameElement,
  GroupElement,
  IconNodeElement,
  Label,
  PortRef,
  SceneElement,
  Style,
  TextElement,
  ZoneElement,
  ZoneKind
} from "../scene/types.js";
import {
  createTemplateDocument,
  type DiagramTemplateId
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

interface FramePlacementOptions extends Omit<PlacementOptions, "label" | "parentId"> {
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
}

export class ExportBlockedError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(`Export blocked by ${diagnostics.filter((item) => item.severity === "error").length} conformance error(s).`);
    this.name = "ExportBlockedError";
  }
}

const DEFAULT_CONTAINER_SIZE = { w: 240, h: 160 };

function resolveTheme(preference: CanvasSettings["theme"]): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  const prefersDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
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

  constructor(options: CreateEditorOptions) {
    this.catalog = options.catalog;
    this.scene = new Scene({
      canvas: { theme: options.theme ?? "auto", grid: 8, background: "transparent" },
      catalog: { id: options.catalog.id, version: options.catalog.version }
    });
    this.commands = new CommandBus(this.scene);
    this.selection = new SelectionManager();
    this.linter = new Linter({ catalog: this.catalog });
    this.renderer = new SvgRenderer(options.container, this.catalog, resolveTheme(this.scene.canvas.theme));
    this.viewport = new ViewportController();

    this.scene.on((event) => {
      this.renderer.render(this.scene);
      this.renderer.setDiagnostics(this.linter.run(this.scene));
      this.changeEmitter.emit("change", event);
    });
    this.selection.on((ids) => this.renderer.setSelection(ids));
    this.viewport.on((state) => this.renderer.applyViewport(state));
    this.renderer.render(this.scene);
    this.renderer.setDiagnostics(this.linter.run(this.scene));
    this.renderer.applyViewport(this.viewport.get());

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.renderer.applyViewport(this.viewport.get()));
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
        theme: this.scene.canvas.theme
      })
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
      ...(opts.label ? { label: { text: opts.label } } : {})
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
      ...(opts.label ? { label: { text: opts.label } } : {})
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
      ...(opts.label ? { label: { text: opts.label } } : {})
    };
    this.commands.dispatch(addElement(element));
    return id;
  }

  addZone(opts: ContainerPlacementOptions & { zoneKind?: ZoneKind }): ElementId {
    const id = opts.id ?? generateId("zone");
    const element: ZoneElement = {
      id,
      type: "zone",
      semantic: "boundary",
      zoneKind: opts.zoneKind ?? "region",
      x: opts.at.x,
      y: opts.at.y,
      w: opts.w ?? DEFAULT_CONTAINER_SIZE.w,
      h: opts.h ?? DEFAULT_CONTAINER_SIZE.h,
      ...(opts.catalogRef ? { catalogRef: opts.catalogRef } : {}),
      ...(opts.style ? { style: opts.style } : {}),
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      ...(opts.label ? { label: { text: opts.label } } : {})
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
      ...(opts.label ? { label: { text: opts.label } } : {})
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
      ...(opts.parentId ? { parentId: opts.parentId } : {})
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
      h: opts.h ?? 500
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
      return current.order === order ? [] : [updateElement(this.scene, id, { order })];
    });
    if (commands.length > 0) this.commands.dispatch(batch("reorder frames", commands));
  }

  connect(
    from: PortRef,
    to: PortRef,
    opts: {
      connectorType?: ConnectorType;
      direction?: ConnectorDirection;
      flowColor?: FlowColor;
      cardinality?: EndpointLabels;
      label?: string;
      id?: ElementId;
    } = {}
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
      ...(opts.label ? { label: { text: opts.label } } : {})
    };
    const element: ConnectorElement = { ...base, waypoints: routeConnectorInScene(this.scene, base) };
    this.commands.dispatch(addElement(element));
    return id;
  }

  /** Overrides a connector's route with explicit waypoints (D13's manual escape hatch). */
  setConnectorWaypoints(id: ElementId, waypoints: Array<{ x: number; y: number }>): void {
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
    if (dx !== 0 || dy !== 0) commands.push(moveElements(this.scene, [id], dx, dy));

    const { x: _x, y: _y, ...fieldPatch } = patch;
    if (Object.keys(fieldPatch).length > 0) {
      commands.push(updateElement(this.scene, id, fieldPatch as Partial<SceneElement>));
    }

    if (commands.length === 0) return;
    this.commands.dispatch(
      commands.length === 1 ? commands[0]! : batch("update element properties", commands)
    );
  }

  /** Changes containment membership as an undoable editor operation. */
  setElementParent(id: ElementId, parentId: ElementId | undefined): void {
    if (this.scene.get(id)?.parentId === parentId) return;
    if (parentId !== undefined) {
      const parent = this.scene.get(parentId);
      if (!parent) throw new Error(`Cannot use unknown parent "${parentId}"`);
      if (parent.type !== "box" && parent.type !== "group" && parent.type !== "zone" && parent.type !== "frame") {
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
      blocked: this.scene.conformance.exportGate === "block" && counts.error > 0
    };
  }

  applyQuickFix(diagnostic: Diagnostic): boolean {
    if (!diagnostic.quickFix) return false;
    this.commands.dispatch(applyQuickFix(diagnostic));
    return true;
  }

  applyQuickFixes(ruleId?: string): number {
    const diagnostics = this.lint().filter(
      (diagnostic) => diagnostic.quickFix && (ruleId === undefined || diagnostic.ruleId === ruleId)
    );
    if (diagnostics.length === 0) return 0;
    this.commands.dispatch(
      applyQuickFixes(diagnostics, ruleId ? `fix all ${ruleId} issues` : "fix all validation issues")
    );
    return diagnostics.length;
  }

  setExportGate(exportGate: ExportGate): void {
    this.commands.dispatch(updateConformance(this.scene, { exportGate }));
  }

  setRuleSeverity(ruleId: string, severity?: ConformanceSeverity): void {
    this.commands.dispatch(
      updateConformance(this.scene, {
        ruleSeverity: { ruleId, ...(severity !== undefined ? { severity } : {}) }
      })
    );
  }

  export(opts: ExportOptions): string | Promise<Blob> {
    const summary = this.complianceSummary();
    if (summary.blocked) throw new ExportBlockedError(summary.diagnostics);
    if (opts.format === "svg") {
      return exportSvg(this.scene, this.renderer, {
        ...(opts.embedSource !== undefined ? { embedSource: opts.embedSource } : {})
      });
    }
    return exportPng(this.scene, this.renderer, {
      ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
      ...(opts.background !== undefined ? { background: opts.background } : {})
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
  focusOnElements(ids: ElementId[], opts?: { padding?: number; maxScale?: number }): void {
    const rect = this.boundsOf(ids);
    if (!rect) return;
    this.viewport.focusOn(rect, this.renderer.containerSize(), opts);
  }

  /** Fits the viewport to the whole diagram's current extent. */
  fitToContent(opts?: { padding?: number; maxScale?: number }): void {
    this.focusOnElements(
      this.scene.all().map((el) => el.id),
      opts
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

  private sceneCenter(size: { w: number; h: number }): { x: number; y: number } {
    const { x, y, scale } = this.viewport.get();
    return { x: x + size.w / (2 * scale), y: y + size.h / (2 * scale) };
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.renderer.destroy();
  }
}

export function createEditor(options: CreateEditorOptions): Editor {
  return new Editor(options);
}
