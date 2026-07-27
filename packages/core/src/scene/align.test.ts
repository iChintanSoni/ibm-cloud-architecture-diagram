import { describe, expect, it } from "vitest";
import { Scene } from "./scene.js";
import type { BoxElement, ConnectorElement } from "./types.js";
import { computeAlignMoves } from "./align.js";

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

function moveById(moves: ReturnType<typeof computeAlignMoves>) {
  return new Map(moves.map((m) => [m.id, { dx: m.dx, dy: m.dy }]));
}

describe("computeAlignMoves", () => {
  it("aligns left edges to the selection's own leftmost edge", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    scene._put(box("b", 50, 200, 100, 100));
    const moves = moveById(computeAlignMoves(scene, ["a", "b"], "left"));
    expect(moves.get("a")).toBeUndefined(); // already at x=0, the leftmost edge
    expect(moves.get("b")).toEqual({ dx: -50, dy: 0 });
  });

  it("aligns right edges to the selection's own rightmost edge", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100)); // right edge at 100
    scene._put(box("b", 50, 200, 200, 100)); // right edge at 250
    const moves = moveById(computeAlignMoves(scene, ["a", "b"], "right"));
    expect(moves.get("a")).toEqual({ dx: 150, dy: 0 });
    expect(moves.get("b")).toBeUndefined();
  });

  it("aligns horizontal centers to the selection's own horizontal center", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100)); // center x = 50
    scene._put(box("b", 200, 0, 100, 100)); // center x = 250
    // overall bbox: x 0..300, center x = 150
    const moves = moveById(computeAlignMoves(scene, ["a", "b"], "centerH"));
    expect(moves.get("a")).toEqual({ dx: 100, dy: 0 });
    expect(moves.get("b")).toEqual({ dx: -100, dy: 0 });
  });

  it("aligns top/bottom/middle the same way on the y axis", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    scene._put(box("b", 0, 300, 100, 200));
    expect(
      moveById(computeAlignMoves(scene, ["a", "b"], "top")).get("b"),
    ).toEqual({ dx: 0, dy: -300 });
    expect(
      moveById(computeAlignMoves(scene, ["a", "b"], "bottom")).get("a"),
    ).toEqual({ dx: 0, dy: 400 }); // overall bottom = 500, a's bottom = 100
    // overall bbox: y 0..500, middle y = 250; a's center y = 50, b's center y = 400
    const middle = moveById(computeAlignMoves(scene, ["a", "b"], "middle"));
    expect(middle.get("a")).toEqual({ dx: 0, dy: 200 });
    expect(middle.get("b")).toEqual({ dx: 0, dy: -150 });
  });

  it("returns [] for fewer than two alignable elements", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    expect(computeAlignMoves(scene, ["a"], "left")).toEqual([]);
    expect(computeAlignMoves(scene, [], "left")).toEqual([]);
    expect(computeAlignMoves(scene, ["missing"], "left")).toEqual([]);
  });

  it("dedupes repeated ids and drops unknown ids before counting toward the >= 2 minimum", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    scene._put(box("b", 50, 200, 100, 100));
    expect(computeAlignMoves(scene, ["a", "a", "missing"], "left")).toEqual([]);
    const moves = moveById(
      computeAlignMoves(scene, ["a", "a", "b", "missing"], "left"),
    );
    expect(moves.get("b")).toEqual({ dx: -50, dy: 0 });
  });

  it("excludes connectors from the alignable set", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    scene._put(box("b", 50, 200, 100, 100));
    scene._put(connector("c", "a", "b"));
    // Only "a" and a connector selected: fewer than two alignable elements, so no-op.
    expect(computeAlignMoves(scene, ["a", "c"], "left")).toEqual([]);
    // With "a" and "b" both present, "c" is simply dropped rather than throwing or contributing.
    const moves = moveById(computeAlignMoves(scene, ["a", "b", "c"], "left"));
    expect(moves.has("c")).toBe(false);
    expect(moves.get("b")).toEqual({ dx: -50, dy: 0 });
  });

  it("a container's bounding box includes its descendants", () => {
    const scene = new Scene();
    // "outer" itself spans x 0..50, but its child "inner" extends its visual footprint to x 300.
    scene._put(box("outer", 0, 0, 50, 50));
    scene._put(box("inner", 250, 0, 50, 50, "outer"));
    scene._put(box("solo", 500, 0, 50, 50));
    // overall bbox unions outer's full footprint (0..300) with solo's (500..550): x 0..550
    const moves = moveById(
      computeAlignMoves(scene, ["outer", "solo"], "right"),
    );
    // outer's own bbox (including "inner") has its right edge at 300, overall right edge at 550
    expect(moves.get("outer")).toEqual({ dx: 250, dy: 0 });
    expect(moves.get("solo")).toBeUndefined();
  });
});
