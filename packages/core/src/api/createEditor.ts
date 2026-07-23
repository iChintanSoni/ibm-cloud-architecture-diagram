import type { Catalog } from "../catalog/catalog.js";
import { CommandBus } from "../commands/commandBus.js";
import { addElement } from "../commands/commands.js";
import { SelectionManager } from "../interaction/selection.js";
import { applyIcad, toIcad, type IcadDocument } from "../io/icad.js";
import { exportPng, exportSvg } from "../io/export.js";
import { Linter } from "../linter/linter.js";
import type { Diagnostic } from "../linter/types.js";
import { SvgRenderer, type ResolvedTheme } from "../render/svgRenderer.js";
import { Scene, type SceneChangeEvent } from "../scene/scene.js";
import type {
  ActorElement,
  BoxElement,
  CanvasSettings,
  ConnectorElement,
  ConnectorType,
  ElementId,
  GroupElement,
  IconNodeElement,
  PortRef,
  TextElement,
  ZoneElement,
  ZoneKind
} from "../scene/types.js";
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

export interface ExportOptions {
  format: "svg" | "png";
  embedSource?: boolean;
  scale?: 1 | 2 | 3;
  background?: "transparent" | "white";
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

  private renderer: SvgRenderer;
  private linter = new Linter();
  private changeEmitter = new Emitter<{ change: SceneChangeEvent }>();

  constructor(options: CreateEditorOptions) {
    this.catalog = options.catalog;
    this.scene = new Scene({
      canvas: { theme: options.theme ?? "auto", grid: 8, background: "transparent" },
      catalog: { id: options.catalog.id, version: options.catalog.version }
    });
    this.commands = new CommandBus(this.scene);
    this.selection = new SelectionManager();
    this.renderer = new SvgRenderer(options.container, this.catalog, resolveTheme(this.scene.canvas.theme));

    this.scene.on((event) => {
      this.renderer.render(this.scene);
      this.changeEmitter.emit("change", event);
    });
    this.renderer.render(this.scene);
  }

  /** Updates the auto/light/dark preference and repaints the canvas to match. */
  setTheme(preference: CanvasSettings["theme"]): void {
    this.scene.canvas = { ...this.scene.canvas, theme: preference };
    this.renderer.setTheme(resolveTheme(preference));
    this.renderer.render(this.scene);
  }

  loadIcad(input: unknown): void {
    applyIcad(this.scene, input);
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

  addBox(opts: PlacementOptions): ElementId {
    const id = opts.id ?? generateId("box");
    const element: BoxElement = {
      id,
      type: "box",
      semantic: "deployedOn",
      x: opts.at.x,
      y: opts.at.y,
      w: opts.w ?? DEFAULT_CONTAINER_SIZE.w,
      h: opts.h ?? DEFAULT_CONTAINER_SIZE.h,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      ...(opts.label ? { label: { text: opts.label } } : {})
    };
    this.commands.dispatch(addElement(element));
    return id;
  }

  addGroup(opts: PlacementOptions): ElementId {
    const id = opts.id ?? generateId("group");
    const element: GroupElement = {
      id,
      type: "group",
      semantic: "deployedTo",
      x: opts.at.x,
      y: opts.at.y,
      w: opts.w ?? DEFAULT_CONTAINER_SIZE.w,
      h: opts.h ?? DEFAULT_CONTAINER_SIZE.h,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      ...(opts.label ? { label: { text: opts.label } } : {})
    };
    this.commands.dispatch(addElement(element));
    return id;
  }

  addZone(opts: PlacementOptions & { zoneKind?: ZoneKind }): ElementId {
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

  connect(from: PortRef, to: PortRef, opts: { connectorType?: ConnectorType; id?: ElementId } = {}): ElementId {
    const id = opts.id ?? generateId("conn");
    const element: ConnectorElement = {
      id,
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from,
      to,
      connectorType: opts.connectorType ?? "association"
    };
    this.commands.dispatch(addElement(element));
    return id;
  }

  lint(): Diagnostic[] {
    return this.linter.run(this.scene);
  }

  export(opts: ExportOptions): string | Promise<Blob> {
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

  destroy(): void {
    this.renderer.destroy();
  }
}

export function createEditor(options: CreateEditorOptions): Editor {
  return new Editor(options);
}
