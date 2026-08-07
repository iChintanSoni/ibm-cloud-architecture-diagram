import { Scene } from "../scene/scene.js";
import type {
  CanvasSettings,
  CatalogRefPin,
  ConformanceSettings,
  DocumentMeta,
  SceneElement,
} from "../scene/types.js";
import { validateElements, type DroppedElement } from "./icadSchema.js";

export const ICAD_FORMAT = "icad" as const;
export const ICAD_VERSION = 1 as const;

/** On-disk shape of a .icad file (packages/core/docs/file-format.md). */
export interface IcadDocument {
  format: typeof ICAD_FORMAT;
  version: number;
  catalog: CatalogRefPin;
  meta: DocumentMeta;
  canvas: CanvasSettings;
  conformance: ConformanceSettings;
  elements: SceneElement[];
}

/**
 * Everything `migrate()`/`repair()` silently fixed or dropped while loading a `.icad` document
 * (I14, docs/improvement-plan.md#i14--icad-schema-validation) — so a caller that wants to surface
 * "3 elements were dropped" to a user can, instead of the fix being invisible. `fromIcad`/
 * `applyIcad` discard this (matching their pre-existing signatures exactly, so no caller needed to
 * change); `fromIcadWithReport`/`applyIcadWithReport` are the same load, with the report attached.
 */
export interface RepairReport {
  /** Failed structural validation against `icadSchema.ts`'s `sceneElementSchema` — wrong or
   * missing `type` discriminant, a `semantic` that doesn't match its `type`, a non-finite `x`/`y`,
   * an invalid connector port, an unrecognized field, and similar. Dropped outright: there is no
   * repair for "the wrong shape entirely" the way there is for the narrower problems below. */
  invalidElementsDropped: DroppedElement[];
  /** An element `id` claimed by more than one element in the document. First occurrence is kept;
   * every later element with that same id is dropped — a deliberate policy (and a behavior change
   * from `Scene._replaceAll`'s previous implicit "last one wins" `Map` semantics, which dropped
   * the *earlier* one with no signal either way that anything had happened at all). */
  duplicateIdsDropped: string[];
  /** `parentId` pointed at an id absent from the document — the `parentId` was cleared, lifting
   * the element to the top level. */
  danglingParentsCleared: string[];
  /** `parentId` formed a cycle (an element transitively its own ancestor) — broken by clearing
   * that element's `parentId`. */
  cyclesBroken: string[];
  /** A connector whose `from`/`to` `elementId` doesn't resolve to any element in the document —
   * the connector itself was dropped. */
  danglingConnectorsDropped: string[];
  /** A non-positive or non-finite `w`/`h` was clamped to the minimum size (`1`) rather than
   * dropped — the one field-level repair that predates I14. */
  geometryClamped: string[];
}

function emptyReport(): RepairReport {
  return {
    invalidElementsDropped: [],
    duplicateIdsDropped: [],
    danglingParentsCleared: [],
    cyclesBroken: [],
    danglingConnectorsDropped: [],
    geometryClamped: [],
  };
}

export function toIcad(scene: Scene): IcadDocument {
  return {
    format: ICAD_FORMAT,
    version: ICAD_VERSION,
    catalog: scene.catalog,
    meta: scene.meta,
    canvas: scene.canvas,
    conformance: scene.conformance,
    elements: scene.all(),
  };
}

export function fromIcad(input: unknown): Scene {
  return fromIcadWithReport(input).scene;
}

/** Like {@link fromIcad}, but also returns what `migrate()`/`repair()` had to fix or drop. */
export function fromIcadWithReport(input: unknown): {
  scene: Scene;
  report: RepairReport;
} {
  const { doc, report } = migrate(input);
  const scene = new Scene({
    meta: doc.meta,
    canvas: doc.canvas,
    catalog: doc.catalog,
    conformance: doc.conformance,
  });
  scene._replaceAll(doc.elements);
  return { scene, report };
}

/** Like fromIcad, but mutates an existing Scene in place (used by Editor.loadIcad). */
export function applyIcad(scene: Scene, input: unknown): void {
  applyIcadWithReport(scene, input);
}

/**
 * Like {@link applyIcad}, but also returns what `migrate()`/`repair()` had to fix or drop.
 *
 * Defaults `meta`/`canvas`/`catalog`/`conformance` through a throwaway `Scene` rather than
 * assigning `doc.*` onto `scene` directly (a real pre-existing bug this surfaced while adding
 * I14's own tests: a legacy schema-v1 document with no `meta` object at all — valid input,
 * `icad.test.ts`'s "defaults conformance settings when opening a pre-M6 schema-v1 document" case
 * — set `scene.meta = undefined`, crashing the very next `_replaceAll` call, which unconditionally
 * writes `this.meta.updatedAt`. `fromIcad` never had this bug: it already goes through `new
 * Scene({ meta: doc.meta, ... })`, whose constructor merges a partial/absent `meta` with its own
 * defaults — reusing that same constructor here, instead of duplicating its default values,
 * guarantees `applyIcad` treats a legacy document identically to `fromIcad` on the same input.
 */
export function applyIcadWithReport(
  scene: Scene,
  input: unknown,
): RepairReport {
  const { doc, report } = migrate(input);
  const defaults = new Scene({
    meta: doc.meta,
    canvas: doc.canvas,
    catalog: doc.catalog,
    conformance: doc.conformance,
  });
  scene.meta = defaults.meta;
  scene.canvas = defaults.canvas;
  scene.catalog = defaults.catalog;
  scene.conformance = defaults.conformance;
  scene._replaceAll(doc.elements);
  return report;
}

/**
 * Ordered `vN -> vN+1` steps, keyed by the version they upgrade *from*.
 * Empty until the schema bumps past 1 — see
 * packages/core/docs/file-format.md#versioning--migration.
 */
const MIGRATIONS: Record<number, (doc: IcadDocument) => IcadDocument> = {};

/**
 * Validates and upgrades a raw parsed .icad document, then repairs it so
 * the resulting scene is always structurally valid regardless of source
 * (hand-edited files, older buggy versions, partial writes) — see
 * packages/core/docs/file-format.md#versioning--migration.
 *
 * Element-shape validation (I14, `icadSchema.ts`) runs *after* the migration loop, not before —
 * it checks each element against the *current* (`ICAD_VERSION`) shape, so a v1 document destined
 * to be migrated to a hypothetical future v2 isn't rejected against v2's rules before a migration
 * step has had a chance to actually produce that shape. `MIGRATIONS` is empty today, so this only
 * matters once it isn't; a future migration step should validate whatever *its own* expected input
 * shape is itself, since this function's schema check only ever validates the final one.
 */
function migrate(input: unknown): { doc: IcadDocument; report: RepairReport } {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid .icad document: expected a JSON object");
  }
  const candidate = input as Partial<IcadDocument>;
  if (candidate.format !== ICAD_FORMAT) {
    throw new Error(
      `Invalid .icad document: expected format "icad", got ${JSON.stringify(candidate.format)}`,
    );
  }
  if (typeof candidate.version !== "number" || candidate.version < 1) {
    throw new Error(
      `Invalid .icad document: version must be a positive integer, got ${JSON.stringify(candidate.version)}`,
    );
  }
  if (candidate.version > ICAD_VERSION) {
    throw new Error(
      `Unsupported .icad schema version ${candidate.version}; this build only understands up to ${ICAD_VERSION}`,
    );
  }
  if (!Array.isArray(candidate.elements)) {
    throw new Error("Invalid .icad document: elements must be an array");
  }

  let doc = candidate as IcadDocument;
  while (doc.version < ICAD_VERSION) {
    const step = MIGRATIONS[doc.version];
    if (!step)
      throw new Error(
        `No migration registered from .icad schema version ${doc.version}`,
      );
    doc = step(doc);
  }

  const { valid, dropped } = validateElements(doc.elements);
  const { doc: repaired, report } = repair({
    ...doc,
    elements: valid as SceneElement[],
  });
  report.invalidElementsDropped = dropped;
  return { doc: repaired, report };
}

/**
 * Fixes the file up so a scene built from it is always internally
 * consistent, without ever throwing: a duplicate id is deduplicated, a
 * dangling `parentId` is cleared, a `parentId` cycle is broken, a connector
 * missing an endpoint is dropped, and degenerate geometry is clamped to a
 * minimum size. `doc.elements` is assumed already structurally valid
 * (schema-checked by the caller, `migrate()` above) — this function only
 * fixes *referential* problems between otherwise well-formed elements.
 */
function repair(doc: IcadDocument): {
  doc: IcadDocument;
  report: RepairReport;
} {
  const report = emptyReport();

  const deduped: SceneElement[] = [];
  const seenIds = new Set<string>();
  for (const el of doc.elements) {
    if (seenIds.has(el.id)) {
      report.duplicateIdsDropped.push(el.id);
      continue;
    }
    seenIds.add(el.id);
    deduped.push(el);
  }

  const ids = new Set(deduped.map((el) => el.id));

  const withValidParents = deduped.map((el) => {
    if (el.parentId && !ids.has(el.parentId)) {
      report.danglingParentsCleared.push(el.id);
      return withoutParent(el);
    }
    return el;
  });

  const parentOf = new Map(withValidParents.map((el) => [el.id, el.parentId]));
  const acyclic = withValidParents.map((el) => {
    if (hasCycle(el.id, parentOf)) {
      report.cyclesBroken.push(el.id);
      return withoutParent(el);
    }
    return el;
  });

  const connectorsOk = acyclic.filter((el) => {
    if (el.type !== "connector") return true;
    const ok = ids.has(el.from.elementId) && ids.has(el.to.elementId);
    if (!ok) report.danglingConnectorsDropped.push(el.id);
    return ok;
  });

  const repaired = connectorsOk.map((el) => {
    const w = clampSize(el.w);
    const h = clampSize(el.h);
    if (w === el.w && h === el.h) return el;
    report.geometryClamped.push(el.id);
    return { ...el, w, h };
  });

  const unchanged =
    repaired.length === doc.elements.length &&
    repaired.every((el, i) => el === doc.elements[i]);

  return {
    doc: unchanged ? doc : { ...doc, elements: repaired },
    report,
  };
}

function clampSize(value: number): number {
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

function withoutParent<T extends SceneElement>(el: T): T {
  const { parentId: _parentId, ...rest } = el;
  return rest as T;
}

/** Walks the parentId chain from `id`; true if it loops back on itself. */
function hasCycle(
  id: string,
  parentOf: Map<string, string | undefined>,
): boolean {
  const visited = new Set<string>([id]);
  let current = parentOf.get(id);
  while (current !== undefined) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentOf.get(current);
  }
  return false;
}
