import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, ViewportController } from "./viewport.js";

describe("ViewportController", () => {
  it("starts at the origin, unscaled", () => {
    const viewport = new ViewportController();
    expect(viewport.get()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("pans by a scene-space delta", () => {
    const viewport = new ViewportController();
    viewport.panBy(10, -4);
    expect(viewport.get()).toMatchObject({ x: 10, y: -4 });
  });

  it("zooms by a factor around the current center when no focal point is given", () => {
    const viewport = new ViewportController();
    viewport.zoomBy(2);
    expect(viewport.get().scale).toBe(2);
  });

  it("keeps the focal scene point fixed under the cursor while zooming", () => {
    const viewport = new ViewportController();
    viewport.set({ x: 0, y: 0, scale: 1 });
    viewport.zoomTo(2, { x: 100, y: 100 });
    // The focal point in scene space must map to the same pixel offset before/after.
    const state = viewport.get();
    expect((100 - state.x) * state.scale).toBeCloseTo((100 - 0) * 1, 5);
  });

  it("clamps scale to [MIN_SCALE, MAX_SCALE]", () => {
    const viewport = new ViewportController();
    viewport.zoomTo(1000);
    expect(viewport.get().scale).toBe(MAX_SCALE);
    viewport.zoomTo(0.0001);
    expect(viewport.get().scale).toBe(MIN_SCALE);
  });

  it("resets to the identity view", () => {
    const viewport = new ViewportController();
    viewport.set({ x: 50, y: 50, scale: 3 });
    viewport.reset();
    expect(viewport.get()).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("focuses on a rect, centering and fitting it within the viewport size", () => {
    const viewport = new ViewportController();
    viewport.focusOn(
      { x: 100, y: 100, w: 200, h: 100 },
      { w: 400, h: 400 },
      { padding: 0 },
    );
    const state = viewport.get();
    // Fit is bounded by the smaller ratio (400/200=2 vs 400/100=4) => scale 2.
    expect(state.scale).toBe(2);
    // Center of the rect (200,150) should map to the center of the viewport (200,200 scene px / scale).
    expect(state.x + 400 / (2 * state.scale)).toBeCloseTo(200, 5);
    expect(state.y + 400 / (2 * state.scale)).toBeCloseTo(150, 5);
  });

  it("caps focusOn scale at maxScale even when the rect is tiny", () => {
    const viewport = new ViewportController();
    viewport.focusOn(
      { x: 0, y: 0, w: 10, h: 10 },
      { w: 400, h: 400 },
      { padding: 0, maxScale: 1.5 },
    );
    expect(viewport.get().scale).toBe(1.5);
  });

  it("notifies subscribers on every state change and supports unsubscribing", () => {
    const viewport = new ViewportController();
    const seen: number[] = [];
    const unsubscribe = viewport.on((state) => seen.push(state.scale));
    viewport.zoomTo(2);
    unsubscribe();
    viewport.zoomTo(3);
    expect(seen).toEqual([2]);
  });
});
