import type { Rect } from "../routing/orthogonalRouter.js";
import type { Scene } from "./scene.js";
import type { ElementId, SceneElement } from "./types.js";

/**
 * Returns the four corners of an element's own bounding box, rotated about its own center by
 * `degrees`. Used to build the axis-aligned bounding box of a rotated element for hit-testing,
 * auto-grow, alignment, and distribute — all of which work in the canvas's unrotated coordinate
 * space even when the element itself is displayed rotated (M20, docs/10-canvas-parity-plan.md).
 */
export function rotatedCorners(
  el: { x: number; y: number; w: number; h: number; rotation?: number },
  degrees = el.rotation ?? 0,
): Array<{ x: number; y: number }> {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = el.w / 2;
  const hh = el.h / 2;
  return [
    { x: cx + -hw * cos - -hh * sin, y: cy + -hw * sin + -hh * cos },
    { x: cx + hw * cos - -hh * sin, y: cy + hw * sin + -hh * cos },
    { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos },
    { x: cx + -hw * cos - hh * sin, y: cy + -hw * sin + hh * cos },
  ];
}

/**
 * Axis-aligned bounding box for `el` accounting for its `rotation` — equals `{el.x,el.y,el.w,el.h}`
 * when rotation is zero or absent (the common case; calling code doesn't need to special-case it).
 */
export function rotatedBounds(el: {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}): Rect {
  if (!el.rotation) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const corners = rotatedCorners(el);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
  };
}

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
      rects.push(rotatedBounds(el));
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

/**
 * Smallest rect containing `bbox` plus `padding` on every side, unioned with `existing` (never
 * shrinking below it) when given. With no `existing`, this is exactly the sizing
 * `Editor.groupElements()` already used to size a brand-new container to its contents; with one,
 * it's `autoFitContainer`'s own "grow to fit, never shrink" rule (M17.4,
 * docs/10-canvas-parity-plan.md).
 */
export function fitRectWithPadding(
  bbox: Rect,
  padding: number,
  existing?: Rect,
): Rect {
  const minX = Math.min(bbox.x - padding, existing?.x ?? Infinity);
  const minY = Math.min(bbox.y - padding, existing?.y ?? Infinity);
  const maxX = Math.max(
    bbox.x + bbox.w + padding,
    existing ? existing.x + existing.w : -Infinity,
  );
  const maxY = Math.max(
    bbox.y + bbox.h + padding,
    existing ? existing.y + existing.h : -Infinity,
  );
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The smallest rect containing every current child of `containerId` plus a `padding` buffer on
 * every side (M17.4, docs/10-canvas-parity-plan.md) — reuses `fitRectWithPadding`, the same
 * bbox+padding math `groupElements()` uses at creation time, generalized to an *existing*
 * container: the result never shrinks below the container's own current bounds (auto-grow only
 * ever expands — a resize's own explicit shrink-and-reflow is M17.5's job, not this). Returns
 * `undefined` for an unknown container or one with no children (nothing to fit around, so nothing
 * to grow for).
 */
export function autoFitContainer(
  scene: Scene,
  containerId: ElementId,
  padding = 16,
): Rect | undefined {
  const container = scene.get(containerId);
  if (!container) return undefined;
  const children = scene.childrenOf(containerId);
  if (children.length === 0) return undefined;
  const bbox = boundsOf(
    scene,
    children.map((child) => child.id),
  );
  if (!bbox) return undefined;
  return fitRectWithPadding(bbox, padding, container);
}
