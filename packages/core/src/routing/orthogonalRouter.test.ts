import { describe, expect, it } from "vitest";
import {
  pathCrossesObstacles,
  routeOrthogonal,
  type Rect,
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
