import { Scene } from "../scene/scene.js";
import type {
  CanvasSettings,
  CatalogRefPin,
  ConformanceSettings,
  DocumentMeta,
  SceneElement
} from "../scene/types.js";

export const ICAD_FORMAT = "icad" as const;
export const ICAD_VERSION = 1 as const;

/** On-disk shape of a .icad file (docs/03-file-format.md). */
export interface IcadDocument {
  format: typeof ICAD_FORMAT;
  version: number;
  catalog: CatalogRefPin;
  meta: DocumentMeta;
  canvas: CanvasSettings;
  conformance: ConformanceSettings;
  elements: SceneElement[];
}

export function toIcad(scene: Scene): IcadDocument {
  return {
    format: ICAD_FORMAT,
    version: ICAD_VERSION,
    catalog: scene.catalog,
    meta: scene.meta,
    canvas: scene.canvas,
    conformance: scene.conformance,
    elements: scene.all()
  };
}

export function fromIcad(input: unknown): Scene {
  const doc = migrate(input);
  const scene = new Scene({
    meta: doc.meta,
    canvas: doc.canvas,
    catalog: doc.catalog,
    conformance: doc.conformance
  });
  scene._replaceAll(doc.elements);
  return scene;
}

/** Like fromIcad, but mutates an existing Scene in place (used by Editor.loadIcad). */
export function applyIcad(scene: Scene, input: unknown): void {
  const doc = migrate(input);
  scene.meta = doc.meta;
  scene.canvas = doc.canvas;
  scene.catalog = doc.catalog;
  scene.conformance = {
    exportGate: doc.conformance?.exportGate ?? "warn",
    ruleSeverities: { ...(doc.conformance?.ruleSeverities ?? {}) }
  };
  scene._replaceAll(doc.elements);
}

/**
 * Ordered `vN -> vN+1` steps, keyed by the version they upgrade *from*.
 * Empty until the schema bumps past 1 — see
 * docs/03-file-format.md#versioning--migration.
 */
const MIGRATIONS: Record<number, (doc: IcadDocument) => IcadDocument> = {};

/**
 * Validates and upgrades a raw parsed .icad document, then repairs it so
 * the resulting scene is always structurally valid regardless of source
 * (hand-edited files, older buggy versions, partial writes) — see
 * docs/03-file-format.md#versioning--migration.
 */
function migrate(input: unknown): IcadDocument {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid .icad document: expected a JSON object");
  }
  const candidate = input as Partial<IcadDocument>;
  if (candidate.format !== ICAD_FORMAT) {
    throw new Error(`Invalid .icad document: expected format "icad", got ${JSON.stringify(candidate.format)}`);
  }
  if (typeof candidate.version !== "number" || candidate.version < 1) {
    throw new Error(`Invalid .icad document: version must be a positive integer, got ${JSON.stringify(candidate.version)}`);
  }
  if (candidate.version > ICAD_VERSION) {
    throw new Error(`Unsupported .icad schema version ${candidate.version}; this build only understands up to ${ICAD_VERSION}`);
  }
  if (!Array.isArray(candidate.elements)) {
    throw new Error("Invalid .icad document: elements must be an array");
  }

  let doc = candidate as IcadDocument;
  while (doc.version < ICAD_VERSION) {
    const step = MIGRATIONS[doc.version];
    if (!step) throw new Error(`No migration registered from .icad schema version ${doc.version}`);
    doc = step(doc);
  }

  return repair(doc);
}

/**
 * Fixes the file up so a scene built from it is always internally
 * consistent, without ever throwing: a dangling `parentId` is cleared, a
 * `parentId` cycle is broken, a connector missing an endpoint is dropped,
 * and degenerate geometry is clamped to a minimum size.
 */
function repair(doc: IcadDocument): IcadDocument {
  const ids = new Set(doc.elements.map((el) => el.id));

  const withValidParents = doc.elements.map((el) =>
    el.parentId && !ids.has(el.parentId) ? withoutParent(el) : el
  );

  const parentOf = new Map(withValidParents.map((el) => [el.id, el.parentId]));
  const acyclic = withValidParents.map((el) => (hasCycle(el.id, parentOf) ? withoutParent(el) : el));

  const repaired = acyclic
    .filter((el) => el.type !== "connector" || (ids.has(el.from.elementId) && ids.has(el.to.elementId)))
    .map((el) => {
      const w = clampSize(el.w);
      const h = clampSize(el.h);
      return w === el.w && h === el.h ? el : { ...el, w, h };
    });

  return repaired.length === doc.elements.length && repaired.every((el, i) => el === doc.elements[i])
    ? doc
    : { ...doc, elements: repaired };
}

function clampSize(value: number): number {
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

function withoutParent<T extends SceneElement>(el: T): T {
  const { parentId: _parentId, ...rest } = el;
  return rest as T;
}

/** Walks the parentId chain from `id`; true if it loops back on itself. */
function hasCycle(id: string, parentOf: Map<string, string | undefined>): boolean {
  const visited = new Set<string>([id]);
  let current = parentOf.get(id);
  while (current !== undefined) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentOf.get(current);
  }
  return false;
}
