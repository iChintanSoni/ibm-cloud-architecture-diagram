import { Emitter } from "../util/emitter.js";
import type { CanvasSettings, CatalogRefPin, DocumentMeta, ElementId, SceneElement } from "./types.js";

export interface SceneChangeEvent {
  reason: "add" | "update" | "remove" | "replace";
  ids: ElementId[];
}

type SceneEvents = { change: SceneChangeEvent };

/**
 * In-memory document: an element map plus indexes. This is the single
 * source of truth the renderer, linter, io, and command bus all read from.
 * Mutation happens only through Scene's own methods so every change can be
 * observed — commands call these, never touch the map directly.
 */
export class Scene {
  private elements = new Map<ElementId, SceneElement>();
  private emitter = new Emitter<SceneEvents>();

  meta: DocumentMeta;
  canvas: CanvasSettings;
  catalog: CatalogRefPin;

  constructor(init?: { meta?: Partial<DocumentMeta>; canvas?: Partial<CanvasSettings>; catalog?: CatalogRefPin }) {
    const now = new Date().toISOString();
    this.meta = {
      title: "Untitled diagram",
      diagramLevel: "blank",
      createdAt: now,
      updatedAt: now,
      ...init?.meta
    };
    this.canvas = { theme: "auto", grid: 8, background: "transparent", ...init?.canvas };
    this.catalog = init?.catalog ?? { id: "ibm-cloud", version: "0.0.0" };
  }

  on(listener: (e: SceneChangeEvent) => void): () => void {
    return this.emitter.on("change", listener);
  }

  get(id: ElementId): SceneElement | undefined {
    return this.elements.get(id);
  }

  has(id: ElementId): boolean {
    return this.elements.has(id);
  }

  all(): SceneElement[] {
    return [...this.elements.values()].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  }

  childrenOf(parentId: ElementId): SceneElement[] {
    return this.all().filter((el) => el.parentId === parentId);
  }

  /**
   * All transitive children of an element (containment membership), used by
   * move-with and cascading delete. Guards against a cyclic parentId chain
   * (which should never occur, but must not hang the engine if it does).
   */
  descendantsOf(id: ElementId): SceneElement[] {
    const result: SceneElement[] = [];
    const visited = new Set<ElementId>([id]);
    const queue = this.childrenOf(id);
    while (queue.length > 0) {
      const el = queue.shift()!;
      if (visited.has(el.id)) continue;
      visited.add(el.id);
      result.push(el);
      queue.push(...this.childrenOf(el.id));
    }
    return result;
  }

  /** True if `id` is `ancestorId` itself or a descendant of it. */
  isSelfOrDescendant(ancestorId: ElementId, id: ElementId): boolean {
    if (ancestorId === id) return true;
    return this.descendantsOf(ancestorId).some((el) => el.id === id);
  }

  /** Containing elements from immediate parent up to the root, cycle-safe. */
  ancestorsOf(id: ElementId): SceneElement[] {
    const result: SceneElement[] = [];
    const visited = new Set<ElementId>([id]);
    let current = this.get(id);
    while (current?.parentId && !visited.has(current.parentId)) {
      const parent = this.get(current.parentId);
      if (!parent) break;
      result.push(parent);
      visited.add(parent.id);
      current = parent;
    }
    return result;
  }

  /** Internal write used by commands. Not exported outside the package. */
  _put(el: SceneElement, reason: SceneChangeEvent["reason"] = "add"): void {
    this.elements.set(el.id, el);
    this.meta.updatedAt = new Date().toISOString();
    this.emitter.emit("change", { reason, ids: [el.id] });
  }

  _remove(id: ElementId): void {
    if (!this.elements.delete(id)) return;
    this.meta.updatedAt = new Date().toISOString();
    this.emitter.emit("change", { reason: "remove", ids: [id] });
  }

  _replaceAll(elements: SceneElement[]): void {
    this.elements.clear();
    for (const el of elements) this.elements.set(el.id, el);
    this.meta.updatedAt = new Date().toISOString();
    this.emitter.emit("change", { reason: "replace", ids: elements.map((e) => e.id) });
  }
}
