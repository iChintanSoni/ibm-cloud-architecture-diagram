import type { PortSide, SceneElement } from "../scene/types.js";

export interface Point {
  x: number;
  y: number;
}

/** Resolves a named port on an element's bounding box to a canvas point.
 * When the element has a non-zero `rotation`, the port's unrotated position is rotated about
 * the element's center to match the rendered location (M20, docs/10-canvas-parity-plan.md).
 */
export function portPoint(el: SceneElement, side: PortSide): Point {
  const { x, y, w, h } = el;
  const unrotated = ((): Point => {
    switch (side) {
      case "n":
        return { x: x + w / 2, y };
      case "s":
        return { x: x + w / 2, y: y + h };
      case "e":
        return { x: x + w, y: y + h / 2 };
      case "w":
        return { x, y: y + h / 2 };
      case "center":
        return { x: x + w / 2, y: y + h / 2 };
      default:
        // Invalid values can enter via hand-edited .icad JSON; the linter will
        // report them, while rendering remains resilient at the element center.
        return { x: x + w / 2, y: y + h / 2 };
    }
  })();
  if (!el.rotation) return unrotated;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = unrotated.x - cx;
  const dy = unrotated.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
