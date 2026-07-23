import type { PortSide, SceneElement } from "../scene/types.js";

export interface Point {
  x: number;
  y: number;
}

/** Resolves a named port on an element's bounding box to a canvas point. */
export function portPoint(el: SceneElement, side: PortSide): Point {
  const { x, y, w, h } = el;
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
  }
}
