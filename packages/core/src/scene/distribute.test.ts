import { describe, expect, it } from "vitest";
import { Scene } from "./scene.js";
import type { BoxElement, ConnectorElement } from "./types.js";
import { computeDistributeMoves } from "./distribute.js";

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId?: string,
): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y,
    w,
    h,
    ...(parentId ? { parentId } : {}),
  };
}

function connector(id: string, from: string, to: string): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: from, port: "e" },
    to: { elementId: to, port: "w" },
    connectorType: "connection",
  };
}

function moveById(moves: ReturnType<typeof computeDistributeMoves>) {
  return new Map(moves.map((m) => [m.id, { dx: m.dx, dy: m.dy }]));
}

describe("computeDistributeMoves", () => {
  it("distributes three equal-width elements evenly across horizontal space", () => {
    // a: x 0..50, b: x 200..250, c: x 300..400
    // anchor: a (lo 0, hi 50) and c (lo 300, hi 400)
    // total space between anchors = 300 - 50 = 250
    // interior sizes = 50 (b), gap = (250 - 50) / 2 = 100
    // b target lo = 50 + 100 = 150; b is currently at 200 → dx = -50
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 200, 0, 50, 50));
    scene._put(box("c", 300, 0, 100, 50));
    const moves = moveById(
      computeDistributeMoves(scene, ["a", "b", "c"], "horizontal"),
    );
    expect(moves.get("a")).toBeUndefined(); // left anchor, never moves
    expect(moves.get("c")).toBeUndefined(); // right anchor, never moves
    expect(moves.get("b")).toEqual({ dx: -50, dy: 0 }); // 150 - 200 = -50
  });

  it("distributes three elements evenly along the vertical axis", () => {
    // a: y 0..50, b: y 200..250, c: y 300..400
    // anchor: a (lo 0, hi 50) and c (lo 300, hi 400)
    // total space = 300 - 50 = 250; interior = 50; gap = 100
    // b target lo = 50 + 100 = 150; dx = 150 - 200 = -50
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 0, 200, 50, 50));
    scene._put(box("c", 0, 300, 50, 100));
    const moves = moveById(
      computeDistributeMoves(scene, ["a", "b", "c"], "vertical"),
    );
    expect(moves.get("a")).toBeUndefined();
    expect(moves.get("c")).toBeUndefined();
    expect(moves.get("b")).toEqual({ dx: 0, dy: -50 });
  });

  it("distributes four elements with unequal widths, anchoring the two outermost", () => {
    // a: x 0..100, b: x 200..250, c: x 300..350, d: x 500..600
    // anchor: a (hi 100) and d (lo 500)
    // total space = 500 - 100 = 400
    // interior sizes = 50 (b) + 50 (c) = 100; gapCount = 3
    // gap = (400 - 100) / 3 = 100
    // b target lo = 100 + 100 = 200 → no move (already at 200)
    // c target lo = 200 + 50 + 100 = 350 → dx = 0 (already at 300... wait: 350 - 300 = 50)
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 50));
    scene._put(box("b", 200, 0, 50, 50));
    scene._put(box("c", 300, 0, 50, 50));
    scene._put(box("d", 500, 0, 100, 50));
    const moves = moveById(
      computeDistributeMoves(scene, ["a", "b", "c", "d"], "horizontal"),
    );
    expect(moves.get("a")).toBeUndefined();
    expect(moves.get("d")).toBeUndefined();
    expect(moves.get("b")).toBeUndefined(); // already correctly placed (dx=0 omitted)
    expect(moves.get("c")).toEqual({ dx: 50, dy: 0 }); // 350 - 300 = 50
  });

  it("returns [] if elements are already evenly spaced", () => {
    // a: x 0..50, b: x 100..150, c: x 200..250 — gaps are uniformly 50
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 100, 0, 50, 50));
    scene._put(box("c", 200, 0, 50, 50));
    expect(
      computeDistributeMoves(scene, ["a", "b", "c"], "horizontal"),
    ).toEqual([]);
  });

  it("returns [] for fewer than three distributable elements", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 200, 0, 50, 50));
    expect(computeDistributeMoves(scene, [], "horizontal")).toEqual([]);
    expect(computeDistributeMoves(scene, ["a"], "horizontal")).toEqual([]);
    expect(computeDistributeMoves(scene, ["a", "b"], "horizontal")).toEqual([]);
    expect(
      computeDistributeMoves(scene, ["a", "missing"], "horizontal"),
    ).toEqual([]);
  });

  it("dedupes repeated ids and drops unknown ids before the >= 3 check", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 200, 0, 50, 50));
    // Two real elements even if repeated many times: still only 2 distributable, not enough.
    expect(
      computeDistributeMoves(
        scene,
        ["a", "a", "b", "b", "missing"],
        "horizontal",
      ),
    ).toEqual([]);
    // Three distinct real elements: distributable.
    scene._put(box("c", 300, 0, 100, 50));
    const moves = moveById(
      computeDistributeMoves(
        scene,
        ["a", "a", "b", "missing", "c"],
        "horizontal",
      ),
    );
    expect(moves.has("b")).toBe(true); // b should have moved
  });

  it("excludes connectors from the distributable set", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 200, 0, 50, 50));
    scene._put(box("c", 300, 0, 100, 50));
    scene._put(connector("conn", "a", "b"));
    // Three real elements + connector: connector is dropped, three elements remain.
    const moves = moveById(
      computeDistributeMoves(scene, ["a", "b", "c", "conn"], "horizontal"),
    );
    expect(moves.has("conn")).toBe(false);
    expect(moves.has("b")).toBe(true);
    // With fewer than three once connector is removed: no-op.
    expect(
      computeDistributeMoves(scene, ["a", "b", "conn"], "horizontal"),
    ).toEqual([]);
  });

  it("uses the full bbox including descendants (same as computeAlignMoves)", () => {
    const scene = new Scene();
    // "outer" declared at x 0 w 50, but its child "inner" extends to x 300.
    scene._put(box("outer", 0, 0, 50, 50));
    scene._put(box("inner", 250, 0, 50, 50, "outer")); // outerBbox = x 0..300
    scene._put(box("mid", 350, 0, 50, 50));
    scene._put(box("solo", 500, 0, 100, 50));
    // With bbox: outer x 0..300, mid x 350..400, solo x 500..600
    // anchor: outer (hi 300) and solo (lo 500)
    // total space = 500 - 300 = 200; interior = 50 (mid); gap = (200-50)/2 = 75
    // mid target lo = 300 + 75 = 375; currently at 350 → dx = 25
    const moves = moveById(
      computeDistributeMoves(scene, ["outer", "mid", "solo"], "horizontal"),
    );
    expect(moves.get("outer")).toBeUndefined();
    expect(moves.get("solo")).toBeUndefined();
    expect(moves.get("mid")).toEqual({ dx: 25, dy: 0 });
  });

  it("sorts by leading edge regardless of the order ids are passed in", () => {
    // Same three elements as first test but passed in reverse order.
    const scene = new Scene();
    scene._put(box("a", 0, 0, 50, 50));
    scene._put(box("b", 200, 0, 50, 50));
    scene._put(box("c", 300, 0, 100, 50));
    const forward = moveById(
      computeDistributeMoves(scene, ["a", "b", "c"], "horizontal"),
    );
    const reverse = moveById(
      computeDistributeMoves(scene, ["c", "b", "a"], "horizontal"),
    );
    expect(forward).toEqual(reverse);
  });
});
