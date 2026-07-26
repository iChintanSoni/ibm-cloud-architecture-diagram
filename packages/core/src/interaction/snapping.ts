import { boundsOf } from "../scene/bounds.js";
import type { Scene } from "../scene/scene.js";
import type { ElementId } from "../scene/types.js";
import type { Rect } from "../routing/orthogonalRouter.js";

/** A single alignment or grid line, surfaced so a drag overlay can draw it. */
export interface SnapGuide {
  orientation: "vertical" | "horizontal";
  /** Scene-space coordinate of the line: x for vertical, y for horizontal. */
  position: number;
  /** Scene-space extent of the drawn segment, along the perpendicular axis. */
  start: number;
  end: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface SnapOptions {
  /** Scene-space distance under which a grid line or sibling edge/center snaps. Defaults to 8. */
  tolerance?: number;
  /** Overrides `scene.canvas.grid` (C11 in docs/10-canvas-parity-plan.md). Mainly for tests. */
  gridSize?: number;
}

const DEFAULT_TOLERANCE = 6;

/** Matches `Editor.groupElements`'s own default container padding (createEditor.ts). */
export const PARENT_INSET = 16;

interface Candidate {
  /** Signed adjustment that lands the given edge/center exactly on the target line. */
  offset: number;
  guide: SnapGuide;
}

function nearestGridLine(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function bestCandidate(
  candidates: Candidate[],
  tolerance: number,
): Candidate | undefined {
  let best: Candidate | undefined;
  for (const candidate of candidates) {
    if (Math.abs(candidate.offset) > tolerance) continue;
    if (!best || Math.abs(candidate.offset) < Math.abs(best.offset))
      best = candidate;
  }
  return best;
}

/**
 * Adjusts a proposed move delta so the dragged elements' bounding box snaps to the grid or to a
 * sibling's edge/center, and clamps the result so a child can't cross its parent's 16px inset —
 * a hard constraint, not a snap-if-close candidate, so it always wins regardless of tolerance.
 * Pure and side-effect free: it never touches the scene or the renderer. The intended caller is a
 * drag gesture (M16) that feeds the returned `dx`/`dy` into `Editor.beginInteraction()`'s
 * `update()` and renders `guides` as an overlay while the pointer is down.
 */
export function snapMove(
  scene: Scene,
  ids: ElementId[],
  dx: number,
  dy: number,
  options: SnapOptions = {},
): SnapResult {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const gridSize = options.gridSize ?? scene.canvas.grid;
  const moving = new Set(ids.filter((id) => scene.has(id)));
  const bbox = boundsOf(scene, [...moving]);
  if (!bbox || moving.size === 0) return { dx, dy, guides: [] };

  const proposed: Rect = {
    x: bbox.x + dx,
    y: bbox.y + dy,
    w: bbox.w,
    h: bbox.h,
  };

  const parentIds = new Set([...moving].map((id) => scene.get(id)!.parentId));
  const parentId = parentIds.size === 1 ? [...parentIds][0] : undefined;
  const hasSingleParent = parentIds.size === 1;

  const siblings = hasSingleParent
    ? scene
        .all()
        .filter(
          (el) =>
            el.parentId === parentId &&
            el.type !== "connector" &&
            !moving.has(el.id),
        )
    : [];

  const left = proposed.x;
  const right = proposed.x + proposed.w;
  const centerX = proposed.x + proposed.w / 2;
  const top = proposed.y;
  const bottom = proposed.y + proposed.h;
  const centerY = proposed.y + proposed.h / 2;

  const xCandidates: Candidate[] = [];
  const yCandidates: Candidate[] = [];

  for (const edge of [left, centerX, right]) {
    const target = nearestGridLine(edge, gridSize);
    xCandidates.push({
      offset: target - edge,
      guide: {
        orientation: "vertical",
        position: target,
        start: top,
        end: bottom,
      },
    });
  }
  for (const edge of [top, centerY, bottom]) {
    const target = nearestGridLine(edge, gridSize);
    yCandidates.push({
      offset: target - edge,
      guide: {
        orientation: "horizontal",
        position: target,
        start: left,
        end: right,
      },
    });
  }

  for (const sibling of siblings) {
    const sLeft = sibling.x;
    const sRight = sibling.x + sibling.w;
    const sCenterX = sibling.x + sibling.w / 2;
    const sTop = sibling.y;
    const sBottom = sibling.y + sibling.h;
    const sCenterY = sibling.y + sibling.h / 2;
    const ySpan = {
      start: Math.min(top, sTop),
      end: Math.max(bottom, sBottom),
    };
    const xSpan = {
      start: Math.min(left, sLeft),
      end: Math.max(right, sRight),
    };

    for (const [edge, target] of [
      [left, sLeft],
      [left, sRight],
      [right, sLeft],
      [right, sRight],
      [centerX, sCenterX],
    ] as const) {
      xCandidates.push({
        offset: target - edge,
        guide: { orientation: "vertical", position: target, ...ySpan },
      });
    }
    for (const [edge, target] of [
      [top, sTop],
      [top, sBottom],
      [bottom, sTop],
      [bottom, sBottom],
      [centerY, sCenterY],
    ] as const) {
      yCandidates.push({
        offset: target - edge,
        guide: { orientation: "horizontal", position: target, ...xSpan },
      });
    }
  }

  const xBest = bestCandidate(xCandidates, tolerance);
  const yBest = bestCandidate(yCandidates, tolerance);

  let snappedDx = xBest ? dx + xBest.offset : dx;
  let snappedDy = yBest ? dy + yBest.offset : dy;
  let xGuide = xBest?.guide;
  let yGuide = yBest?.guide;

  const parent =
    hasSingleParent && parentId !== undefined ? scene.get(parentId) : undefined;
  if (parent) {
    const minX = parent.x + PARENT_INSET;
    const maxX = parent.x + parent.w - PARENT_INSET - bbox.w;
    const minY = parent.y + PARENT_INSET;
    const maxY = parent.y + parent.h - PARENT_INSET - bbox.h;
    const clampedX = Math.min(
      Math.max(bbox.x + snappedDx, Math.min(minX, maxX)),
      Math.max(minX, maxX),
    );
    const clampedY = Math.min(
      Math.max(bbox.y + snappedDy, Math.min(minY, maxY)),
      Math.max(minY, maxY),
    );
    // The inset always wins over a snap candidate, but a guide describing a snap position the
    // clamp then overrode would draw a line the drag no longer actually lands on — drop it.
    if (clampedX !== bbox.x + snappedDx) {
      snappedDx = clampedX - bbox.x;
      xGuide = undefined;
    }
    if (clampedY !== bbox.y + snappedDy) {
      snappedDy = clampedY - bbox.y;
      yGuide = undefined;
    }
  }

  const guides: SnapGuide[] = [xGuide, yGuide].filter(
    (g): g is SnapGuide => g !== undefined,
  );
  return { dx: snappedDx, dy: snappedDy, guides };
}
