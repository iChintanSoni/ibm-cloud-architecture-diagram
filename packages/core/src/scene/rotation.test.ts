/**
 * M20 rotation geometry tests (docs/10-canvas-parity-plan.md).
 * Covers rotatedCorners, rotatedBounds, rotation-aware hit-testing, the rotateElement command,
 * and the two new linter rules (non-zero-rotation, off-palette-color).
 */
import { describe, expect, it } from "vitest";
import { rotatedBounds, rotatedCorners } from "./bounds.js";
import { Scene } from "./scene.js";
import type { BoxElement } from "./types.js";
import { rotateElement } from "../commands/commands.js";
import { hitTest } from "../interaction/hitTest.js";
import { nonZeroRotationRule, offPaletteColorRule } from "../linter/rules.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function box(id: string, extra: Partial<BoxElement> = {}): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 100,
    y: 100,
    w: 80,
    h: 60,
    ...extra,
  };
}

// ─── rotatedCorners / rotatedBounds ──────────────────────────────────────────

describe("rotatedCorners", () => {
  it("returns axis-aligned corners when rotation is 0", () => {
    const el = { x: 0, y: 0, w: 40, h: 20 };
    const corners = rotatedCorners(el, 0);
    expect(corners).toHaveLength(4);
    // Corners should be the four corners of the unrotated rect
    const xs = corners.map((c) => c.x).sort((a, b) => a - b);
    const ys = corners.map((c) => c.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[3]).toBeCloseTo(40);
    expect(ys[0]).toBeCloseTo(0);
    expect(ys[3]).toBeCloseTo(20);
  });

  it("returns a square's own corners at 45° (all equidistant from center)", () => {
    const el = { x: 0, y: 0, w: 40, h: 40 };
    const corners = rotatedCorners(el, 45);
    const cx = 20;
    const cy = 20;
    for (const c of corners) {
      expect(Math.hypot(c.x - cx, c.y - cy)).toBeCloseTo(Math.hypot(20, 20), 5);
    }
  });

  it("reads rotation from the element when degrees arg is omitted", () => {
    const el = { x: 0, y: 0, w: 40, h: 40, rotation: 90 };
    const explicit = rotatedCorners(el, 90);
    const fromEl = rotatedCorners(el);
    expect(fromEl).toEqual(explicit);
  });
});

describe("rotatedBounds", () => {
  it("returns own rect when rotation is absent", () => {
    const el = { x: 10, y: 20, w: 80, h: 40 };
    expect(rotatedBounds(el)).toEqual({ x: 10, y: 20, w: 80, h: 40 });
  });

  it("returns own rect when rotation is 0", () => {
    expect(rotatedBounds({ x: 0, y: 0, w: 60, h: 30, rotation: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 60,
      h: 30,
    });
  });

  it("AABB at 90° is the transpose (w and h swapped) for a non-square rect", () => {
    const el = { x: 0, y: 0, w: 60, h: 20, rotation: 90 };
    const bounds = rotatedBounds(el);
    expect(bounds.w).toBeCloseTo(20, 4);
    expect(bounds.h).toBeCloseTo(60, 4);
  });

  it("AABB at 180° equals the original rect", () => {
    const el = { x: 10, y: 10, w: 60, h: 30, rotation: 180 };
    const bounds = rotatedBounds(el);
    expect(bounds.x).toBeCloseTo(10, 4);
    expect(bounds.y).toBeCloseTo(10, 4);
    expect(bounds.w).toBeCloseTo(60, 4);
    expect(bounds.h).toBeCloseTo(30, 4);
  });
});

// ─── rotation-aware hit-testing ───────────────────────────────────────────────

describe("hitTest with rotation", () => {
  it("hits a rotated element at its rotated center", () => {
    const scene = new Scene();
    scene._put(box("b", { x: 100, y: 100, w: 80, h: 20, rotation: 90 }));
    // At 90°, the center is still (140, 110). Center always stays hittable.
    const hit = hitTest(scene, { x: 140, y: 110 });
    expect(hit?.id).toBe("b");
  });

  it("does NOT hit a rotated element at a corner that rotated away", () => {
    const scene = new Scene();
    // A narrow tall rect rotated 90° now lies horizontal — its original top-right corner (180, 100)
    // is now in a different place; what's at that unrotated corner should miss.
    scene._put(box("b", { x: 100, y: 100, w: 20, h: 80, rotation: 90 }));
    // Before rotation, the top-left corner was at (100, 100). After 90° rotation about center
    // (110, 140), it maps elsewhere. So hitting (100, 100) should miss.
    const hit = hitTest(scene, { x: 100, y: 100 });
    expect(hit?.id).toBeUndefined();
  });
});

// ─── rotateElement command ────────────────────────────────────────────────────

describe("rotateElement command", () => {
  it("sets rotation, undo restores original state", () => {
    const scene = new Scene();
    scene._put(box("b"));
    const cmd = rotateElement(scene, "b", 45);
    cmd.do(scene);
    expect(scene.get("b")?.rotation).toBe(45);
    cmd.undo(scene);
    expect(scene.get("b")?.rotation).toBeUndefined();
  });

  it("normalises 360 to 0 (removes the field)", () => {
    const scene = new Scene();
    scene._put(box("b"));
    const cmd = rotateElement(scene, "b", 360);
    cmd.do(scene);
    expect(scene.get("b")?.rotation).toBeUndefined();
  });
});

// ─── linter rules ────────────────────────────────────────────────────────────

describe("nonZeroRotationRule", () => {
  it("flags elements with non-zero rotation", () => {
    const scene = new Scene();
    scene._put(box("b", { rotation: 45 }));
    const diags = nonZeroRotationRule(scene);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("non-zero-rotation");
    expect(diags[0]!.quickFix).toBeDefined();
  });

  it("does not flag elements without rotation", () => {
    const scene = new Scene();
    scene._put(box("b"));
    expect(nonZeroRotationRule(scene)).toHaveLength(0);
  });
});

describe("offPaletteColorRule", () => {
  it("flags a stroke outside the IBM palette", () => {
    const scene = new Scene();
    scene._put(box("b", { style: { stroke: "#deadbe" } }));
    const diags = offPaletteColorRule(scene);
    expect(diags.some((d) => d.ruleId === "off-palette-color")).toBe(true);
  });

  it("does not flag a stroke inside the IBM palette", () => {
    const scene = new Scene();
    scene._put(box("b", { style: { stroke: "#0f62fe" } }));
    expect(offPaletteColorRule(scene)).toHaveLength(0);
  });

  it("does not flag a secondary fill inside the palette", () => {
    const scene = new Scene();
    scene._put(box("b", { style: { fill: "#edf5ff" } }));
    expect(offPaletteColorRule(scene)).toHaveLength(0);
  });
});
