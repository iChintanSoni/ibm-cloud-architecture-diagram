import type { PortSide } from "../scene/types.js";
import type { Point } from "../render/port.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoutePort {
  point: Point;
  side: PortSide;
  /**
   * Extra px added atop the router's own base STUB for this port only (default 0) — see
   * routeConnector.ts's portStubStagger: staggers where a connector first becomes free to bend,
   * so sibling connectors sharing a port don't all choose the identical bend point and produce an
   * uneven or overlapping shared trunk before diverging toward their own distinct targets (M27.5).
   */
  stubExtraPx?: number;
}

/**
 * A rect that adds `penalty` cost to a segment crossing its padded interior, instead of
 * hard-blocking it the way `obstacles` do — the router prefers a detour when one is cheap but
 * still produces a route if crossing is the only option. Two independent producers currently feed
 * this (see routeConnector.ts): containers unrelated to either endpoint, and every container's own
 * label footprint, each with its own penalty weight, both handled by this one mechanism rather
 * than duplicating the grid/pathfinding plumbing per producer.
 */
export interface SoftObstacle {
  rect: Rect;
  penalty: number;
}

/** Distance a route travels straight out of a port before it's allowed to bend. */
const STUB = 20;
/** Clearance kept around obstacle rects when routing past them. */
const PADDING = 12;
/** Extra cost charged per direction change; biases the router toward fewer bends. */
const BEND_PENALTY = 8;
/** Cost multiplier on leftward segments — a mild nudge toward the IBM west→east reading convention. */
const BACKTRACK_PENALTY = 1.25;
/** Safety valve: above this many grid nodes, skip obstacle avoidance and return a direct route. */
const MAX_GRID_NODES = 4000;
const EPSILON = 0.01;
/**
 * Soft obstacles farther than this from the route's own start/end stubs are dropped before
 * building the grid, so a diagram with many containers scattered elsewhere on the canvas can't
 * blow MAX_GRID_NODES and silently fall back to the crude direct route for connectors that don't
 * need soft-obstacle avoidance at all.
 */
const SOFT_OBSTACLE_RELEVANCE_MARGIN = 150;
/**
 * Minimum clearance a route tries to keep from a container's (box/group/zone) border when running
 * *parallel* to it — distinct from PADDING, which governs clearance from hard/soft obstacle rects.
 * Containers are deliberately never obstacles (see routeOrthogonal's doc comment below — connectors
 * must be able to cross a box/zone boundary), so without this a route parallel to a container edge
 * has no cost reason to stand off from it, and can end up running exactly along — or a few px
 * inside — a border it isn't even trying to cross. Only ever charged against a segment's
 * same-orientation edge pair (horizontal segment vs. top/bottom, vertical vs. left/right) — a
 * perpendicular crossing segment is tested against the opposite pair and so is never charged this
 * cost, regardless of proximity. Tunable; refine by visual inspection, not by re-deriving
 * analytically.
 */
const BORDER_CLEARANCE_PX = 10;
/**
 * Cost per pixel of a segment's overlap with a container edge's extent while within
 * BORDER_CLEARANCE_PX of it, scaled by proximity (right on the edge costs full price per px,
 * fading toward 0 at the clearance boundary) — a brief, unavoidable graze costs little, while
 * hugging a long stretch of border costs roughly as much as a real unrelated-container crossing
 * (CONTAINER_SOFT_OBSTACLE_PENALTY in routeConnector.ts), enough to justify a modest detour when
 * one exists nearby. Tunable.
 */
const BORDER_HUG_PENALTY_PER_PX = 2;

function sideDelta(side: PortSide): Point {
  switch (side) {
    case "n":
      return { x: 0, y: -1 };
    case "s":
      return { x: 0, y: 1 };
    case "e":
      return { x: 1, y: 0 };
    case "w":
      return { x: -1, y: 0 };
    case "center":
      return { x: 0, y: 0 };
  }
}

function stubPoint(port: RoutePort, other: Point): Point {
  const length = STUB + (port.stubExtraPx ?? 0);
  const d = sideDelta(port.side);
  if (d.x === 0 && d.y === 0) {
    // Omnidirectional port: bias toward the west->east reading convention.
    const dir = other.x >= port.point.x ? 1 : -1;
    return { x: port.point.x + dir * length, y: port.point.y };
  }
  return { x: port.point.x + d.x * length, y: port.point.y + d.y * length };
}

function dedupeSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1]! > EPSILON) out.push(v);
  }
  return out;
}

/** True if the axis-aligned segment a→b passes through the padded interior of rect r. */
function segmentCrossesRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect,
): boolean {
  const left = r.x - PADDING;
  const right = r.x + r.w + PADDING;
  const top = r.y - PADDING;
  const bottom = r.y + r.h + PADDING;

  if (Math.abs(ay - by) < EPSILON) {
    if (ay <= top || ay >= bottom) return false;
    const lo = Math.min(ax, bx);
    const hi = Math.max(ax, bx);
    return lo < right && hi > left;
  }
  if (Math.abs(ax - bx) < EPSILON) {
    if (ax <= left || ax >= right) return false;
    const lo = Math.min(ay, by);
    const hi = Math.max(ay, by);
    return lo < bottom && hi > top;
  }
  return false;
}

/** True if any segment of the polyline passes through an obstacle's padded interior. */
export function pathCrossesObstacles(
  points: Point[],
  obstacles: Rect[],
): boolean {
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (obstacles.some((r) => segmentCrossesRect(a.x, a.y, b.x, b.y, r)))
      return true;
  }
  return false;
}

/**
 * Extra Dijkstra edge cost for a segment running parallel to, and within BORDER_CLEARANCE_PX of, a
 * container's border, proportional to how much of the edge's extent the segment overlaps and how
 * close it is. Only ever tests a segment against the container edges it could actually be parallel
 * to — a horizontal segment against top/bottom, a vertical segment against left/right — so a
 * legitimate perpendicular crossing (opposite-orientation edge) is never charged, and a segment
 * that's neither purely horizontal nor purely vertical (shouldn't occur — this router only ever
 * emits axis-aligned segments) is charged nothing.
 */
function borderHugCost(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  containers: Rect[],
): number {
  let cost = 0;
  if (Math.abs(ay - by) < EPSILON) {
    const lo = Math.min(ax, bx);
    const hi = Math.max(ax, bx);
    for (const r of containers) {
      for (const edgeY of [r.y, r.y + r.h]) {
        const dist = Math.abs(ay - edgeY);
        if (dist >= BORDER_CLEARANCE_PX) continue;
        const overlap = Math.min(hi, r.x + r.w) - Math.max(lo, r.x);
        if (overlap <= EPSILON) continue;
        const proximity = (BORDER_CLEARANCE_PX - dist) / BORDER_CLEARANCE_PX;
        cost += BORDER_HUG_PENALTY_PER_PX * overlap * proximity;
      }
    }
  } else if (Math.abs(ax - bx) < EPSILON) {
    const lo = Math.min(ay, by);
    const hi = Math.max(ay, by);
    for (const r of containers) {
      for (const edgeX of [r.x, r.x + r.w]) {
        const dist = Math.abs(ax - edgeX);
        if (dist >= BORDER_CLEARANCE_PX) continue;
        const overlap = Math.min(hi, r.y + r.h) - Math.max(lo, r.y);
        if (overlap <= EPSILON) continue;
        const proximity = (BORDER_CLEARANCE_PX - dist) / BORDER_CLEARANCE_PX;
        cost += BORDER_HUG_PENALTY_PER_PX * overlap * proximity;
      }
    }
  }
  return cost;
}

/** Drops consecutive duplicate/collinear points so the rendered path has only real bends. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (
      prev &&
      Math.abs(prev.x - p.x) < EPSILON &&
      Math.abs(prev.y - p.y) < EPSILON
    )
      continue;
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      const collinearHorizontal =
        Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - p.y) < EPSILON;
      const collinearVertical =
        Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - p.x) < EPSILON;
      if (collinearHorizontal || collinearVertical) {
        out.pop();
      }
    }
    out.push(p);
  }
  return out;
}

type Dir = "H" | "V" | "start";

interface HeapEntry {
  cost: number;
  i: number;
  j: number;
  dir: Dir;
}

/** Minimal binary min-heap — grid sizes here are small enough that this stays cheap. */
class MinHeap {
  private items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: HeapEntry): void {
    this.items.push(entry);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.cost <= this.items[i]!.cost) break;
      [this.items[parent], this.items[i]] = [
        this.items[i]!,
        this.items[parent]!,
      ];
      i = parent;
    }
  }

  pop(): HeapEntry | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (top === undefined) return undefined;
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (
          l < this.items.length &&
          this.items[l]!.cost < this.items[smallest]!.cost
        )
          smallest = l;
        if (
          r < this.items.length &&
          this.items[r]!.cost < this.items[smallest]!.cost
        )
          smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [
          this.items[i]!,
          this.items[smallest]!,
        ];
        i = smallest;
      }
    }
    return top;
  }
}

function directRoute(from: RoutePort, to: RoutePort): Point[] {
  const startStub = stubPoint(from, to.point);
  const endStub = stubPoint(to, from.point);
  return simplify([from.point, startStub, endStub, to.point]);
}

/**
 * Grid-based orthogonal (Manhattan) router. Candidate x/y lines are drawn
 * through both port stubs and every obstacle's padded edges; Dijkstra then
 * finds the shortest obstacle-free path over that grid, with a bend penalty
 * (fewer corners) and a mild west->east bias per docs/05's layout convention.
 * Falls back to a direct two-bend route if the grid would be too large, or
 * if no obstacle-free path exists.
 *
 * Obstacles are expected to be leaf shapes (icons/actors/text) only —
 * containers (box/group/zone/frame) are deliberately not routed around,
 * since IBM deployment diagrams routinely cross a box or zone boundary.
 *
 * softObstacles (default none, see the SoftObstacle doc comment above) is a separate, additive
 * channel: unlike the hard obstacles above, crossing one is never forbidden, only discouraged by
 * its own per-rect penalty cost. A segment crossing several overlapping soft obstacles pays for
 * all of them, summed, not just one.
 *
 * containers (default none) is a third, independent channel — see BORDER_CLEARANCE_PX's doc
 * comment above — that discourages a route from running *parallel to and within
 * BORDER_CLEARANCE_PX of* a container's border, without discouraging crossing it at all (a
 * perpendicular crossing is never charged). This is deliberately not folded into softObstacles:
 * SoftObstacle's per-rect flat penalty models "avoid this whole rect's interior," which is the
 * wrong shape for "don't hug this edge but feel free to cross it."
 */
export function routeOrthogonal(
  from: RoutePort,
  to: RoutePort,
  obstacles: Rect[],
  softObstacles: SoftObstacle[] = [],
  containers: Rect[] = [],
): Point[] {
  const startStub = stubPoint(from, to.point);
  const endStub = stubPoint(to, from.point);

  const relevanceLeft =
    Math.min(startStub.x, endStub.x) - SOFT_OBSTACLE_RELEVANCE_MARGIN;
  const relevanceRight =
    Math.max(startStub.x, endStub.x) + SOFT_OBSTACLE_RELEVANCE_MARGIN;
  const relevanceTop =
    Math.min(startStub.y, endStub.y) - SOFT_OBSTACLE_RELEVANCE_MARGIN;
  const relevanceBottom =
    Math.max(startStub.y, endStub.y) + SOFT_OBSTACLE_RELEVANCE_MARGIN;
  const relevantSoft = softObstacles.filter(
    (s) =>
      s.rect.x + s.rect.w >= relevanceLeft &&
      s.rect.x <= relevanceRight &&
      s.rect.y + s.rect.h >= relevanceTop &&
      s.rect.y <= relevanceBottom,
  );
  // Same relevance pruning as relevantSoft above, applied to the containers channel — a diagram
  // with many containers scattered elsewhere on the canvas shouldn't blow MAX_GRID_NODES for a
  // connector that has no border-clearance interaction with most of them.
  const relevantContainers = containers.filter(
    (r) =>
      r.x + r.w >= relevanceLeft &&
      r.x <= relevanceRight &&
      r.y + r.h >= relevanceTop &&
      r.y <= relevanceBottom,
  );

  const xs = dedupeSorted([
    startStub.x,
    endStub.x,
    ...obstacles.flatMap((r) => [r.x - PADDING, r.x + r.w + PADDING]),
    ...relevantSoft.flatMap((s) => [
      s.rect.x - PADDING,
      s.rect.x + s.rect.w + PADDING,
    ]),
    // Candidate lines just outside (and just inside) each vertical edge's clearance zone, so the
    // Dijkstra search actually has somewhere non-hugging to snap to — borderHugCost alone can only
    // penalize paths built from grid lines that already exist.
    ...relevantContainers.flatMap((r) => [
      r.x - BORDER_CLEARANCE_PX,
      r.x + BORDER_CLEARANCE_PX,
      r.x + r.w - BORDER_CLEARANCE_PX,
      r.x + r.w + BORDER_CLEARANCE_PX,
    ]),
  ]);
  const ys = dedupeSorted([
    startStub.y,
    endStub.y,
    ...obstacles.flatMap((r) => [r.y - PADDING, r.y + r.h + PADDING]),
    ...relevantSoft.flatMap((s) => [
      s.rect.y - PADDING,
      s.rect.y + s.rect.h + PADDING,
    ]),
    ...relevantContainers.flatMap((r) => [
      r.y - BORDER_CLEARANCE_PX,
      r.y + BORDER_CLEARANCE_PX,
      r.y + r.h - BORDER_CLEARANCE_PX,
      r.y + r.h + BORDER_CLEARANCE_PX,
    ]),
  ]);

  if (xs.length * ys.length > MAX_GRID_NODES) {
    return directRoute(from, to);
  }

  const xi = xs.indexOf(startStub.x);
  const yi = ys.indexOf(startStub.y);
  const xj = xs.indexOf(endStub.x);
  const yj = ys.indexOf(endStub.y);
  if (xi < 0 || yi < 0 || xj < 0 || yj < 0) {
    return directRoute(from, to);
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const stateKey = (i: number, j: number, dir: Dir) => `${i},${j},${dir}`;

  const heap = new MinHeap();
  const startKey = stateKey(xi, yi, "start");
  dist.set(startKey, 0);
  heap.push({ cost: 0, i: xi, j: yi, dir: "start" });

  let goalKey: string | undefined;

  while (heap.size > 0) {
    const current = heap.pop()!;
    const key = stateKey(current.i, current.j, current.dir);
    if ((dist.get(key) ?? Infinity) < current.cost - EPSILON) continue;
    if (current.i === xj && current.j === yj) {
      goalKey = key;
      break;
    }

    const neighbors: Array<{ i: number; j: number; dir: Dir }> = [];
    if (current.i > 0)
      neighbors.push({ i: current.i - 1, j: current.j, dir: "H" });
    if (current.i < xs.length - 1)
      neighbors.push({ i: current.i + 1, j: current.j, dir: "H" });
    if (current.j > 0)
      neighbors.push({ i: current.i, j: current.j - 1, dir: "V" });
    if (current.j < ys.length - 1)
      neighbors.push({ i: current.i, j: current.j + 1, dir: "V" });

    for (const n of neighbors) {
      const ax = xs[current.i]!;
      const ay = ys[current.j]!;
      const bx = xs[n.i]!;
      const by = ys[n.j]!;
      if (obstacles.some((r) => segmentCrossesRect(ax, ay, bx, by, r)))
        continue;

      let cost = Math.abs(bx - ax) + Math.abs(by - ay);
      if (n.dir === "H" && bx < ax) cost *= BACKTRACK_PENALTY;
      if (current.dir !== "start" && current.dir !== n.dir)
        cost += BEND_PENALTY;
      // Summed, not first-match: a segment grazing two overlapping soft obstacles (e.g. an
      // unrelated container and that same container's own label) pays for both.
      cost += relevantSoft.reduce(
        (sum, s) =>
          segmentCrossesRect(ax, ay, bx, by, s.rect) ? sum + s.penalty : sum,
        0,
      );
      cost += borderHugCost(ax, ay, bx, by, relevantContainers);

      const nextCost = current.cost + cost;
      const nextKey = stateKey(n.i, n.j, n.dir);
      if (nextCost < (dist.get(nextKey) ?? Infinity) - EPSILON) {
        dist.set(nextKey, nextCost);
        prev.set(nextKey, key);
        heap.push({ cost: nextCost, i: n.i, j: n.j, dir: n.dir });
      }
    }
  }

  if (!goalKey) {
    return directRoute(from, to);
  }

  const gridPath: Point[] = [];
  let cursor: string | undefined = goalKey;
  while (cursor) {
    const [i, j] = cursor.split(",");
    gridPath.push({ x: xs[Number(i)]!, y: ys[Number(j)]! });
    cursor = prev.get(cursor);
  }
  gridPath.reverse();

  return simplify([from.point, ...gridPath, to.point]);
}
