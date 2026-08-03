import type { Point } from "../render/port.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import { connectorPathPoints } from "../routing/routeConnector.js";
import type { Scene } from "../scene/scene.js";
import type { SceneElement } from "../scene/types.js";
import { rotatedCorners } from "../scene/bounds.js";

export type { Point };

/**
 * Scene-space distance tolerance for line-like hits (connectors). A connector's declared
 * x/y/w/h is a degenerate 0x0 rect (docs/02-architecture.md), so without this every connector is
 * geometrically unhittable (C9, docs/10-canvas-parity-plan.md) — this module tests distance to
 * its real rendered polyline instead. Callers driving a live, zoomable viewport should scale a
 * fixed on-screen pixel tolerance by `1 / viewport.scale` so a connector stays equally easy to
 * click at any zoom level; this flat default suits callers with no viewport to hand (tests,
 * non-interactive checks).
 */
const DEFAULT_TOLERANCE = 6;

export interface HitTestOptions {
  tolerance?: number;
  /**
   * When true, elements with `hidden: true` are excluded from the result set —
   * used by pointer-driven paths (click, pointerdown) in `CanvasController` so hidden elements
   * are invisible to the mouse but still reachable by keyboard (M18.4).
   */
  excludeHidden?: boolean;
}

/**
 * Tests whether `point` is inside the element's own bounding box, accounting for rotation
 * (M20). For unrotated elements this is a plain axis-aligned bbox test; for rotated ones the
 * point is inverse-rotated about the element's own center before the unrotated bbox is tested —
 * equivalent to, but cheaper than, a full polygon-contains check.
 */
function bboxContains(el: SceneElement, point: Point): boolean {
  if (el.rotation) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const rad = (-el.rotation * Math.PI) / 180; // inverse rotation
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = point.x - cx;
    const dy = point.y - cy;
    const lx = cx + dx * cos - dy * sin;
    const ly = cy + dx * sin + dy * cos;
    return lx >= el.x && lx <= el.x + el.w && ly >= el.y && ly <= el.y + el.h;
  }
  return (
    point.x >= el.x &&
    point.x <= el.x + el.w &&
    point.y >= el.y &&
    point.y <= el.y + el.h
  );
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

/** Shortest distance from `point` to the segment a→b. */
function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function distanceToPolyline(point: Point, points: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    min = Math.min(min, distanceToSegment(point, points[i]!, points[i + 1]!));
  }
  return min;
}

function matches(
  scene: Scene,
  el: SceneElement,
  point: Point,
  tolerance: number,
): boolean {
  if (el.type === "connector")
    return (
      distanceToPolyline(point, connectorPathPoints(scene, el)) <= tolerance
    );
  return bboxContains(el, point);
}

/**
 * Every element whose geometry contains (or, for a connector, is within tolerance of) `point`,
 * ordered for both a single `hitTest()` pick and alt-click "click through" cycling: a genuine
 * ancestor/descendant pair always resolves toward the descendant (a nested icon before the box it
 * sits inside, before that box's own boundary) — then z-order (topmost wins) for every other
 * overlap, including same-depth siblings and elements with no containment relationship at all
 * (e.g. a connector, which never has a `parentId`, overlapping an unrelated container). This
 * replaces the previous z-order-only heuristic, which only happened to prefer children in the
 * common case because the editor's own placement/grouping flow tends to add a child after its
 * container (C9, docs/10-canvas-parity-plan.md) — not a rule the engine actually enforced. An
 * earlier version of this tie-break compared raw ancestor-*count* depth instead of an actual
 * ancestor relationship, which meant any unrelated container nested a level or more deep always
 * beat a connector (always depth 0) regardless of z-order or of whether the two were related at
 * all — the fix here is the relationship check, not just the depth number.
 */
export function hitTestAll(
  scene: Scene,
  point: Point,
  options: HitTestOptions = {},
): SceneElement[] {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const elements = scene.all(); // z-order, bottom to top
  const zRank = new Map(elements.map((el, index) => [el.id, index]));
  const candidates = elements.filter(
    (el) =>
      !(options.excludeHidden && el.hidden) &&
      matches(scene, el, point, tolerance),
  );
  const ancestorIds = new Map(
    candidates.map((el) => [
      el.id,
      new Set(scene.ancestorsOf(el.id).map((a) => a.id)),
    ]),
  );
  return candidates.sort((a, b) => {
    if (ancestorIds.get(b.id)!.has(a.id)) return 1; // a is an ancestor of b -> b (descendant) wins
    if (ancestorIds.get(a.id)!.has(b.id)) return -1; // b is an ancestor of a -> a wins
    return zRank.get(b.id)! - zRank.get(a.id)!; // unrelated -> topmost wins
  });
}

/** The single best (deepest, then topmost) element at `point`, or undefined. */
export function hitTest(
  scene: Scene,
  point: Point,
  options?: HitTestOptions,
): SceneElement | undefined {
  return hitTestAll(scene, point, options)[0];
}

/**
 * Elements fully enclosed within `rect` — marquee selection semantics, matching draw.io and
 * Excalidraw (docs/10-canvas-parity-plan.md's Decisions taken: fully-enclosed, not intersect).
 * A connector is enclosed only if every point on its rendered path sits inside `rect`; every
 * other element is enclosed on its own declared bounds only — a marquee need not also enclose a
 * container's contents to pick up the container itself.
 */
export function hitTestRect(scene: Scene, rect: Rect): SceneElement[] {
  return scene.all().filter((el) => {
    if (el.type === "connector") {
      const points = connectorPathPoints(scene, el);
      return (
        points.length > 0 && points.every((point) => pointInRect(point, rect))
      );
    }
    // For a rotated element, all four rotated corners must be inside the marquee rect.
    if (el.rotation) {
      return rotatedCorners(el).every((corner) => pointInRect(corner, rect));
    }
    return (
      pointInRect({ x: el.x, y: el.y }, rect) &&
      pointInRect({ x: el.x + el.w, y: el.y + el.h }, rect)
    );
  });
}
