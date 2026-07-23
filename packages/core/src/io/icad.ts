import { Scene } from "../scene/scene.js";
import type { CanvasSettings, CatalogRefPin, DocumentMeta, SceneElement } from "../scene/types.js";

export const ICAD_FORMAT = "icad" as const;
export const ICAD_VERSION = 1 as const;

/** On-disk shape of a .icad file (docs/03-file-format.md). */
export interface IcadDocument {
  format: typeof ICAD_FORMAT;
  version: number;
  catalog: CatalogRefPin;
  meta: DocumentMeta;
  canvas: CanvasSettings;
  elements: SceneElement[];
}

export function toIcad(scene: Scene): IcadDocument {
  return {
    format: ICAD_FORMAT,
    version: ICAD_VERSION,
    catalog: scene.catalog,
    meta: scene.meta,
    canvas: scene.canvas,
    elements: scene.all()
  };
}

export function fromIcad(input: unknown): Scene {
  const doc = migrate(input);
  const scene = new Scene({ meta: doc.meta, canvas: doc.canvas, catalog: doc.catalog });
  scene._replaceAll(doc.elements);
  return scene;
}

/** Like fromIcad, but mutates an existing Scene in place (used by Editor.loadIcad). */
export function applyIcad(scene: Scene, input: unknown): void {
  const doc = migrate(input);
  scene.meta = doc.meta;
  scene.canvas = doc.canvas;
  scene.catalog = doc.catalog;
  scene._replaceAll(doc.elements);
}

/**
 * Validates and upgrades a raw parsed .icad document. Future schema bumps
 * register an additional `vN -> vN+1` step here rather than touching
 * callers — see docs/03-file-format.md#versioning--migration.
 */
function migrate(input: unknown): IcadDocument {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid .icad document: expected a JSON object");
  }
  const candidate = input as Partial<IcadDocument>;
  if (candidate.format !== ICAD_FORMAT) {
    throw new Error(`Invalid .icad document: expected format "icad", got ${JSON.stringify(candidate.format)}`);
  }
  if (candidate.version !== ICAD_VERSION) {
    throw new Error(`Unsupported .icad schema version ${JSON.stringify(candidate.version)}; expected ${ICAD_VERSION}`);
  }
  if (!Array.isArray(candidate.elements)) {
    throw new Error("Invalid .icad document: elements must be an array");
  }
  return candidate as IcadDocument;
}
