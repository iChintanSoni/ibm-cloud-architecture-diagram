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
 * Cost added (not blocked) for a segment crossing a soft obstacle's padded interior. 10x
 * BEND_PENALTY: enough to make the router prefer a 1-3 bend detour around an unrelated container
 * when one is available nearby, without being so large it distorts routing far from the obstacle.
 * Tunable; refine by visual inspection of a real multi-container diagram, not by re-deriving this
 * number analytically.
 */
const SOFT_OBSTACLE_PENALTY = 80;
/**
 * Soft obstacles farther than this from the route's own start/end stubs are dropped before
 * building the grid, so a diagram with many containers scattered elsewhere on the canvas can't
 * blow MAX_GRID_NODES and silently fall back to the crude direct route for connectors that don't
 * need soft-obstacle avoidance at all.
 */
const SOFT_OBSTACLE_RELEVANCE_MARGIN = 150;

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
  const d = sideDelta(port.side);
  if (d.x === 0 && d.y === 0) {
    // Omnidirectional port: bias toward the west->east reading convention.
    const dir = other.x >= port.point.x ? 1 : -1;
    return { x: port.point.x + dir * STUB, y: port.point.y };
  }
  return { x: port.point.x + d.x * STUB, y: port.point.y + d.y * STUB };
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
 * softObstacles (default none) is a separate, additive channel: rects that add
 * SOFT_OBSTACLE_PENALTY cost to a crossing segment instead of hard-blocking it, so the router
 * prefers a detour when one is cheap but still produces a route if crossing is the only option.
 * Used for containers unrelated to either endpoint (see containerAvoidanceRectsFor in
 * routeConnector.ts) - unlike the hard obstacles above, crossing one of these is never forbidden,
 * only discouraged.
 */
export function routeOrthogonal(
  from: RoutePort,
  to: RoutePort,
  obstacles: Rect[],
  softObstacles: Rect[] = [],
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
    ...relevantSoft.flatMap((r) => [r.x - PADDING, r.x + r.w + PADDING]),
  ]);
  const ys = dedupeSorted([
    startStub.y,
    endStub.y,
    ...obstacles.flatMap((r) => [r.y - PADDING, r.y + r.h + PADDING]),
    ...relevantSoft.flatMap((r) => [r.y - PADDING, r.y + r.h + PADDING]),
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
      if (relevantSoft.some((r) => segmentCrossesRect(ax, ay, bx, by, r)))
        cost += SOFT_OBSTACLE_PENALTY;

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
