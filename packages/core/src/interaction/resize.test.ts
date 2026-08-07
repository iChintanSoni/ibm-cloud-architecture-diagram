import { describe, expect, it } from "vitest";
import { reflowChildren, resizeBounds, resizeCursor } from "./resize.js";

const START = { x: 100, y: 100, w: 200, h: 100 };

describe("resizeBounds", () => {
  it("e: grows width only, from the left edge", () => {
    expect(resizeBounds(START, "e", 30, 0)).toEqual({
      x: 100,
      y: 100,
      w: 230,
      h: 100,
    });
  });

  it("w: shrinks width and moves x, right edge stays anchored", () => {
    const result = resizeBounds(START, "w", 40, 0);
    expect(result).toEqual({ x: 140, y: 100, w: 160, h: 100 });
    expect(result.x + result.w).toBe(START.x + START.w); // right edge unchanged
  });

  it("n: moves y and shrinks height, bottom edge stays anchored", () => {
    const result = resizeBounds(START, "n", 0, 20);
    expect(result).toEqual({ x: 100, y: 120, w: 200, h: 80 });
    expect(result.y + result.h).toBe(START.y + START.h);
  });

  it("s: grows height only, top edge stays anchored", () => {
    expect(resizeBounds(START, "s", 0, 25)).toEqual({
      x: 100,
      y: 100,
      w: 200,
      h: 125,
    });
  });

  it("se: grows both dimensions from the fixed top-left corner", () => {
    expect(resizeBounds(START, "se", 10, 20)).toEqual({
      x: 100,
      y: 100,
      w: 210,
      h: 120,
    });
  });

  it("nw: top-left corner drag keeps the bottom-right corner fixed", () => {
    const result = resizeBounds(START, "nw", 10, 10);
    expect(result).toEqual({ x: 110, y: 110, w: 190, h: 90 });
    expect(result.x + result.w).toBe(START.x + START.w);
    expect(result.y + result.h).toBe(START.y + START.h);
  });

  it("clamps to a minimum size instead of flipping orientation", () => {
    const result = resizeBounds(START, "e", -500, 0);
    expect(result.w).toBe(1);
    expect(result.x).toBe(START.x); // left edge never moves for an "e" handle
  });

  it("clamps a shrink-from-the-left past the opposite edge without flipping", () => {
    const result = resizeBounds(START, "w", 500, 0);
    expect(result.w).toBe(1);
    expect(result.x + result.w).toBe(START.x + START.w); // right edge still anchored
  });

  describe("fromCenter (Alt)", () => {
    it("e: grows symmetrically, keeping the center fixed", () => {
      const result = resizeBounds(START, "e", 20, 0, { fromCenter: true });
      expect(result).toEqual({ x: 80, y: 100, w: 240, h: 100 });
      expect(result.x + result.w / 2).toBe(START.x + START.w / 2);
    });

    it("se: grows both dimensions symmetrically around the original center", () => {
      const result = resizeBounds(START, "se", 20, 10, { fromCenter: true });
      expect(result.x + result.w / 2).toBe(START.x + START.w / 2);
      expect(result.y + result.h / 2).toBe(START.y + START.h / 2);
      expect(result.w).toBe(240);
      expect(result.h).toBe(120);
    });
  });

  describe("aspectLock (Shift, corner handles only)", () => {
    it("se: derives height from width using the original ratio when dx dominates", () => {
      const result = resizeBounds(START, "se", 40, 5, { aspectLock: true });
      expect(result.w).toBe(240);
      expect(result.h).toBe(120); // 240 / (200/100)
    });

    it("se: derives width from height using the original ratio when dy dominates", () => {
      const result = resizeBounds(START, "se", 5, 40, { aspectLock: true });
      expect(result.h).toBe(140);
      expect(result.w).toBe(280); // 140 * (200/100)
    });

    it("nw: keeps the bottom-right corner anchored while locking aspect ratio", () => {
      const result = resizeBounds(START, "nw", -20, -5, { aspectLock: true });
      expect(result.x + result.w).toBe(START.x + START.w);
      expect(result.y + result.h).toBe(START.y + START.h);
    });

    it("is ignored on edge (non-corner) handles", () => {
      const withLock = resizeBounds(START, "e", 30, 0, { aspectLock: true });
      const withoutLock = resizeBounds(START, "e", 30, 0, {
        aspectLock: false,
      });
      expect(withLock).toEqual(withoutLock);
    });
  });
});

// Container-resize reflow (M17.5, packages/core/docs/canvas-parity-plan.md) — repositions a child pinched by
// a shrinking container, never resizes it.
describe("reflowChildren", () => {
  const CONTAINER_AFTER = { x: 0, y: 0, w: 100, h: 100 };

  it("leaves a child untouched when it already keeps its own 16px buffer", () => {
    const children = [{ id: "a", x: 20, y: 20, w: 40, h: 40 }];
    expect(reflowChildren(children, CONTAINER_AFTER)).toEqual(new Map());
  });

  it("pulls a child in from the left/top edge it violates", () => {
    const children = [{ id: "a", x: 5, y: 5, w: 40, h: 40 }];
    const result = reflowChildren(children, CONTAINER_AFTER);
    expect(result.get("a")).toEqual({ x: 16, y: 16, w: 40, h: 40 });
  });

  it("pulls a child in from the right/bottom edge it violates, left/top untouched", () => {
    const children = [{ id: "a", x: 50, y: 50, w: 40, h: 40 }]; // right/bottom edge at 90, buffer 10
    const result = reflowChildren(children, CONTAINER_AFTER);
    expect(result.get("a")).toEqual({ x: 44, y: 44, w: 40, h: 40 }); // 100-16-40
  });

  it("only touches the children that actually need it, leaving others out of the map entirely", () => {
    const children = [
      { id: "fine", x: 20, y: 20, w: 40, h: 40 },
      { id: "pinched", x: 5, y: 5, w: 40, h: 40 },
    ];
    const result = reflowChildren(children, CONTAINER_AFTER);
    expect(result.has("fine")).toBe(false);
    expect(result.get("pinched")).toEqual({ x: 16, y: 16, w: 40, h: 40 });
  });

  it("anchors to the near edge without resizing a child too large to satisfy both sides", () => {
    // 90-wide child in a 100-wide container: even fully centered it can't keep 16px on both
    // sides (needs 32 total, has only 10 to spare) — anchors to the near (left/top) edge's own
    // buffer rather than shrinking the child to fit both.
    const children = [{ id: "a", x: 5, y: 5, w: 90, h: 90 }];
    const result = reflowChildren(children, CONTAINER_AFTER);
    expect(result.get("a")).toEqual({ x: 16, y: 16, w: 90, h: 90 });
  });

  it("respects a custom padding value", () => {
    const children = [{ id: "a", x: 1, y: 1, w: 40, h: 40 }];
    const result = reflowChildren(children, CONTAINER_AFTER, 4);
    expect(result.get("a")).toEqual({ x: 4, y: 4, w: 40, h: 40 });
  });
});

describe("resizeCursor", () => {
  it("maps each handle to a direction-correct CSS cursor", () => {
    expect(resizeCursor("n")).toBe("ns-resize");
    expect(resizeCursor("s")).toBe("ns-resize");
    expect(resizeCursor("e")).toBe("ew-resize");
    expect(resizeCursor("w")).toBe("ew-resize");
    expect(resizeCursor("nw")).toBe("nwse-resize");
    expect(resizeCursor("se")).toBe("nwse-resize");
    expect(resizeCursor("ne")).toBe("nesw-resize");
    expect(resizeCursor("sw")).toBe("nesw-resize");
  });
});
