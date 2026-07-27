import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { clampRectToParentInset, PARENT_INSET, snapMove } from "./snapping.js";

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

// Every test below passes explicit gridSize/tolerance so the numbers are fully determined —
// relying on the module's own defaults would make assertions sensitive to tuning those constants
// for feel later. Widths/heights are chosen as multiples of gridSize so a box's left/center/right
// edges agree on the same grid offset, avoiding ties between them that would make "which edge
// won" ambiguous.
describe("snapMove", () => {
  it("snaps a proposed move to the nearest grid line within tolerance", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 20, 20));

    // Left edge lands at 3, 3px from the grid line at 0 — within tolerance 4.
    const result = snapMove(scene, ["a"], 3, 0, { gridSize: 10, tolerance: 4 });

    expect(result.dx).toBe(0);
    expect(result.guides).toContainEqual(
      expect.objectContaining({ orientation: "vertical", position: 0 }),
    );
  });

  it("leaves the delta unchanged when the nearest grid line is outside tolerance", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 20, 20));

    // Left edge lands at 5, exactly halfway between grid lines at 0 and 10 — outside tolerance 2.
    const result = snapMove(scene, ["a"], 5, 0, { gridSize: 10, tolerance: 2 });

    expect(result.dx).toBe(5);
    expect(result.guides.some((g) => g.orientation === "vertical")).toBe(false);
  });

  it("snaps to a sibling's edge and reports a guide spanning both elements", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 20, 20));
    scene._put(box("b", 100, 0, 20, 20));

    // gridSize 1000 keeps the grid from interfering — a's left edge (97) is 3px from b's left
    // edge (100), within tolerance 4.
    const result = snapMove(scene, ["a"], 97, 0, {
      gridSize: 1000,
      tolerance: 4,
    });

    expect(result.dx).toBe(100);
    expect(result.guides).toContainEqual(
      expect.objectContaining({
        orientation: "vertical",
        position: 100,
        start: 0,
        end: 20,
      }),
    );
  });

  it("snaps centers to a sibling's center on the perpendicular axis", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 20, 20)); // center (10, 10)
    scene._put(box("b", 300, 50, 20, 60)); // center (310, 80)

    // a's center-y after a +68 move is 78, 2px from b's center-y (80), within tolerance 4.
    const result = snapMove(scene, ["a"], 0, 68, {
      gridSize: 1000,
      tolerance: 4,
    });

    expect(result.dy).toBe(70);
    expect(result.guides).toContainEqual(
      expect.objectContaining({ orientation: "horizontal", position: 80 }),
    );
  });

  it("does not snap to elements outside its own parent scope", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 500, 500));
    scene._put(box("a", 10, 10, 20, 20, "parent"));
    scene._put(box("b", 200, 10, 20, 20)); // root level — a different parent than "a"

    const result = snapMove(scene, ["a"], 100, 0, {
      gridSize: 1000,
      tolerance: 4,
    });

    expect(result.dx).toBe(100);
  });

  it("clamps the move so a child can't cross its parent's bottom-right inset", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    scene._put(box("child", 20, 20, 40, 40, "parent"));

    const result = snapMove(scene, ["child"], 1000, 1000, {
      gridSize: 1000,
      tolerance: 4,
    });

    const max = 200 - PARENT_INSET - 40; // 144 (parent and child are both square here)
    expect(20 + result.dx).toBe(max);
    expect(20 + result.dy).toBe(max);
  });

  it("clamps the move so a child can't cross its parent's top-left inset", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    scene._put(box("child", 20, 20, 40, 40, "parent"));

    const result = snapMove(scene, ["child"], -1000, -1000, {
      gridSize: 1000,
      tolerance: 4,
    });

    expect(20 + result.dx).toBe(PARENT_INSET);
    expect(20 + result.dy).toBe(PARENT_INSET);
  });

  it("drops the guide for an axis the parent-inset clamp overrides", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    scene._put(box("child", 20, 20, 40, 40, "parent"));
    scene._put(box("sibling", 500, 500, 40, 40, "parent"));

    // The sibling's edges are an exact snap candidate, but landing on them would put "child"
    // outside the parent's bounds, so the clamp must win and the guide must not be reported.
    const result = snapMove(scene, ["child"], 480, 0, {
      gridSize: 1000,
      tolerance: 4,
    });

    expect(result.guides.some((g) => g.orientation === "vertical")).toBe(false);
    expect(20 + result.dx).toBe(200 - PARENT_INSET - 40);
  });

  it("moves multiple selected elements together using their combined bounding box", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 40, 40));
    scene._put(box("b", 100, 0, 40, 40));

    // Combined bbox spans x 0..140; left edge at 6 is 2px from the grid line at 8.
    const result = snapMove(scene, ["a", "b"], 6, 0, {
      gridSize: 8,
      tolerance: 4,
    });

    expect(result.dx).toBe(8);
  });

  it("returns the delta unchanged for an unknown or empty selection", () => {
    const scene = new Scene();
    expect(snapMove(scene, ["missing"], 5, 5)).toEqual({
      dx: 5,
      dy: 5,
      guides: [],
    });
    expect(snapMove(scene, [], 5, 5)).toEqual({ dx: 5, dy: 5, guides: [] });
  });
});

// Resize's own parent-inset clamp (M17.3, docs/10-canvas-parity-plan.md) — unlike snapMove's
// whole-bbox clamp above (a move translates rigidly), each edge here is independent: a resize
// handle only ever moves a subset of the four edges, so only the edge(s) actually dragged should
// ever be capped.
describe("clampRectToParentInset", () => {
  it("leaves an already-valid rect untouched", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    const rect = { x: 20, y: 20, w: 40, h: 40 };

    expect(clampRectToParentInset(scene, "parent", rect)).toEqual(rect);
  });

  it("clamps the left/top edges without touching the anchored right/bottom edges", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    // west-handle drag: left edge pushed past the inset, right edge (60) stays anchored.
    const rect = { x: -100, y: 20, w: 160, h: 40 };

    const result = clampRectToParentInset(scene, "parent", rect);

    expect(result.x).toBe(PARENT_INSET);
    expect(result.x + result.w).toBe(60); // right edge unchanged
    expect(result.y).toBe(20);
    expect(result.h).toBe(40);
  });

  it("clamps the right/bottom edges without touching the anchored left/top edges", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    // se-handle drag: right/bottom edges pushed past the inset, top-left (20,20) stays anchored.
    const rect = { x: 20, y: 20, w: 1000, h: 1000 };

    const result = clampRectToParentInset(scene, "parent", rect);

    expect(result.x).toBe(20);
    expect(result.y).toBe(20);
    expect(result.x + result.w).toBe(200 - PARENT_INSET);
    expect(result.y + result.h).toBe(200 - PARENT_INSET);
  });

  it("floors width/height at 1 rather than collapsing past it", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, 200, 200));
    // Both edges pushed past the *same* boundary — a degenerate case a real resize handle
    // wouldn't produce (its anchor stays put), but the floor still guards against it.
    const rect = { x: -500, y: 20, w: 10, h: 40 };

    const result = clampRectToParentInset(scene, "parent", rect);

    expect(result.w).toBeGreaterThanOrEqual(1);
  });

  it("returns the rect unchanged for an undefined or unknown parent", () => {
    const scene = new Scene();
    const rect = { x: -100, y: -100, w: 40, h: 40 };

    expect(clampRectToParentInset(scene, undefined, rect)).toEqual(rect);
    expect(clampRectToParentInset(scene, "missing", rect)).toEqual(rect);
  });

  it("leaves the rect untouched against a parent too small to fit the inset on both sides", () => {
    const scene = new Scene();
    // 10 < 2 * PARENT_INSET (32) on both axes — no valid inset window exists.
    scene._put(box("tiny-parent", 0, 0, 10, 10));
    const rect = { x: 100, y: 100, w: 40, h: 40 };

    expect(clampRectToParentInset(scene, "tiny-parent", rect)).toEqual(rect);
  });
});
