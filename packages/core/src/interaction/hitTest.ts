import type { Scene } from "../scene/scene.js";
import type { SceneElement } from "../scene/types.js";

export interface Point {
  x: number;
  y: number;
}

/** Topmost element whose bounding box contains the point, or undefined. */
export function hitTest(scene: Scene, point: Point): SceneElement | undefined {
  const elements = scene.all();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i]!;
    if (point.x >= el.x && point.x <= el.x + el.w && point.y >= el.y && point.y <= el.y + el.h) {
      return el;
    }
  }
  return undefined;
}
