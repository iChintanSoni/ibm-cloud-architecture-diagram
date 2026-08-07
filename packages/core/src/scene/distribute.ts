import { boundsOf } from "./bounds.js";
import type { Scene } from "./scene.js";
import type { ElementId } from "./types.js";

/** The two distribution axes (M18.3, packages/core/docs/canvas-parity-plan.md). */
export type DistributeMode = "horizontal" | "vertical";

export interface DistributeMove {
  id: ElementId;
  dx: number;
  dy: number;
}

/**
 * Computes the per-element move needed to space `ids` evenly along `mode`.
 *
 * **Algorithm** — Figma/Illustrator/PowerPoint convention: the two outermost
 * elements (leftmost/rightmost for horizontal, topmost/bottommost for
 * vertical) are anchored in place; every element between them is repositioned
 * so that the *gaps* between adjacent elements are equal. Gap is measured
 * between the trailing edge of one element and the leading edge of the next
 * (`left-edge[i+1] − right-edge[i]`), not between centers — "even spacing,"
 * not "evenly spaced centers."
 *
 * Three or more alignable elements are required: with two the two anchor
 * positions are just the two elements themselves, and there is no element to
 * reposition. With fewer than three, `[]` is returned.
 *
 * Connectors are excluded for the same reason they are excluded by
 * `computeAlignMoves`: a `ConnectorElement`'s `x`/`y`/`w`/`h` is a degenerate
 * 0×0 rect (`bounds.ts`), so there is no independent leading/trailing edge to
 * distribute. One present in `ids` is silently dropped.
 *
 * Returns one move per repositionable element whose position actually changes
 * — already-correctly-spaced elements are omitted.
 */
export function computeDistributeMoves(
  scene: Scene,
  ids: ElementId[],
  mode: DistributeMode,
): DistributeMove[] {
  const distributable = [...new Set(ids)].filter((id) => {
    const el = scene.get(id);
    return el !== undefined && el.type !== "connector";
  });
  if (distributable.length < 3) return [];

  // Collect bounding boxes and sort by leading edge along the target axis.
  type Item = { id: ElementId; lo: number; hi: number };
  const items: Item[] = [];
  for (const id of distributable) {
    const box = boundsOf(scene, [id]);
    if (!box) continue;
    items.push(
      mode === "horizontal"
        ? { id, lo: box.x, hi: box.x + box.w }
        : { id, lo: box.y, hi: box.y + box.h },
    );
  }
  if (items.length < 3) return [];

  items.sort((a, b) => a.lo - b.lo);

  // Total space available between the two anchor elements' outer edges.
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const totalSpace = last.lo - first.hi;

  // Sum of interior elements' own sizes, and compute the uniform gap.
  let interiorSize = 0;
  for (let i = 1; i < items.length - 1; i++) {
    interiorSize += items[i]!.hi - items[i]!.lo;
  }
  const gapCount = items.length - 1; // gaps between N elements = N-1
  const gap = (totalSpace - interiorSize) / gapCount;

  // Assign each interior element's target leading edge and compute the delta.
  const moves: DistributeMove[] = [];
  let cursor = first.hi + gap;
  for (let i = 1; i < items.length - 1; i++) {
    const item = items[i]!;
    const itemSize = item.hi - item.lo;
    const targetLo = cursor;
    const delta = targetLo - item.lo;
    if (delta !== 0) {
      moves.push(
        mode === "horizontal"
          ? { id: item.id, dx: delta, dy: 0 }
          : { id: item.id, dx: 0, dy: delta },
      );
    }
    cursor = targetLo + itemSize + gap;
  }
  return moves;
}
