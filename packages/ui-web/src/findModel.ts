import type { Catalog, ElementId, SceneElement } from "@icad/core";
import { elementDisplayName } from "./inspectorModel.js";

export interface FindMatch {
  id: ElementId;
  label: string;
  type: SceneElement["type"];
  /** "frame" surfaces the Excalidraw-style "jump straight to a section" case (packages/core/docs/editor-ux.md#find-on-canvas-f). */
  kind: "frame" | "element";
}

/** Searches element labels, icon catalog names, and frame names (packages/core/docs/editor-ux.md#find-on-canvas-f). */
export function findMatches(
  elements: SceneElement[],
  catalog: Catalog,
  query: string,
): FindMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: FindMatch[] = [];
  for (const element of elements) {
    if (element.type === "connector") continue;
    const catalogName =
      "catalogRef" in element && element.catalogRef
        ? catalog.resolve(element.catalogRef)?.name
        : undefined;
    const haystack = [elementDisplayName(element), catalogName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (haystack.includes(q)) {
      matches.push({
        id: element.id,
        label: elementDisplayName(element),
        type: element.type,
        kind: element.type === "frame" ? "frame" : "element",
      });
    }
  }
  return matches;
}
