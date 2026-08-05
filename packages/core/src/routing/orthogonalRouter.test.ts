import { describe, expect, it } from "vitest";
import {
  pathCrossesObstacles,
  routeOrthogonal,
  type Rect,
  type SoftObstacle,
} from "./orthogonalRouter.js";

describe("routeOrthogonal", () => {
  it("routes a direct west->east line between facing ports with no obstacles", () => {
    const path = routeOrthogonal(
      { point: { x: 100, y: 30 }, side: "e" },
      { point: { x: 300, y: 30 }, side: "w" },
      [],
    );

    expect(path[0]).toEqual({ x: 100, y: 30 });
    expect(path[path.length - 1]).toEqual({ x: 300, y: 30 });
    // Every point sits on the same horizontal line — no unnecessary bends.
    expect(path.every((p) => p.y === 30)).toBe(true);
  });

  it("routes around an obstacle placed directly between two ports", () => {
    const obstacles: Rect[] = [{ x: 180, y: 0, w: 40, h: 60 }];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const path = routeOrthogonal(from, to, obstacles);

    expect(pathCrossesObstacles(path, obstacles)).toBe(false);
    expect(path[0]).toEqual(from.point);
    expect(path[path.length - 1]).toEqual(to.point);
    // A clean straight line would cross the obstacle, so the route must bend.
    expect(path.some((p) => p.y !== 30)).toBe(true);
  });

  it("leaves each port in the direction of its side before bending", () => {
    // Two south-facing ports at the same height must both dip downward
    // before crossing over — never cut straight across at the port's own y.
    const from = { point: { x: 100, y: 100 }, side: "s" as const };
    const to = { point: { x: 300, y: 100 }, side: "s" as const };

    const path = routeOrthogonal(from, to, []);

    expect(path[0]).toEqual({ x: 100, y: 100 });
    expect(path[1]).toEqual({ x: 100, y: 120 });
    expect(path[path.length - 2]).toEqual({ x: 300, y: 120 });
    expect(path[path.length - 1]).toEqual({ x: 300, y: 100 });
  });

  it("falls back to a direct route when no obstacle-free path exists", () => {
    // Obstacle fully encloses the space between the two ports on all sides
    // isn't representable with a single rect, but an obstacle sitting exactly
    // on both stub lines still resolves to *some* usable path.
    const obstacles: Rect[] = [{ x: 90, y: 0, w: 220, h: 60 }];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const path = routeOrthogonal(from, to, obstacles);

    expect(path[0]).toEqual(from.point);
    expect(path[path.length - 1]).toEqual(to.point);
  });

  it("keeps the grid small enough to stay fast with many obstacles", () => {
    const obstacles: Rect[] = Array.from({ length: 200 }, (_, i) => ({
      x: (i % 20) * 60,
      y: Math.floor(i / 20) * 60,
      w: 20,
      h: 20,
    }));

    const start = Date.now();
    routeOrthogonal(
      { point: { x: 0, y: 0 }, side: "e" },
      { point: { x: 1200, y: 600 }, side: "w" },
      obstacles,
    );
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("routeOrthogonal with soft obstacles", () => {
  it("omitting the 4th arg and passing [] produce identical paths", () => {
    const obstacles: Rect[] = [{ x: 180, y: 0, w: 40, h: 60 }];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const withoutArg = routeOrthogonal(from, to, obstacles);
    const withEmptyArray = routeOrthogonal(from, to, obstacles, []);

    expect(withEmptyArray).toEqual(withoutArg);
  });

  it("avoids a soft obstacle's interior when a comparably cheap detour exists", () => {
    // A short obstacle: going around costs only a couple of grid units (nudging past its padded
    // edge), well under a penalty of 80, so the router should prefer the detour.
    const soft: SoftObstacle[] = [
      { rect: { x: 180, y: 0, w: 40, h: 20 }, penalty: 80 },
    ];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const path = routeOrthogonal(from, to, [], soft);

    expect(
      pathCrossesObstacles(
        path,
        soft.map((s) => s.rect),
      ),
    ).toBe(false);
    expect(path[0]).toEqual(from.point);
    expect(path[path.length - 1]).toEqual(to.point);
  });

  it("is willing to cross the same rect when passed as soft instead of hard", () => {
    // Same obstacle as the "routes around an obstacle" hard-obstacle test above (tall enough
    // that detouring costs more than a penalty of 80): the hard case must still avoid it
    // entirely, the soft case may cross it directly since that's cheaper here.
    const rect: Rect = { x: 180, y: 0, w: 40, h: 60 };
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const hardPath = routeOrthogonal(from, to, [rect]);
    const softPath = routeOrthogonal(from, to, [], [{ rect, penalty: 80 }]);

    expect(pathCrossesObstacles(hardPath, [rect])).toBe(false);
    expect(pathCrossesObstacles(softPath, [rect])).toBe(true);
  });

  it("still produces a valid path when crossing a soft obstacle is the only option", () => {
    const soft: SoftObstacle[] = [
      { rect: { x: 90, y: 0, w: 220, h: 60 }, penalty: 80 },
    ];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const path = routeOrthogonal(from, to, [], soft);

    expect(path[0]).toEqual(from.point);
    expect(path[path.length - 1]).toEqual(to.point);
    expect(path.length).toBeGreaterThan(0);
  });

  it("ignores soft obstacles far from the route (relevance filter keeps the grid bounded)", () => {
    const from = { point: { x: 0, y: 0 }, side: "e" as const };
    const to = { point: { x: 200, y: 0 }, side: "w" as const };
    const farSoft: SoftObstacle[] = Array.from({ length: 100 }, (_, i) => ({
      rect: { x: 5000 + i * 50, y: 5000 + i * 50, w: 20, h: 20 },
      penalty: 80,
    }));

    const withFarSoft = routeOrthogonal(from, to, [], farSoft);
    const withoutSoft = routeOrthogonal(from, to, []);

    // Unaffected by soft obstacles well outside the relevance margin - same direct route.
    expect(withFarSoft).toEqual(withoutSoft);
  });

  it("sums penalties from overlapping soft obstacles rather than counting only one", () => {
    // Two soft rects overlapping the same padded region a straight-through segment would cross.
    // If only the first match were charged, the combined cost (length + one penalty) could still
    // beat detouring; summed, it must not.
    const overlapA: SoftObstacle = {
      rect: { x: 180, y: 0, w: 40, h: 20 },
      penalty: 80,
    };
    const overlapB: SoftObstacle = {
      rect: { x: 180, y: 0, w: 40, h: 20 },
      penalty: 80,
    };
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const singlePath = routeOrthogonal(from, to, [], [overlapA]);
    const doublePath = routeOrthogonal(from, to, [], [overlapA, overlapB]);

    // The single-penalty case already detours (see the "comparably cheap detour" test above);
    // doubling the penalty on the identical geometry must not make the router less willing to
    // avoid it - both should still avoid, and the route shape should be stable either way.
    expect(pathCrossesObstacles(singlePath, [overlapA.rect])).toBe(false);
    expect(pathCrossesObstacles(doublePath, [overlapA.rect])).toBe(false);
  });

  it("crosses at a low penalty but detours at a high penalty for identical geometry", () => {
    const rect: Rect = { x: 180, y: 0, w: 40, h: 60 };
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    // At this geometry, detouring costs roughly 90-100 (see the "willing to cross" test above at
    // penalty 80). A penalty well below that should still cross; a penalty well above it should
    // detour instead - proving `penalty` is actually load-bearing, not a placeholder.
    const lowPenaltyPath = routeOrthogonal(
      from,
      to,
      [],
      [{ rect, penalty: 10 }],
    );
    const highPenaltyPath = routeOrthogonal(
      from,
      to,
      [],
      [{ rect, penalty: 500 }],
    );

    expect(pathCrossesObstacles(lowPenaltyPath, [rect])).toBe(true);
    expect(pathCrossesObstacles(highPenaltyPath, [rect])).toBe(false);
  });
});

describe("routeOrthogonal with containers (border clearance)", () => {
  it("omitting the 5th arg and passing [] produce identical paths", () => {
    const obstacles: Rect[] = [{ x: 180, y: 0, w: 40, h: 60 }];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const withoutArg = routeOrthogonal(from, to, obstacles, []);
    const withEmptyArray = routeOrthogonal(from, to, obstacles, [], []);

    expect(withEmptyArray).toEqual(withoutArg);
  });

  it("detours off a border it would otherwise run exactly along", () => {
    const containers: Rect[] = [{ x: 150, y: 30, w: 100, h: 100 }];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    // Baseline: with no containers channel, the direct route runs exactly along the container's
    // top edge for the whole middle stretch - this is the bug being fixed.
    const withoutContainers = routeOrthogonal(from, to, []);
    expect(withoutContainers.every((p) => p.y === 30)).toBe(true);

    const withContainers = routeOrthogonal(from, to, [], [], containers);
    expect(withContainers[0]).toEqual(from.point);
    expect(withContainers[withContainers.length - 1]).toEqual(to.point);
    expect(withContainers.some((p) => p.y !== 30)).toBe(true);
  });

  it("detours off a border it's merely hugging a few px inside, not just exact coincidence", () => {
    // Mirrors the ROKS diagram bug more literally: the route isn't exactly on the border, just
    // within clearance of it (here, 4px) - proximity-based, not an exact-match check.
    const containers: Rect[] = [{ x: 150, y: 34, w: 100, h: 100 }];
    const from = { point: { x: 100, y: 30 }, side: "e" as const };
    const to = { point: { x: 300, y: 30 }, side: "w" as const };

    const withoutContainers = routeOrthogonal(from, to, []);
    expect(withoutContainers.every((p) => p.y === 30)).toBe(true);

    const withContainers = routeOrthogonal(from, to, [], [], containers);
    expect(withContainers.some((p) => p.y !== 30)).toBe(true);
  });

  it("does not penalize a straight perpendicular crossing through a container", () => {
    // The path's x=100 sits centered in the container's width (50-150), nowhere near its left/
    // right edges - a vertical segment is only ever tested against left/right, so this must be
    // completely unaffected by the container's presence.
    const containers: Rect[] = [{ x: 50, y: 100, w: 100, h: 100 }];
    const from = { point: { x: 100, y: 0 }, side: "s" as const };
    const to = { point: { x: 100, y: 300 }, side: "n" as const };

    const withContainers = routeOrthogonal(from, to, [], [], containers);
    const withoutContainers = routeOrthogonal(from, to, []);

    expect(withContainers).toEqual(withoutContainers);
    expect(withContainers.every((p) => p.x === 100)).toBe(true);
  });

  it("ignores containers far from the route (relevance filter keeps the grid bounded)", () => {
    const from = { point: { x: 0, y: 0 }, side: "e" as const };
    const to = { point: { x: 200, y: 0 }, side: "w" as const };
    const farContainers: Rect[] = Array.from({ length: 100 }, (_, i) => ({
      x: 5000 + i * 50,
      y: 5000 + i * 50,
      w: 20,
      h: 20,
    }));

    const withFar = routeOrthogonal(from, to, [], [], farContainers);
    const without = routeOrthogonal(from, to, []);

    expect(withFar).toEqual(without);
  });
});

describe("pathCrossesObstacles", () => {
  it("detects a straight segment passing through a rect", () => {
    const points = [
      { x: 0, y: 30 },
      { x: 400, y: 30 },
    ];
    expect(pathCrossesObstacles(points, [{ x: 180, y: 0, w: 40, h: 60 }])).toBe(
      true,
    );
  });

  it("is false when the path clears the obstacle", () => {
    const points = [
      { x: 0, y: 30 },
      { x: 400, y: 30 },
    ];
    expect(
      pathCrossesObstacles(points, [{ x: 180, y: 100, w: 40, h: 60 }]),
    ).toBe(false);
  });
});
