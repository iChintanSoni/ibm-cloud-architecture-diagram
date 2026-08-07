import { boundsOf } from "../scene/bounds.js";
import { CONTAINER_CHILD_PADDING_PX } from "../scene/containerPadding.js";
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
  /** Overrides `scene.canvas.grid` (C11 in packages/core/docs/canvas-parity-plan.md). Mainly for tests. */
  gridSize?: number;
}

const DEFAULT_TOLERANCE = 6;

/** The app's shared child-to-container padding convention (see scene/containerPadding.ts) —
 * kept exported under this file's own established name since it's part of this module's public
 * API (clampRectToParentInset, and consumers like canvasController.ts/its tests). */
export const PARENT_INSET = CONTAINER_CHILD_PADDING_PX;

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
 * sibling's edge/center. Pure and side-effect free: it never touches the scene or the renderer.
 * The intended caller is a drag gesture (M16) that feeds the returned `dx`/`dy` into
 * `Editor.beginInteraction()`'s `update()` and renders `guides` as an overlay while the pointer is
 * down.
 *
 * Deliberately does **not** clamp to the parent's 16px inset the way it used to (M15–M17.3): a
 * dragged child is now let all the way to wherever the pointer takes it, and
 * `Editor.beginInteraction()`'s own `commit()` grows the parent to fit afterward
 * (`autoFitContainer`, M17.4, packages/core/docs/canvas-parity-plan.md) rather than stopping the child at a
 * wall mid-gesture — "auto-grow... instead of letting it escape," not "refuse to overlap and get
 * stuck." Resize's own inset clamp (`clampRectToParentInset`) is unaffected: that's a distinct,
 * deliberately kept hard limit (M17.3), since "dragged toward an edge" in the roadmap's own wording
 * only ever named this gesture, not resize.
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

  const snappedDx = xBest ? dx + xBest.offset : dx;
  const snappedDy = yBest ? dy + yBest.offset : dy;
  const xGuide = xBest?.guide;
  const yGuide = yBest?.guide;

  const guides: SnapGuide[] = [xGuide, yGuide].filter(
    (g): g is SnapGuide => g !== undefined,
  );
  return { dx: snappedDx, dy: snappedDy, guides };
}

/** The parent-inset boundary a child's edges must stay within — `undefined` if the parent is too
 * small to fit even one inset pair on each axis (an edge case for a container far smaller than its
 * own buffer, not a realistic diagram; callers leave the candidate untouched rather than fight it). */
function parentInsetBounds(
  parent: Rect,
): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
  const minX = parent.x + PARENT_INSET;
  const maxX = parent.x + parent.w - PARENT_INSET;
  const minY = parent.y + PARENT_INSET;
  const maxY = parent.y + parent.h - PARENT_INSET;
  if (minX >= maxX || minY >= maxY) return undefined;
  return { minX, maxX, minY, maxY };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamps a candidate rect (M17.3, packages/core/docs/canvas-parity-plan.md) so none of its four edges cross
 * its own parent's 16px inset — a hard constraint, not a snap-if-close candidate. Unlike
 * `snapMove`'s own clamp (which translates a fixed-size bbox as a whole), each edge here is
 * clamped independently: a resize handle only ever moves a subset of the four edges, and the
 * anchored ones are already valid coming into the gesture (the box was valid before it started),
 * so this only ever caps the edge(s) actually being dragged — reusing this for a *move* would be
 * wrong, since overshooting the inset on both edges of the same side would clamp them to the same
 * point and silently collapse the box to `MIN_SIZE` instead of just repositioning it.
 */
export function clampRectToParentInset(
  scene: Scene,
  parentId: ElementId | undefined,
  rect: Rect,
): Rect {
  const parent = parentId !== undefined ? scene.get(parentId) : undefined;
  const bounds = parent ? parentInsetBounds(parent) : undefined;
  if (!bounds) return rect;
  const { minX, maxX, minY, maxY } = bounds;

  const left = clampNumber(rect.x, minX, maxX);
  const right = clampNumber(rect.x + rect.w, minX, maxX);
  const top = clampNumber(rect.y, minY, maxY);
  const bottom = clampNumber(rect.y + rect.h, minY, maxY);

  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    w: Math.max(MIN_RESIZE_CLAMP_SIZE, Math.abs(right - left)),
    h: Math.max(MIN_RESIZE_CLAMP_SIZE, Math.abs(bottom - top)),
  };
}

/** Matches `interaction/resize.ts`'s own `MIN_SIZE` floor — kept as a separate literal rather than
 * importing it, to avoid a cross-module dependency for one shared constant; both are the
 * Properties panel's own W/H field minimum (`InspectorPanel.tsx`'s `min: 1`). */
const MIN_RESIZE_CLAMP_SIZE = 1;
