import { Emitter } from "../util/emitter.js";
import type {
  CanvasSettings,
  CatalogRefPin,
  ConformanceSettings,
  DocumentMeta,
  ElementId,
  SceneElement,
} from "./types.js";

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
  private batching = false;
  private batchedIds = new Set<ElementId>();
  private batchedReasons = new Set<SceneChangeEvent["reason"]>();
  private batchedDirty = false;

  meta: DocumentMeta;
  canvas: CanvasSettings;
  catalog: CatalogRefPin;
  conformance: ConformanceSettings;

  constructor(init?: {
    meta?: Partial<DocumentMeta>;
    canvas?: Partial<CanvasSettings>;
    catalog?: CatalogRefPin;
    conformance?: Partial<ConformanceSettings>;
  }) {
    const now = new Date().toISOString();
    this.meta = {
      title: "Untitled diagram",
      diagramLevel: "blank",
      createdAt: now,
      updatedAt: now,
      ...init?.meta,
    };
    this.canvas = {
      theme: "auto",
      grid: 8,
      background: "transparent",
      ...init?.canvas,
    };
    this.catalog = init?.catalog ?? { id: "ibm-cloud", version: "0.0.0" };
    this.conformance = {
      exportGate: init?.conformance?.exportGate ?? "warn",
      ruleSeverities: { ...(init?.conformance?.ruleSeverities ?? {}) },
    };
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

  /** The single `parentId` every one of `ids` shares, or `undefined` if they don't all share one
   * — including the case where every id is top-level (no single container to point at), which a
   * caller distinguishes from "ambiguous" the same way either way: there's nothing to act on.
   * Used by auto-grow (M17.4) and drag-to-reparent's own "already in this container" check
   * (M17.6, docs/10-canvas-parity-plan.md). */
  sharedParentId(ids: ElementId[]): ElementId | undefined {
    if (ids.length === 0) return undefined;
    const parentIds = new Set(ids.map((id) => this.get(id)?.parentId));
    return parentIds.size === 1 ? [...parentIds][0] : undefined;
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

  /**
   * Defers every `_put`/`_remove`/`_replaceAll`/`_setConformance` change-event emission inside
   * `fn` into a single coalesced event fired after it returns, instead of one event per call. A
   * command that touches N elements (move-with cascade, cascading delete, ...) previously
   * triggered N full render+lint passes via the `scene.on()` subscription — one per `_put` — which
   * dominated the cost of every multi-element gesture (C13, docs/10-canvas-parity-plan.md). Only
   * `CommandBus` calls this, wrapping each `do()`/`undo()`. Reentrant: a transaction started while
   * already inside one just runs `fn()` against the outer buffer rather than flushing early, so a
   * `batch()`'s per-sub-command writes all land in one coalesced event.
   */
  _transaction<T>(fn: () => T): T {
    if (this.batching) return fn();
    this.batching = true;
    this.batchedIds = new Set();
    this.batchedReasons = new Set();
    this.batchedDirty = false;
    try {
      return fn();
    } finally {
      this.batching = false;
      if (this.batchedDirty) {
        const reason: SceneChangeEvent["reason"] =
          this.batchedReasons.size === 1
            ? [...this.batchedReasons][0]!
            : "replace";
        this.emitter.emit("change", { reason, ids: [...this.batchedIds] });
      }
    }
  }

  /** Internal write used by commands. Not exported outside the package. */
  _put(el: SceneElement, reason: SceneChangeEvent["reason"] = "add"): void {
    this.elements.set(el.id, el);
    this.meta.updatedAt = new Date().toISOString();
    if (this.batching) {
      this.batchedIds.add(el.id);
      this.batchedReasons.add(reason);
      this.batchedDirty = true;
    } else {
      this.emitter.emit("change", { reason, ids: [el.id] });
    }
  }

  _remove(id: ElementId): void {
    if (!this.elements.delete(id)) return;
    this.meta.updatedAt = new Date().toISOString();
    if (this.batching) {
      this.batchedIds.add(id);
      this.batchedReasons.add("remove");
      this.batchedDirty = true;
    } else {
      this.emitter.emit("change", { reason: "remove", ids: [id] });
    }
  }

  _replaceAll(elements: SceneElement[]): void {
    this.elements.clear();
    for (const el of elements) this.elements.set(el.id, el);
    this.meta.updatedAt = new Date().toISOString();
    if (this.batching) {
      for (const el of elements) this.batchedIds.add(el.id);
      this.batchedReasons.add("replace");
      this.batchedDirty = true;
    } else {
      this.emitter.emit("change", {
        reason: "replace",
        ids: elements.map((e) => e.id),
      });
    }
  }

  /** Internal settings write used by commands so configuration is undoable. */
  _setConformance(settings: ConformanceSettings): void {
    this.conformance = {
      exportGate: settings.exportGate,
      ruleSeverities: { ...settings.ruleSeverities },
    };
    this.meta.updatedAt = new Date().toISOString();
    if (this.batching) {
      this.batchedReasons.add("update");
      this.batchedDirty = true;
    } else {
      this.emitter.emit("change", { reason: "update", ids: [] });
    }
  }
}
