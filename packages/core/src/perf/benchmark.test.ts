import { describe, expect, it } from "vitest";
import { createEditor } from "../api/createEditor.js";
import { Catalog } from "../catalog/catalog.js";
import { hitTestAll } from "../interaction/hitTest.js";
import { buildSyntheticDocument, SYNTHETIC_ASSETS, SYNTHETIC_CATALOG } from "./syntheticDiagram.js";

/**
 * Regression guard, not a real-browser performance target
 * (docs/09-roadmap.md#m12--performance-at-scale, docs/10-canvas-parity-plan.md M15 step 7). jsdom
 * is dramatically slower than a real browser at SVG DOM churn, so these budgets are generous
 * multiples (roughly 2-5x) of the baseline observed on this test environment — they exist to
 * catch an accidental O(n) sneaking into a hot path (e.g. pan/zoom starting to touch the full
 * scene), not to assert real-browser frame timing. See docs/10-canvas-parity-plan.md's C13 for
 * the actual documented numbers and the dispatch-cost finding this benchmark surfaced.
 */
interface Budget {
  loadMs: number;
  hitTestMs: number;
  lintMs: number;
  panZoomMs: number;
  /** Covers one nudge + undo + redo — three full scene render()+lint() passes (see C13). */
  dispatchMs: number;
}

const BUDGETS: Record<number, Budget> = {
  500: { loadMs: 400, hitTestMs: 60, lintMs: 50, panZoomMs: 20, dispatchMs: 1800 },
  1000: { loadMs: 700, hitTestMs: 100, lintMs: 80, panZoomMs: 20, dispatchMs: 4200 },
  2000: { loadMs: 1500, hitTestMs: 200, lintMs: 200, panZoomMs: 20, dispatchMs: 11500 }
};

describe("performance benchmark (docs/09-roadmap.md#m12--performance-at-scale)", () => {
  for (const size of [500, 1000, 2000] as const) {
    const budget = BUDGETS[size];

    it(
      `renders, hit-tests, lints, pans/zooms, and dispatches within budget at ${size} elements`,
      () => {
        const { doc, elementCount, sampleIconIds } = buildSyntheticDocument(size);
        const catalog = new Catalog(SYNTHETIC_CATALOG, SYNTHETIC_ASSETS);
        const editor = createEditor({ container: document.createElement("div"), catalog });

        const loadStart = performance.now();
        editor.loadIcad(doc);
        const loadMs = performance.now() - loadStart;
        expect(editor.scene.all()).toHaveLength(elementCount);
        expect(loadMs).toBeLessThan(budget.loadMs);

        const hitTestStart = performance.now();
        for (const id of sampleIconIds) {
          const el = editor.scene.get(id)!;
          hitTestAll(editor.scene, { x: el.x + el.w / 2, y: el.y + el.h / 2 });
        }
        expect(performance.now() - hitTestStart).toBeLessThan(budget.hitTestMs);

        const lintStart = performance.now();
        editor.lint();
        expect(performance.now() - lintStart).toBeLessThan(budget.lintMs);

        // The ephemeral preview path (D26) never reaches here — per-pointer-move updates are
        // plain SVG attribute writes with no render()/lint() at all. Pan/zoom similarly only
        // ever calls SvgRenderer.applyViewport(), not render() — confirmed cheap at every size
        // tested, exactly as D3's viewport-is-a-transform design intends.
        const panZoomStart = performance.now();
        editor.viewport.panBy(50, 50);
        editor.viewport.zoomBy(1.1);
        expect(performance.now() - panZoomStart).toBeLessThan(budget.panZoomMs);

        // A single *committed* move is the realistic unit to measure — dispatch, undo, and redo
        // each run the same full-scene render()+lint() pass loadIcad's initial paint did, so
        // moving even 10 of 2000 elements costs roughly what a full re-render costs (C13).
        const moveIds = sampleIconIds.slice(0, 10);
        const dispatchStart = performance.now();
        editor.nudgeElements(moveIds, 5, 5);
        editor.commands.undo();
        editor.commands.redo();
        expect(performance.now() - dispatchStart).toBeLessThan(budget.dispatchMs);
      },
      30000
    );
  }
});
