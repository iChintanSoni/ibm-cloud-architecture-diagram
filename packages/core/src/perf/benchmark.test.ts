import { describe, expect, it } from "vitest";
import { createEditor } from "../api/createEditor.js";
import { Catalog } from "../catalog/catalog.js";
import { hitTestAll } from "../interaction/hitTest.js";
import {
  buildSyntheticDocument,
  SYNTHETIC_ASSETS,
  SYNTHETIC_CATALOG,
} from "./syntheticDiagram.js";

/**
 * Regression guard, not a real-browser performance target
 * (docs/09-roadmap.md#m12--performance-at-scale, docs/10-canvas-parity-plan.md M15 step 7). jsdom
 * is dramatically slower than a real browser at SVG DOM churn, so these budgets are generous
 * multiples (roughly 2-5x) of the baseline observed on this test environment — they exist to
 * catch an accidental O(n) sneaking into a hot path (e.g. pan/zoom starting to touch the full
 * scene), not to assert real-browser frame timing. See docs/10-canvas-parity-plan.md's C13 for
 * the actual documented numbers and the dispatch-cost finding this benchmark surfaced.
 *
 * GitHub Actions' shared runners are both slower and noisier than a dedicated dev machine — the
 * budgets below already caught this once (500-element loadMs failed in CI at 476ms against a
 * 400ms budget that's never once been close locally) — so CI gets an extra multiplier on top of
 * the "generous" local one rather than permanently loosening the numbers that actually catch a
 * regression during local dev.
 */
const CI_MULTIPLIER = process.env.CI ? 2 : 1;
interface Budget {
  loadMs: number;
  hitTestMs: number;
  lintMs: number;
  panZoomMs: number;
  /** Covers one nudge + undo + redo — three full scene render()+lint() passes (see C13). */
  dispatchMs: number;
}

const BUDGETS: Record<number, Budget> = {
  // dispatchMs dropped by roughly 20-40x once Scene._transaction (M16.1) coalesced each command's
  // `_put` calls into one change event instead of one per element — dispatch/undo/redo now cost
  // one scoped repaint of the moved ids, not three full-scene render()+lint() passes (C13).
  500: {
    loadMs: 400,
    hitTestMs: 60,
    lintMs: 50,
    panZoomMs: 20,
    dispatchMs: 150,
  },
  1000: {
    loadMs: 700,
    hitTestMs: 100,
    lintMs: 80,
    panZoomMs: 20,
    dispatchMs: 350,
  },
  2000: {
    loadMs: 1500,
    hitTestMs: 200,
    lintMs: 200,
    panZoomMs: 20,
    dispatchMs: 800,
  },
};

describe("performance benchmark (docs/09-roadmap.md#m12--performance-at-scale)", () => {
  for (const size of [500, 1000, 2000] as const) {
    const budget = BUDGETS[size];

    it(`renders, hit-tests, lints, pans/zooms, and dispatches within budget at ${size} elements`, () => {
      const { doc, elementCount, sampleIconIds } = buildSyntheticDocument(size);
      const catalog = new Catalog(SYNTHETIC_CATALOG, SYNTHETIC_ASSETS);
      const editor = createEditor({
        container: document.createElement("div"),
        catalog,
      });

      const loadStart = performance.now();
      editor.loadIcad(doc);
      const loadMs = performance.now() - loadStart;
      expect(editor.scene.all()).toHaveLength(elementCount);
      expect(loadMs).toBeLessThan(budget.loadMs * CI_MULTIPLIER);

      const hitTestStart = performance.now();
      for (const id of sampleIconIds) {
        const el = editor.scene.get(id)!;
        hitTestAll(editor.scene, { x: el.x + el.w / 2, y: el.y + el.h / 2 });
      }
      expect(performance.now() - hitTestStart).toBeLessThan(
        budget.hitTestMs * CI_MULTIPLIER,
      );

      const lintStart = performance.now();
      editor.lint();
      expect(performance.now() - lintStart).toBeLessThan(
        budget.lintMs * CI_MULTIPLIER,
      );

      // The ephemeral preview path (D26) never reaches here — per-pointer-move updates are
      // plain SVG attribute writes with no render()/lint() at all. Pan/zoom similarly only
      // ever calls SvgRenderer.applyViewport(), not render() — confirmed cheap at every size
      // tested, exactly as D3's viewport-is-a-transform design intends.
      const panZoomStart = performance.now();
      editor.viewport.panBy(50, 50);
      editor.viewport.zoomBy(1.1);
      expect(performance.now() - panZoomStart).toBeLessThan(
        budget.panZoomMs * CI_MULTIPLIER,
      );

      // A single *committed* move is the realistic unit to measure. `Scene._transaction`
      // (M16.1, docs/10-canvas-parity-plan.md's C13) coalesces every `_put` a command makes
      // into one change event, and `createEditor.ts`'s subscription repaints just the affected
      // ids for an "update"-reason event instead of the whole scene — so dispatch/undo/redo
      // each cost roughly the size of the *moved* set, not the whole diagram, unlike before this
      // fix (previously each was a full-scene render()+lint() pass, once per moved element).
      const moveIds = sampleIconIds.slice(0, 10);
      const dispatchStart = performance.now();
      editor.nudgeElements(moveIds, 5, 5);
      editor.commands.undo();
      editor.commands.redo();
      expect(performance.now() - dispatchStart).toBeLessThan(
        budget.dispatchMs * CI_MULTIPLIER,
      );
    }, 30000);
  }

  it(
    "a scripted 200-update drag of a ~40-element subtree holds frame budget, produces exactly " +
      "one undo entry, and runs the linter exactly once (docs/09-roadmap.md M15 'Done when')",
    () => {
      const { doc } = buildSyntheticDocument(2000);
      const catalog = new Catalog(SYNTHETIC_CATALOG, SYNTHETIC_ASSETS);
      const editor = createEditor({
        container: document.createElement("div"),
        catalog,
      });
      editor.loadIcad(doc);

      // 5 top-level containers, each with 8 icon children (buildSyntheticDocument) — beginInteraction
      // expands to descendants, so this is ~45 elements moving as one gesture, matching the "40
      // element subtree" scenario the roadmap describes.
      const containerIds = ["box-0", "box-1", "box-2", "box-3", "box-4"];
      const originalPosition = { ...editor.scene.get("box-0")! };

      let changeEvents = 0;
      editor.on(() => {
        changeEvents += 1;
      });

      const interaction = editor.beginInteraction(containerIds);
      for (let frame = 0; frame < 200; frame++) {
        interaction.update(frame * 0.5, frame * 0.3);
      }
      // Every one of the 200 per-frame updates is a plain SvgRenderer.previewTransform() attribute
      // write (D26) — zero scene mutation, so zero render()/lint() passes and zero scene change
      // events. This is the actual "holds frame budget" guarantee: cost per frame doesn't scale
      // with the 200 updates or the diagram's 2000-element size.
      expect(changeEvents).toBe(0);

      interaction.commit();
      // One dispatch, therefore exactly one coalesced scene change event → exactly one renderer
      // repaint pass and one Linter.run() for the entire 200-frame gesture, not once per frame and
      // not once per moved element (C13's original finding).
      expect(changeEvents).toBe(1);
      expect(editor.scene.get("box-0")!.x).not.toBe(originalPosition.x);

      // One undo() call fully reverts the whole gesture — proof it landed as a single command.
      expect(editor.commands.undo()).toBe(true);
      expect(changeEvents).toBe(2);
      expect(editor.scene.get("box-0")).toEqual(originalPosition);
    },
    30000,
  );
});
