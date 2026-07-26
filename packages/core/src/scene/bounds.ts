import type { Rect } from "../routing/orthogonalRouter.js";
import type { Scene } from "./scene.js";
import type { ElementId, SceneElement } from "./types.js";

/**
 * Scene-space bounding box of a plain list of elements (e.g. a clipboard snapshot that may no
 * longer match the live scene) — the geometry half of `boundsOf`, factored out so callers with
 * detached elements in hand don't need a `Scene` to query. A connector's declared x/y/w/h is a
 * degenerate 0x0 rect (docs/02-architecture.md), so its own waypoints are used instead; a
 * connector with none (a straight auto-routed line) contributes nothing, the same accepted
 * simplification `boundsOf` itself already carried.
 */
export function boundsOfElements(elements: SceneElement[]): Rect | undefined {
  const rects: Rect[] = [];
  for (const el of elements) {
    if (el.type === "connector") {
      const points = el.waypoints ?? [];
      if (points.length > 0) {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        rects.push({
          x: Math.min(...xs),
          y: Math.min(...ys),
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        });
      }
    } else {
      rects.push({ x: el.x, y: el.y, w: el.w, h: el.h });
    }
  }

  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return {
    x: minX,
    y: minY,
    w: Math.max(maxX - minX, 1),
    h: Math.max(maxY - minY, 1),
  };
}

/**
 * Scene-space bounding box of a set of elements, including each container's
 * descendants (so focusing on a Box/Frame frames its contents too).
 */
export function boundsOf(scene: Scene, ids: ElementId[]): Rect | undefined {
  const elements: SceneElement[] = [];
  const seen = new Set<ElementId>();

  const add = (id: ElementId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const el = scene.get(id);
    if (el) elements.push(el);
  };

  for (const id of ids) {
    add(id);
    for (const descendant of scene.descendantsOf(id)) add(descendant.id);
  }

  return boundsOfElements(elements);
}
