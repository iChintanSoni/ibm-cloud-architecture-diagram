import type { Rect } from "../routing/orthogonalRouter.js";

/**
 * The 8 handles IBM's kit prescribes ("Prescribed location / Scaling elements",
 * docs/10-canvas-parity-plan.md): 4 corners + 4 mid-edges. Order is render/hit-test order only,
 * not semantically meaningful.
 */
export const RESIZE_HANDLES = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;

export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Scene-space floor on width/height — matches the Properties panel's own W/H field minimum
 * (`InspectorPanel.tsx`'s `min: 1`), so a handle-drag and a typed edit agree on the smallest
 * legal size. */
const MIN_SIZE = 1;

export interface ResizeOptions {
  /** Corner handles only (docs/10-canvas-parity-plan.md's "Shift aspect-lock"): preserves the
   * original w/h ratio, driven by whichever axis the pointer moved further along. */
  aspectLock?: boolean;
  /** Grows/shrinks symmetrically around the original center instead of anchoring the opposite
   * edge/corner (docs/10-canvas-parity-plan.md's "Alt resize-from-center"). */
  fromCenter?: boolean;
}

/**
 * Computes a candidate bounding box for dragging `handle` by scene-space `(dx, dy)` from `start`.
 * Pure and scene-independent — no snapping/inset clamping here (that's M17's "live 16px buffer
 * enforcement", docs/10-canvas-parity-plan.md#m17--the-feedback-layer); this only derives the
 * geometry a resize gesture previews/commits.
 */
export function resizeBounds(
  start: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: ResizeOptions = {},
): Rect {
  const touchesLeft = handle === "w" || handle === "nw" || handle === "sw";
  const touchesRight = handle === "e" || handle === "ne" || handle === "se";
  const touchesTop = handle === "n" || handle === "nw" || handle === "ne";
  const touchesBottom = handle === "s" || handle === "sw" || handle === "se";
  const isCorner =
    (touchesLeft || touchesRight) && (touchesTop || touchesBottom);
  const centerFactor = options.fromCenter ? 2 : 1;

  let w =
    touchesLeft || touchesRight
      ? start.w + (touchesRight ? dx : -dx) * centerFactor
      : start.w;
  let h =
    touchesTop || touchesBottom
      ? start.h + (touchesBottom ? dy : -dy) * centerFactor
      : start.h;

  if (options.aspectLock && isCorner && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (Math.abs(dx) >= Math.abs(dy)) h = w / ratio;
    else w = h * ratio;
  }

  w = Math.max(w, MIN_SIZE);
  h = Math.max(h, MIN_SIZE);

  if (options.fromCenter) {
    const cx = start.x + start.w / 2;
    const cy = start.y + start.h / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  const x = touchesLeft ? start.x + start.w - w : start.x;
  const y = touchesTop ? start.y + start.h - h : start.y;
  return { x, y, w, h };
}

/** CSS `cursor` value for each handle, direction-correct regardless of theme. */
export function resizeCursor(handle: ResizeHandle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Repositions (never resizes) each child that no longer keeps its own 16px buffer inside
 * `containerAfter`, clamping it back in — the container-resize counterpart to M17.4's auto-grow
 * (which handles a *dragged child* pushing its parent outward; this handles a *resized container*
 * pulling in on its children instead). Pure and scene-independent, mirroring `resizeBounds`'s own
 * shape: the caller (`Editor.beginResizeInteraction()`) is responsible for reading current children
 * geometry from the scene and dispatching the returned patches. Only the position needing to move
 * is a genuine constraint change — a child already comfortably inside `containerAfter` is left
 * completely out of the returned map, not just unpatched to the same value, so a container resize
 * that doesn't actually pinch anything commits with no child-touching commands at all.
 *
 * A child *wider or taller than `containerAfter`'s own interior* can't satisfy the buffer on both
 * sides at once without shrinking the child itself, which this deliberately never does (matching
 * this file's own resize-handle convention of only ever touching one element's own geometry) — it
 * anchors to the near edge and accepts the overflow on the far one, an edge case for a container
 * shrunk far below what it actually holds, not a realistic drag.
 */
export function reflowChildren(
  children: ReadonlyArray<{ id: string } & Rect>,
  containerAfter: Rect,
  padding = 16,
): Map<string, Rect> {
  const patches = new Map<string, Rect>();
  const minX = containerAfter.x + padding;
  const maxX = containerAfter.x + containerAfter.w - padding;
  const minY = containerAfter.y + padding;
  const maxY = containerAfter.y + containerAfter.h - padding;

  for (const child of children) {
    const x = clamp(child.x, minX, Math.max(minX, maxX - child.w));
    const y = clamp(child.y, minY, Math.max(minY, maxY - child.h));
    if (x !== child.x || y !== child.y) {
      patches.set(child.id, { x, y, w: child.w, h: child.h });
    }
  }
  return patches;
}
