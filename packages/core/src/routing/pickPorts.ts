import type { PortSide, SceneElement } from "../scene/types.js";

function centerOf(el: SceneElement): { x: number; y: number } {
  return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
}

/**
 * Chooses a reasonable port pair for connecting two elements without
 * requiring the author to pick exact ports — the dominant axis between their
 * centers, biased west→east on a tie (packages/core/docs/ibm-spec-conformance.md#layout-convention).
 * Used by both mouse drag-to-connect and keyboard connect mode
 * (packages/core/docs/editor-ux.md#core-interactions).
 */
export function pickPorts(
  from: SceneElement,
  to: SceneElement,
): { from: PortSide; to: PortSide } {
  const a = centerOf(from);
  const b = centerOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: "e", to: "w" } : { from: "w", to: "e" };
  }
  return dy >= 0 ? { from: "s", to: "n" } : { from: "n", to: "s" };
}
