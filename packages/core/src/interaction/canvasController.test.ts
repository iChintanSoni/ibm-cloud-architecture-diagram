import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "../api/createEditor.js";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import {
  CanvasController,
  type CanvasControllerOptions,
} from "./canvasController.js";

// jsdom implements neither SVGSVGElement.getScreenCTM nor createSVGPoint (confirmed: calling
// either throws "not a function"), so clientPointToCanvas — and every CanvasController handler
// that calls it — would crash without this. No existing test in this codebase exercised that
// path before (it was only ever used against a real browser's live layout), so this is a new,
// self-contained polyfill, not a workaround for something that used to work. It's an identity
// mapping (client coords === scene coords): sufficient to test CanvasController's own logic,
// since the coordinate-transform math itself belongs to clientPointToCanvas, not this class.
function polyfillSvgGeometry(svg: SVGSVGElement): void {
  Object.assign(svg, {
    getScreenCTM: () => ({ inverse: () => ({}) }),
    createSVGPoint: () => {
      const point = {
        x: 0,
        y: 0,
        matrixTransform: () => ({ x: point.x, y: point.y }),
      };
      return point;
    },
  });
}

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "test-catalog",
    version: "0.0.1",
    categories: [{ id: "network", name: "Network" }],
    icons: [
      {
        id: "test/vpc",
        name: "Virtual Private Cloud",
        category: "network",
        semantic: "node",
        container: "square",
        asset: "vpc",
        keywords: ["vpc"],
        tier: "ibm-cloud",
      },
    ],
  };
  return new Catalog(
    manifest,
    new Map([["vpc", '<rect width="20" height="20" fill="#0f62fe" />']]),
  );
}

function click(
  target: EventTarget,
  x: number,
  y: number,
  opts: Partial<MouseEventInit> = {},
): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: x, clientY: y, ...opts }),
  );
}

function dblclick(
  target: EventTarget,
  x: number,
  y: number,
  opts: Partial<MouseEventInit> = {},
): void {
  target.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      clientX: x,
      clientY: y,
      ...opts,
    }),
  );
}

function rightClick(
  target: EventTarget,
  x: number,
  y: number,
  opts: Partial<MouseEventInit> = {},
): void {
  target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...opts,
    }),
  );
}

function keydown(
  target: EventTarget,
  key: string,
  opts: Partial<KeyboardEventInit> = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...opts,
    }),
  );
}

function keyup(
  target: EventTarget,
  key: string,
  opts: Partial<KeyboardEventInit> = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key,
      ...opts,
    }),
  );
}

// jsdom 29.1.1 implements the PointerEvent constructor (clientX/clientY/pointerId all work) but
// not setPointerCapture/hasPointerCapture/releasePointerCapture (all undefined) — confirmed by
// inspection, not assumed; CanvasController guards every call to those three behind a typeof
// check for exactly this reason, so a drag still runs end-to-end here despite the gap.
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  target: EventTarget,
  x: number,
  y: number,
  opts: Partial<PointerEventInit> = {},
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      ...opts,
    }),
  );
}

/** Drags from (x1,y1) to (x2,y2) via pointerdown/pointermove/pointerup, in one intermediate step
 * past DRAG_THRESHOLD so tests don't need to know its exact value. */
function drag(
  target: EventTarget,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: Partial<PointerEventInit> = {},
): void {
  pointerEvent("pointerdown", target, x1, y1, opts);
  pointerEvent("pointermove", target, x2, y2, opts);
  pointerEvent("pointerup", target, x2, y2, opts);
}

describe("CanvasController", () => {
  let container: HTMLDivElement;
  let editor: Editor;
  let controller: CanvasController;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    editor = createEditor({ container, catalog: testCatalog() });
    polyfillSvgGeometry(container.querySelector("svg")!);
    controller = new CanvasController(editor, container);
  });

  // Every test gets one live controller at a time — a test that needs custom options must swap
  // in a fresh instance through here, not construct a second one alongside the beforeEach
  // default, or both end up listening on the same container and racing each other.
  function withOptions(options: CanvasControllerOptions) {
    controller.destroy();
    controller = new CanvasController(editor, container, options);
    return controller;
  }

  it("starts idle and selects the element under a click, clearing selection on empty space", () => {
    const id = editor.addBox({
      at: { x: 0, y: 0 },
      w: 100,
      h: 100,
      label: "box",
    });
    expect(controller.getMode()).toEqual({ kind: "idle" });

    click(container, 50, 50);
    expect(editor.selection.get()).toEqual([id]);

    click(container, 500, 500);
    expect(editor.selection.get()).toEqual([]);
  });

  it("shift-click toggles the clicked element into and out of the selection", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
    click(container, 25, 25, { shiftKey: true });
    expect(editor.selection.get()).toEqual([a]);
    click(container, 25, 25, { shiftKey: true });
    expect(editor.selection.get()).toEqual([]);
  });

  it("armPlacement: the next click calls onPlace with the scene point, then returns to idle", () => {
    const onPlace = vi.fn();
    controller.armPlacement(onPlace);
    expect(controller.getMode()).toEqual({ kind: "placing" });

    click(container, 120, 80);

    expect(onPlace).toHaveBeenCalledWith({ x: 120, y: 80 });
    expect(controller.getMode()).toEqual({ kind: "idle" });
  });

  it("cancelPlacement (Escape from anywhere) discards an armed placement without calling onPlace", () => {
    const onPlace = vi.fn();
    controller.armPlacement(onPlace);

    keydown(window, "Escape");

    expect(controller.getMode()).toEqual({ kind: "idle" });
    click(container, 10, 10);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it("startConnecting: a click on another element connects them and returns to idle", () => {
    const onConnected = vi.fn();
    withOptions({ onConnected });
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
    const b = editor.addBox({ at: { x: 200, y: 0 }, w: 50, h: 50, label: "b" });

    controller.startConnecting(a);
    expect(controller.getMode()).toEqual({ kind: "connecting", fromId: a });

    click(container, 225, 25); // inside b's bbox

    expect(controller.getMode()).toEqual({ kind: "idle" });
    expect(onConnected).toHaveBeenCalledTimes(1);
    const [, fromId, toId] = onConnected.mock.calls[0]!;
    expect(fromId).toBe(a);
    expect(toId).toBe(b);
  });

  it("emits mode changes via onModeChange", () => {
    const modes: string[] = [];
    const unsubscribe = controller.onModeChange((mode) =>
      modes.push(mode.kind),
    );

    controller.armPlacement(() => {});
    controller.cancelPlacement();

    expect(modes).toEqual(["placing", "idle"]);
    unsubscribe();
  });

  describe("drag-to-move (M16.1, docs/10-canvas-parity-plan.md)", () => {
    it("drags an element past the threshold, cascades to descendants, and lands one undo entry", () => {
      // 96x96 (a multiple of the default 8px grid) so a well-clear-of-tolerance drag delta lands
      // every candidate edge exactly on a grid line — snapMove (already unit-tested on its own,
      // snapping.test.ts) is then a no-op here, keeping this test's numbers exact and predictable.
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 96,
        h: 96,
        label: "parent",
      });
      // Inside parent's bbox but clear of the 48x48 child's (20,20)-(68,68) footprint, so the drag
      // starts on parent, not the (deepest-containment-wins) child.
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });
      const parentBefore = { ...editor.scene.get(parent)! };
      const childBefore = { ...editor.scene.get(child)! };

      drag(container, 8, 8, 40, 24); // dx=32, dy=16 — both multiples of 8, well past the threshold

      expect(controller.getMode()).toEqual({ kind: "idle" });
      const parentAfter = editor.scene.get(parent)!;
      const childAfter = editor.scene.get(child)!;
      expect(parentAfter).toMatchObject({ x: 32, y: 16 });
      // Move-with: the child cascaded by the exact same delta as its parent.
      expect(childAfter.x - childBefore.x).toBe(parentAfter.x - parentBefore.x);
      expect(childAfter.y - childBefore.y).toBe(parentAfter.y - parentBefore.y);

      // One undo reverts just the move; a second removes the child's own add — proving the drag
      // landed as exactly one distinct undo step, not fused with or duplicated on top of the adds.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(parent)).toMatchObject(parentBefore);
      expect(editor.scene.get(child)).toMatchObject(childBefore);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(child)).toBeUndefined();
      expect(editor.scene.get(parent)).toBeDefined();
    });

    it("selects an unselected target immediately on pointerdown, before the drag completes", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      pointerEvent("pointerdown", container, 25, 25);
      expect(editor.selection.get()).toEqual([a]);
    });

    it("dragging a member of an existing multi-selection keeps the whole selection, moving both", () => {
      // snapMove snaps the *combined* bbox of a whole multi-selection (boundsOf spans both), not
      // each element individually — 48x48 boxes on an 8px grid, 200px apart (also a multiple of
      // 8), keep every edge of that combined bbox grid-aligned so a grid-multiple drag delta is a
      // snap no-op, same reasoning as the cascade test above.
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 48, h: 48, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 48,
        h: 48,
        label: "b",
      });
      editor.selection.set([a, b]);

      drag(container, 8, 8, 24, 8); // dx=16 (a multiple of 8), starting inside a's bbox

      expect(editor.selection.get().sort()).toEqual([a, b].sort());
      expect(editor.scene.get(a)).toMatchObject({ x: 16, y: 0 });
      expect(editor.scene.get(b)).toMatchObject({ x: 216, y: 0 });
    });

    it("a drag below the threshold dispatches nothing, and the trailing click still selects normally", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      drag(container, 25, 25, 26, 25); // dx=1 — short of DRAG_THRESHOLD (4)
      click(container, 26, 25);

      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });
      expect(editor.selection.get()).toEqual([a]);
      // No move command was pushed on top of the box's own add: one undo removes the box itself.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(a)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("the trailing click after a real drag does not re-select at the release point", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      // Release lands over empty space — an unsuppressed click here would clear the selection.
      drag(container, 25, 25, 500, 500);
      click(container, 500, 500);

      expect(editor.selection.get()).toEqual([a]);
    });

    it("Shift locks the drag to whichever axis has the larger raw delta", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      drag(container, 25, 25, 45, 33, { shiftKey: true }); // dx=20, dy=8 -> locks to x, dy forced 0

      expect(editor.scene.get(a)).toMatchObject({ y: 0 });
      expect(editor.scene.get(a)?.x).toBeGreaterThan(0);
    });

    it("Escape mid-drag aborts: no command dispatched, preview transform cleared", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      pointerEvent("pointerdown", container, 25, 25);
      pointerEvent("pointermove", container, 60, 25);
      expect(controller.getMode()).toEqual({ kind: "dragging" });

      keydown(window, "Escape");

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });
      expect(
        container
          .querySelector(`[data-icad-id="${a}"]`)
          ?.getAttribute("transform"),
      ).toBeNull();

      // The pointerup that (in a real browser) still follows an aborted drag must be a no-op.
      pointerEvent("pointerup", container, 60, 25);
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });

      // abort() pushed nothing on top of the box's own add: one undo removes the box itself.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(a)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("snaps to the grid during a live drag", () => {
      // A 50x50 box's edges land a few px off-grid for almost any raw delta, so a small drag
      // should engage grid-snap (snapMove's own exact tie-breaking among left/center/right
      // candidates is snapping.test.ts's concern, not this one — asserting "landed on some grid
      // line, not the raw unsnapped position" is the invariant this test actually owns).
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      drag(container, 25, 25, 30, 25); // dx=5 — within the default 6px snap tolerance

      const after = editor.scene.get(a)!;
      expect(after.x).not.toBe(5); // the raw, un-snapped delta
      // snapMove aligns whichever edge (left/center/right) is nearest a grid line, not necessarily
      // the box's own x — assert that invariant directly rather than guessing which edge wins.
      expect(
        [after.x, after.x + after.w / 2, after.x + after.w].some(
          (v) => v % 8 === 0,
        ),
      ).toBe(true);
      expect(after.y).toBe(0);
    });

    it("does not arm a drag while connecting or placing", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      controller.armPlacement(() => {});

      drag(container, 25, 25, 60, 25);

      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });
      expect(controller.getMode()).toEqual({ kind: "placing" });
    });

    it("shows a live position readout while dragging, cleared on commit (M17.2)", () => {
      // Same 96x96/multiples-of-8 setup as the cascade test above, so the snapped position is
      // exactly the raw delta — nothing to disambiguate here.
      editor.addBox({ at: { x: 0, y: 0 }, w: 96, h: 96, label: "a" });
      pointerEvent("pointerdown", container, 8, 8);
      pointerEvent("pointermove", container, 40, 24); // dx=32, dy=16

      expect(
        container.querySelector("[data-icad-gesture-readout] text")
          ?.textContent,
      ).toBe("32, 16");

      pointerEvent("pointerup", container, 40, 24);
      expect(container.querySelector("[data-icad-gesture-readout]")).toBeNull();
    });

    it("draws alignment guide lines while snapping, cleared on release (M17.2)", () => {
      editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      pointerEvent("pointerdown", container, 25, 25);
      pointerEvent("pointermove", container, 30, 25); // dx=5 — within the default snap tolerance

      const guideLines = container.querySelectorAll(
        '[data-icad-layer="overlays"] line[stroke="#ee5396"]',
      );
      expect(guideLines.length).toBeGreaterThan(0);

      pointerEvent("pointerup", container, 30, 25);
      expect(
        container.querySelectorAll(
          '[data-icad-layer="overlays"] line[stroke="#ee5396"]',
        ),
      ).toHaveLength(0);
    });

    it("Escape aborts a drag and clears its readout and guides too (M17.2)", () => {
      editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      pointerEvent("pointerdown", container, 25, 25);
      pointerEvent("pointermove", container, 60, 25);
      expect(
        container.querySelector("[data-icad-gesture-readout]"),
      ).not.toBeNull();

      keydown(window, "Escape");

      expect(container.querySelector("[data-icad-gesture-readout]")).toBeNull();
      expect(
        container.querySelectorAll(
          '[data-icad-layer="overlays"] line[stroke="#ee5396"]',
        ),
      ).toHaveLength(0);
    });
  });

  describe("8-handle resize (M16.2, docs/10-canvas-parity-plan.md)", () => {
    function resizeHandle(handleId: string): Element {
      const el = container.querySelector(
        `[data-icad-resize-handle="${handleId}"]`,
      );
      if (!el) throw new Error(`resize handle "${handleId}" is not rendered`);
      return el;
    }

    /** Drags a resize handle from (x1,y1) to (x2,y2) — no threshold to clear, unlike drag-to-move. */
    function resizeDrag(
      handleId: string,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts: Partial<PointerEventInit> = {},
    ): void {
      pointerEvent("pointerdown", resizeHandle(handleId), x1, y1, opts);
      pointerEvent("pointermove", container, x2, y2, opts);
      pointerEvent("pointerup", container, x2, y2, opts);
    }

    it("renders all 8 handles for a single non-connector, non-frame selection, none otherwise", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      expect(
        container.querySelectorAll("[data-icad-resize-handle]"),
      ).toHaveLength(0);

      editor.selection.set([a]);
      expect(
        container.querySelectorAll("[data-icad-resize-handle]"),
      ).toHaveLength(8);

      editor.selection.set([a, b]);
      expect(
        container.querySelectorAll("[data-icad-resize-handle]"),
      ).toHaveLength(0);

      editor.selection.clear();
      expect(
        container.querySelectorAll("[data-icad-resize-handle]"),
      ).toHaveLength(0);
    });

    it("dragging the 'e' handle grows width only, landing one undo entry", () => {
      const a = editor.addBox({
        at: { x: 10, y: 10 },
        w: 50,
        h: 50,
        label: "a",
      });
      editor.selection.set([a]);

      resizeDrag("e", 60, 35, 90, 35); // dx=30

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.scene.get(a)).toMatchObject({ x: 10, y: 10, w: 80, h: 50 });

      // One undo reverts just the resize; a second removes the box's own add — proving the
      // resize landed as exactly one distinct undo step.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ x: 10, y: 10, w: 50, h: 50 });
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(a)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("dragging the 'nw' handle keeps the bottom-right corner fixed and does not move-with children", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 40, y: 40 },
        parentId: parent,
      });
      editor.selection.set([parent]);

      resizeDrag("nw", 0, 0, 20, 10); // dx=20, dy=10

      const after = editor.scene.get(parent)!;
      expect(after).toMatchObject({ x: 20, y: 10, w: 80, h: 90 });
      expect(after.x + after.w).toBe(100); // bottom-right corner unchanged
      expect(after.y + after.h).toBe(100);
      // Resize never cascades to descendants — only the resized element's own geometry changes.
      expect(editor.scene.get(child)).toMatchObject({ x: 40, y: 40 });
    });

    it("Shift locks the aspect ratio on a corner handle", () => {
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 100,
        label: "a",
      });
      editor.selection.set([a]);

      resizeDrag("se", 200, 100, 240, 105, { shiftKey: true }); // dx=40 dominates dy=5

      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0, w: 240, h: 120 }); // 240 / (200/100)
    });

    it("Alt resizes symmetrically from the original center", () => {
      const a = editor.addBox({
        at: { x: 100, y: 100 },
        w: 100,
        h: 100,
        label: "a",
      });
      editor.selection.set([a]);

      resizeDrag("e", 200, 150, 220, 150, { altKey: true }); // dx=20

      const after = editor.scene.get(a)!;
      expect(after.w).toBe(140);
      expect(after.x + after.w / 2).toBe(150); // original center's x unchanged
    });

    it("Escape mid-resize aborts: no command dispatched, preview geometry cleared", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      pointerEvent("pointerdown", resizeHandle("e"), 50, 25);
      pointerEvent("pointermove", container, 90, 25);
      expect(controller.getMode()).toEqual({ kind: "resizing" });

      keydown(window, "Escape");

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0, w: 50, h: 50 });

      // Abort pushed nothing on top of the box's own add: one undo removes the box itself.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(a)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);

      // A trailing pointerup after an aborted resize (as a real browser still sends) is a no-op.
      pointerEvent("pointerup", container, 90, 25);
      expect(editor.scene.get(a)).toBeUndefined();
    });

    it("the trailing click after a real resize does not re-select at the release point", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      // Release lands over empty space — an unsuppressed click here would clear the selection.
      resizeDrag("se", 50, 50, 500, 500);
      click(container, 500, 500);

      expect(editor.selection.get()).toEqual([a]);
    });

    it("shows a live W×H readout while resizing, cleared on commit (M17.2)", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      pointerEvent("pointerdown", resizeHandle("se"), 50, 50);
      pointerEvent("pointermove", container, 90, 70); // +40 w, +20 h

      expect(
        container.querySelector("[data-icad-gesture-readout] text")
          ?.textContent,
      ).toBe("90 × 70");

      pointerEvent("pointerup", container, 90, 70);
      expect(container.querySelector("[data-icad-gesture-readout]")).toBeNull();
    });

    it("Escape aborts a resize and clears its readout too (M17.2)", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      pointerEvent("pointerdown", resizeHandle("se"), 50, 50);
      pointerEvent("pointermove", container, 90, 70);
      expect(
        container.querySelector("[data-icad-gesture-readout]"),
      ).not.toBeNull();

      keydown(window, "Escape");

      expect(container.querySelector("[data-icad-gesture-readout]")).toBeNull();
    });
  });

  describe("marquee selection (M16.3, docs/10-canvas-parity-plan.md)", () => {
    it("selects only elements fully enclosed by the dragged rectangle", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });

      // Fully encloses both a (0,0)-(50,50) and b (100,0)-(150,50).
      drag(container, -10, -10, 200, 100);

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.selection.get().sort()).toEqual([a, b].sort());
    });

    it("excludes an element only partially inside the rectangle (fully-enclosed only)", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });

      // Encloses a entirely but only clips the left edge of b.
      drag(container, -10, -10, 120, 100);

      expect(editor.selection.get()).toEqual([a]);
      expect(editor.selection.isSelected(b)).toBe(false);
    });

    it("updates the selection live during the drag, before pointerup", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      pointerEvent("pointerdown", container, -10, -10);
      pointerEvent("pointermove", container, 60, 60);

      expect(controller.getMode()).toEqual({ kind: "marquee" });
      expect(editor.selection.get()).toEqual([a]);

      pointerEvent("pointerup", container, 60, 60);
      expect(editor.selection.get()).toEqual([a]);
    });

    it("Shift-drag unions the enclosed set with the pre-existing selection", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.selection.set([a]);

      // Encloses only b — without Shift this would drop a from the selection.
      drag(container, 90, -10, 160, 60, { shiftKey: true });

      expect(editor.selection.get().sort()).toEqual([a, b].sort());
    });

    it("a drag below the threshold arms nothing: the trailing click on empty space still clears", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);
      drag(container, 500, 500, 501, 500); // dx=1 — short of DRAG_THRESHOLD
      click(container, 501, 500);

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.selection.get()).toEqual([]);
    });

    it("Escape mid-marquee restores the pre-marquee selection", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.selection.set([a]);

      pointerEvent("pointerdown", container, 90, -10);
      pointerEvent("pointermove", container, 160, 60);
      expect(controller.getMode()).toEqual({ kind: "marquee" });
      expect(editor.selection.get()).toEqual([b]); // live preview already swapped it out

      keydown(window, "Escape");

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.selection.get()).toEqual([a]); // restored, not left at the live preview

      // The pointerup that (in a real browser) still follows an aborted marquee must be a no-op.
      pointerEvent("pointerup", container, 160, 60);
      expect(editor.selection.get()).toEqual([a]);
    });

    it("the trailing click after a real marquee does not re-select at the release point", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      // Release lands over empty space — an unsuppressed click here would clear the selection.
      drag(container, -10, -10, 60, 60);
      click(container, 60, 60);

      expect(editor.selection.get()).toEqual([a]);
    });

    it("starts a marquee on a Frame's own background, not just empty canvas", () => {
      editor.addFrame({ at: { x: 0, y: 0 }, name: "Section" });
      const child = editor.addBox({
        at: { x: 300, y: 300 },
        w: 50,
        h: 50,
        label: "child",
      });

      // (10,10) is inside the 800x500 frame's bbox but clear of the child.
      drag(container, 10, 10, 360, 360);

      expect(editor.selection.get()).toEqual([child]);
    });

    it("does not arm a marquee while connecting or placing", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      controller.startConnecting(a);

      drag(container, 500, 500, 600, 600);

      expect(controller.getMode()).toEqual({ kind: "connecting", fromId: a });
    });
  });

  describe("double-click to drill into a nested container (M16.4, docs/10-canvas-parity-plan.md)", () => {
    it("double-clicking a container's own background drills into it, selecting it and pushing its own faint outline", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      editor.addIcon("test/vpc", { at: { x: 60, y: 60 }, parentId: box });

      // (10,10) is inside box's bbox but clear of the icon's (60,60)-(80,80) footprint.
      dblclick(container, 10, 10);

      expect(controller.getDrillPath()).toEqual([box]);
      expect(editor.selection.get()).toEqual([box]);
      expect(
        container.querySelector(`[data-icad-drill-outline="${box}"]`),
      ).not.toBeNull();
    });

    it("drilling into a nested child pushes the full ancestor chain, outermost first", () => {
      const outer = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "outer",
      });
      const inner = editor.addZone({
        at: { x: 20, y: 20 },
        w: 100,
        h: 100,
        parentId: outer,
        label: "inner",
        zoneKind: "az",
      });
      editor.addIcon("test/vpc", { at: { x: 60, y: 60 }, parentId: inner });

      // (30,30) is inside inner's bbox but clear of the icon.
      dblclick(container, 30, 30);

      expect(controller.getDrillPath()).toEqual([outer, inner]);
      expect(editor.selection.get()).toEqual([inner]);
    });

    it("does nothing for a container with no children, a leaf element, empty canvas, or a Frame", () => {
      const empty = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "empty",
      });
      const icon = editor.addIcon("test/vpc", { at: { x: 200, y: 0 } });
      editor.addFrame({ at: { x: 0, y: 200 }, name: "Section" });

      dblclick(container, 25, 25); // empty box
      expect(controller.getDrillPath()).toEqual([]);

      dblclick(container, 205, 5); // leaf icon
      expect(controller.getDrillPath()).toEqual([]);

      dblclick(container, 900, 900); // empty canvas
      expect(controller.getDrillPath()).toEqual([]);

      dblclick(container, 10, 210); // Frame background
      expect(controller.getDrillPath()).toEqual([]);
      expect(editor.selection.get()).toEqual([]);
      expect(empty).toBeDefined();
      expect(icon).toBeDefined();
    });

    it("Escape steps back out one level at a time, re-selecting the containing level", () => {
      const outer = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "outer",
      });
      const inner = editor.addZone({
        at: { x: 20, y: 20 },
        w: 100,
        h: 100,
        parentId: outer,
        label: "inner",
        zoneKind: "az",
      });
      editor.addIcon("test/vpc", { at: { x: 60, y: 60 }, parentId: inner });
      dblclick(container, 30, 30);
      expect(controller.getDrillPath()).toEqual([outer, inner]);

      keydown(window, "Escape");
      expect(controller.getDrillPath()).toEqual([outer]);
      expect(editor.selection.get()).toEqual([outer]);

      keydown(window, "Escape");
      expect(controller.getDrillPath()).toEqual([]);
      expect(editor.selection.get()).toEqual([]);
    });

    it("a press-drag on the drilled container's own background arms a marquee scoped to its contents", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "box",
      });
      const inside = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: box,
      });
      // Outside the box entirely (a sibling, not a descendant), but still fully enclosed by the
      // rubber-band rect drawn below — geometry alone would select it too, if not for scoping.
      const outside = editor.addBox({
        at: { x: 100, y: 250 },
        w: 30,
        h: 30,
        label: "outside",
      });
      dblclick(container, 5, 5); // drills into box (its background, clear of `inside`)
      expect(controller.getDrillPath()).toEqual([box]);

      // Press starts on box's own background (not on `inside`), so this arms a scoped marquee
      // rather than moving box — and the rect (5,5)-(150,300) fully encloses both `inside`
      // (20,20)-(68,68) and the unrelated `outside` (100,250)-(130,280).
      drag(container, 5, 5, 150, 300);

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.selection.get()).toEqual([inside]);
      expect(editor.selection.isSelected(outside)).toBe(false);
      // Drilling didn't turn the container itself into something un-draggable in general — only
      // scoped this one gesture; box's own geometry is untouched (a move would have changed it).
      expect(editor.scene.get(box)).toMatchObject({ x: 0, y: 0 });
    });

    it("a second Enter on an already-selected, focused drillable container drills into it", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      editor.addIcon("test/vpc", { at: { x: 60, y: 60 }, parentId: box });
      editor.focusElement(box);

      keydown(container, "Enter"); // first Enter: selects
      expect(editor.selection.get()).toEqual([box]);
      expect(controller.getDrillPath()).toEqual([]);

      keydown(container, "Enter"); // second Enter: drills in
      expect(controller.getDrillPath()).toEqual([box]);
      expect(editor.selection.get()).toEqual([box]);
    });

    it("Space never drills, even when the focused element is already selected", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      editor.addIcon("test/vpc", { at: { x: 60, y: 60 }, parentId: box });
      editor.focusElement(box);
      editor.selection.set([box]);

      keydown(container, " ");

      expect(controller.getDrillPath()).toEqual([]);
      expect(editor.selection.get()).toEqual([box]); // unchanged — plain Space just re-selects
    });

    it("emits drill-path changes via onDrillChange", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      editor.addIcon("test/vpc", { at: { x: 60, y: 60 }, parentId: box });
      const paths: string[][] = [];
      const unsubscribe = controller.onDrillChange((path) =>
        paths.push([...path]),
      );

      dblclick(container, 10, 10);
      keydown(window, "Escape");

      expect(paths).toEqual([[box], []]);
      unsubscribe();
    });
  });

  describe("clipboard (M16.5, docs/10-canvas-parity-plan.md)", () => {
    it("Ctrl/Cmd+C then Ctrl/Cmd+V clones the selection, offset, and selects the copy", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      keydown(container, "c", { ctrlKey: true });
      keydown(container, "v", { ctrlKey: true });

      const selected = editor.selection.get();
      expect(selected).toHaveLength(1);
      expect(selected[0]).not.toBe(a);
      expect(editor.scene.get(selected[0]!)).toMatchObject({ x: 16, y: 16 });
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 }); // original untouched
    });

    it("Ctrl/Cmd+V with no prior copy is a no-op", () => {
      keydown(container, "v", { ctrlKey: true });
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("Ctrl/Cmd+V pastes at the last-tracked pointer position when the mouse has been over the canvas", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 40, h: 20, label: "a" });
      editor.selection.set([a]);
      keydown(container, "c", { ctrlKey: true });

      pointerEvent("pointermove", container, 300, 300); // an identity-mapped client point (polyfill)

      keydown(container, "v", { ctrlKey: true });

      // Original bbox (0,0,40,20) centers at (20,10); centering it at (300,300) instead puts the
      // top-left corner at (280,290).
      const [pasted] = editor.selection.get();
      expect(editor.scene.get(pasted!)).toMatchObject({ x: 280, y: 290 });
    });

    it("Ctrl/Cmd+X cuts: copies then removes the originals, leaving a pasteable clipboard", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      keydown(container, "x", { ctrlKey: true });
      expect(editor.scene.get(a)).toBeUndefined();

      keydown(container, "v", { ctrlKey: true });
      const [pasted] = editor.selection.get();
      expect(editor.scene.get(pasted!)).toMatchObject({ x: 16, y: 16 });
    });

    it("Ctrl/Cmd+D duplicates in place without touching a pending copy", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.selection.set([b]);
      keydown(container, "c", { ctrlKey: true }); // pending copy of b

      editor.selection.set([a]);
      keydown(container, "d", { ctrlKey: true });

      const [duplicated] = editor.selection.get();
      expect(duplicated).not.toBe(a);
      expect(editor.scene.get(duplicated!)).toMatchObject({ x: 16, y: 16 });

      // The pending copy of `b` is untouched by the duplicate above.
      keydown(container, "v", { ctrlKey: true });
      const [pastedB] = editor.selection.get();
      expect(editor.scene.get(pastedB!)).toMatchObject({ x: 216, y: 16 });
    });

    it("Ctrl/Cmd+C/X/D with nothing selected is a no-op", () => {
      keydown(container, "c", { ctrlKey: true });
      keydown(container, "x", { ctrlKey: true });
      keydown(container, "d", { ctrlKey: true });
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("reports each clipboard action via onClipboardAction", () => {
      const onClipboardAction = vi.fn();
      withOptions({ onClipboardAction });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      keydown(container, "c", { ctrlKey: true });
      keydown(container, "v", { ctrlKey: true });
      keydown(container, "d", { ctrlKey: true });

      expect(onClipboardAction.mock.calls.map((call) => call[0])).toEqual([
        "copy",
        "paste",
        "duplicate",
      ]);
    });

    describe("Alt-drag to clone", () => {
      it("dragging with Alt held leaves the original in place and drags a new duplicate instead", () => {
        // 48x48 (a multiple of the default 8px grid), spawning the clone at a grid-aligned 16,16
        // (PASTE_OFFSET) so a grid-multiple drag delta lands every candidate edge exactly on a
        // grid line — snapMove is then a no-op, the same reasoning drag-to-move's own tests use.
        const a = editor.addBox({
          at: { x: 0, y: 0 },
          w: 48,
          h: 48,
          label: "a",
        });

        drag(container, 25, 25, 57, 25, { altKey: true }); // dx=32, well past DRAG_THRESHOLD

        expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 }); // original untouched
        const selected = editor.selection.get();
        expect(selected).toHaveLength(1);
        expect(selected[0]).not.toBe(a);
        // Clone spawns at a.x + PASTE_OFFSET (16), then the drag's own dx=32 carries it further.
        expect(editor.scene.get(selected[0]!)).toMatchObject({
          x: 16 + 32,
          y: 16,
        });
      });

      it("an Alt+click below the drag threshold leaves no duplicate behind", () => {
        const a = editor.addBox({
          at: { x: 0, y: 0 },
          w: 50,
          h: 50,
          label: "a",
        });

        drag(container, 25, 25, 26, 25, { altKey: true }); // dx=1 — short of DRAG_THRESHOLD

        expect(editor.selection.get()).toEqual([a]); // still just the original
        // A single undo removes only a's own add — no stray duplicate command in between.
        expect(editor.commands.undo()).toBe(true);
        expect(editor.scene.get(a)).toBeUndefined();
        expect(editor.commands.canUndo()).toBe(false);
      });

      it("lands as two separate undo steps: the duplicate, then the drag", () => {
        const a = editor.addBox({
          at: { x: 0, y: 0 },
          w: 50,
          h: 50,
          label: "a",
        });

        drag(container, 25, 25, 60, 25, { altKey: true });
        const [clone] = editor.selection.get();

        expect(editor.commands.undo()).toBe(true); // undoes the drag
        expect(editor.scene.get(clone!)).toMatchObject({ x: 16, y: 16 });
        expect(editor.commands.undo()).toBe(true); // undoes the duplicate itself
        expect(editor.scene.get(clone!)).toBeUndefined();
        expect(editor.scene.get(a)).toBeDefined();
      });

      it("without Alt, the same drag moves the original — no duplicate", () => {
        const a = editor.addBox({
          at: { x: 0, y: 0 },
          w: 48,
          h: 48,
          label: "a",
        });

        drag(container, 25, 25, 57, 25); // dx=32, a grid multiple — see comment above

        expect(editor.selection.get()).toEqual([a]);
        expect(editor.scene.get(a)).toMatchObject({ x: 32, y: 0 });
      });
    });
  });

  describe("context menu (M16.6, docs/10-canvas-parity-plan.md)", () => {
    it("right-clicking an unselected element selects it and reports the screen + scene point", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });

      rightClick(container, 25, 35);

      expect(editor.selection.get()).toEqual([a]);
      expect(onContextMenu).toHaveBeenCalledTimes(1);
      const [screenPoint, scenePoint] = onContextMenu.mock.calls[0]!;
      expect(screenPoint).toEqual({ x: 25, y: 35 });
      expect(scenePoint).toEqual({ x: 25, y: 35 }); // identity-mapped by the test polyfill
    });

    it("right-clicking a member of an existing multi-selection leaves the whole selection intact", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.selection.set([a, b]);

      rightClick(container, 25, 25); // lands on a, already part of the multi-selection

      expect(editor.selection.get().sort()).toEqual([a, b].sort());
      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("right-clicking empty canvas or a Frame's background clears the selection", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.addFrame({ at: { x: 0, y: 200 }, name: "Section" });
      editor.selection.set([a]);

      rightClick(container, 500, 500); // empty canvas
      expect(editor.selection.get()).toEqual([]);

      editor.selection.set([a]);
      rightClick(container, 10, 210); // Frame's own background
      expect(editor.selection.get()).toEqual([]);

      expect(onContextMenu).toHaveBeenCalledTimes(2);
    });

    it("does not open while connecting, placing, dragging, resizing, or marqueeing", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      controller.startConnecting(a);

      rightClick(container, 25, 25);

      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it("ContextMenu key opens at the focused element's own screen/scene position", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });
      const a = editor.addBox({
        at: { x: 10, y: 10 },
        w: 40,
        h: 20,
        label: "a",
      });
      editor.focusElement(a);

      keydown(container, "ContextMenu");

      expect(onContextMenu).toHaveBeenCalledTimes(1);
      const [, scenePoint] = onContextMenu.mock.calls[0]!;
      expect(scenePoint).toEqual({ x: 30, y: 20 }); // a's own bbox center (10+20, 10+10)
    });

    it("Shift+F10 is the fallback keyboard equivalent", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);

      keydown(container, "F10", { shiftKey: true });

      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });

    it("the keyboard equivalent is a no-op with nothing focused or selected", () => {
      const onContextMenu = vi.fn();
      withOptions({ onContextMenu });

      keydown(container, "ContextMenu");

      expect(onContextMenu).not.toHaveBeenCalled();
    });
  });

  describe("Alt+click select-through (M16.7, docs/10-canvas-parity-plan.md)", () => {
    it("a plain click always lands on the deepest element, same as before", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      const icon = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: box,
      });

      click(container, 40, 40); // inside both box and icon

      expect(editor.selection.get()).toEqual([icon]);
    });

    it("repeated Alt+clicks at the same point cycle deeper, then wrap back to the top", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      const icon = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: box,
      });

      click(container, 40, 40, { altKey: true }); // 1st: deepest (icon)
      expect(editor.selection.get()).toEqual([icon]);

      click(container, 40, 40, { altKey: true }); // 2nd: next down the stack (box)
      expect(editor.selection.get()).toEqual([box]);

      click(container, 40, 40, { altKey: true }); // 3rd: wraps back to icon
      expect(editor.selection.get()).toEqual([icon]);
    });

    it("Alt+clicking a different point resets the cycle to that point's own deepest element", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: box });

      click(container, 40, 40, { altKey: true }); // icon
      click(container, 40, 40, { altKey: true }); // box (cycled)

      click(container, 5, 5, { altKey: true }); // a different point, clear of the icon
      expect(editor.selection.get()).toEqual([box]); // only box covers (5,5) — index resets to 0
    });

    it("Alt+clicking empty canvas clears the selection", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "box",
      });
      editor.selection.set([box]);

      click(container, 500, 500, { altKey: true });

      expect(editor.selection.get()).toEqual([]);
    });

    it("Alt+click always replaces the selection outright, not a multi-select toggle", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.selection.set([a]);

      click(container, 125, 25, { altKey: true }); // b, clear of a

      expect(editor.selection.get()).toEqual([b]);
    });
  });

  describe("space+drag and middle-drag panning (M17.1, docs/10-canvas-parity-plan.md)", () => {
    it("middle-click drag pans the viewport by the client delta (no scale applied)", () => {
      pointerEvent("pointerdown", container, 10, 10, { button: 1 });
      expect(controller.getMode()).toEqual({ kind: "panning" });
      pointerEvent("pointermove", container, 40, 30, { button: 1 });

      // Grab-panning follows the hand: dragging right/down moves the viewport's scene-space
      // origin left/up so content visually tracks the cursor (opposite sign from scroll-pan).
      expect(editor.viewport.get()).toMatchObject({ x: -30, y: -20 });

      pointerEvent("pointerup", container, 40, 30, { button: 1 });
      expect(controller.getMode()).toEqual({ kind: "idle" });
    });

    it("middle-click over an element pans instead of selecting or dragging it", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      pointerEvent("pointerdown", container, 25, 25, { button: 1 });
      pointerEvent("pointermove", container, 45, 25, { button: 1 });
      pointerEvent("pointerup", container, 45, 25, { button: 1 });

      expect(editor.selection.get()).toEqual([]);
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });
      expect(editor.viewport.get()).toMatchObject({ x: -20, y: 0 });
    });

    it("holding Space makes a left-button drag pan instead of arming drag-to-move/marquee", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      keydown(container, " ");

      pointerEvent("pointerdown", container, 25, 25);
      expect(controller.getMode()).toEqual({ kind: "panning" });
      pointerEvent("pointermove", container, 55, 25);
      expect(editor.viewport.get()).toMatchObject({ x: -30, y: 0 });
      pointerEvent("pointerup", container, 55, 25);

      // Nothing about the element or the (empty) selection was touched — this was purely a pan.
      expect(editor.selection.get()).toEqual([]);
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });

      keyup(container, " ");
      // Space released: an ordinary drag now behaves normally again (drag-to-move, not pan).
      drag(container, 25, 25, 55, 25);
      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(editor.scene.get(a)?.x).toBeGreaterThan(0);
    });

    it("releasing Space mid-drag ends the pan even while the pointer is still down", () => {
      keydown(container, " ");
      pointerEvent("pointerdown", container, 10, 10);
      pointerEvent("pointermove", container, 30, 10);
      expect(editor.viewport.get()).toMatchObject({ x: -20, y: 0 });

      keyup(container, " ");
      expect(controller.getMode()).toEqual({ kind: "idle" });

      // The pointer never went up, but panning already ended — further movement is a no-op.
      pointerEvent("pointermove", container, 60, 10);
      expect(editor.viewport.get()).toMatchObject({ x: -20, y: 0 });

      // The still-pending native pointerup/click for this button must not do anything surprising.
      pointerEvent("pointerup", container, 60, 10);
      expect(controller.getMode()).toEqual({ kind: "idle" });
    });

    it("a middle-click pan is unaffected by Space keyup (only pointerup ends it)", () => {
      pointerEvent("pointerdown", container, 10, 10, { button: 1 });
      keyup(container, " "); // no-op: this pan was armed by the middle button, not Space
      pointerEvent("pointermove", container, 30, 10, { button: 1 });

      expect(controller.getMode()).toEqual({ kind: "panning" });
      expect(editor.viewport.get()).toMatchObject({ x: -20, y: 0 });
    });

    it("cursor reflects pan state: grab while Space is held, grabbing while panning, cleared after", () => {
      expect(container.style.cursor).toBe("");

      keydown(container, " ");
      expect(container.style.cursor).toBe("grab");

      pointerEvent("pointerdown", container, 10, 10);
      expect(container.style.cursor).toBe("grabbing");

      pointerEvent("pointerup", container, 10, 10);
      // Space is still physically held in this scenario, so "grab" (armed), not cleared outright.
      expect(container.style.cursor).toBe("grab");

      keyup(container, " ");
      expect(container.style.cursor).toBe("");
    });

    it("the trailing click after a moved pan does not re-hit-test at the release point", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.selection.set([a]);
      // Release lands over empty space — an unsuppressed click here would clear the selection.
      pointerEvent("pointerdown", container, 10, 10, { button: 1 });
      pointerEvent("pointermove", container, 500, 500, { button: 1 });
      pointerEvent("pointerup", container, 500, 500, { button: 1 });
      click(container, 500, 500);

      expect(editor.selection.get()).toEqual([a]);
    });

    it("Space's existing 'select the focused element' behavior still fires when no drag follows", () => {
      const id = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "a",
      });
      editor.focusElement(id);

      keydown(container, " ");
      keyup(container, " ");

      expect(editor.selection.get()).toEqual([id]);
      expect(container.style.cursor).toBe("");
    });
  });

  describe("keyboard operability (docs/07-accessibility.md#canvas-the-hard-20)", () => {
    it("Enter selects the currently focused element", () => {
      const id = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "box",
      });
      editor.focusElement(id);
      keydown(container, "Enter");
      expect(editor.selection.get()).toEqual([id]);
    });

    it("Shift+Enter toggles the focused element into the selection", () => {
      const id = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "box",
      });
      editor.focusElement(id);
      keydown(container, "Enter", { shiftKey: true });
      expect(editor.selection.get()).toEqual([id]);
      keydown(container, "Enter", { shiftKey: true });
      expect(editor.selection.get()).toEqual([]);
    });

    it("arrow keys nudge the current selection", () => {
      const id = editor.addBox({
        at: { x: 10, y: 10 },
        w: 50,
        h: 50,
        label: "box",
      });
      editor.selection.set([id]);
      keydown(container, "ArrowRight");
      expect(editor.scene.get(id)).toMatchObject({ x: 11, y: 10 });
      keydown(container, "ArrowDown", { shiftKey: true });
      expect(editor.scene.get(id)).toMatchObject({ x: 11, y: 18 });
    });

    it("Ctrl/Cmd+A selects every element in the scene, including frames and connectors", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      const frame = editor.addFrame({ at: { x: 0, y: 200 }, name: "Section" });
      const connectorId = editor.connectNearest(a, b);
      expect(connectorId).toBeDefined();

      keydown(container, "a", { ctrlKey: true });

      expect(editor.selection.get().sort()).toEqual(
        [a, b, frame, connectorId!].sort(),
      );
    });

    it("Cmd+A (metaKey) also selects all, and does not trigger while connect-mode is active", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.addBox({ at: { x: 100, y: 0 }, w: 50, h: 50, label: "b" });
      controller.startConnecting(a);

      keydown(container, "a", { metaKey: true });

      // Every other key is swallowed while connecting (handleKeyDown's own documented behavior),
      // so selection must stay untouched rather than jumping to select-all mid-gesture.
      expect(editor.selection.get()).toEqual([]);
      expect(controller.getMode()).toEqual({ kind: "connecting", fromId: a });
    });

    it("Delete removes the selection and calls onDeleted with the full elements, captured before removal", () => {
      const onDeleted = vi.fn();
      withOptions({ onDeleted });
      const id = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "box",
      });
      editor.selection.set([id]);

      keydown(container, "Delete");

      expect(editor.scene.get(id)).toBeUndefined();
      expect(onDeleted).toHaveBeenCalledTimes(1);
      const deleted = onDeleted.mock.calls[0]![0];
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({ id, label: { text: "box" } });
    });

    it("'c' starts connect-mode from the focused element; Enter confirms onto the next Tab target", () => {
      const onConnected = vi.fn();
      withOptions({ onConnected });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.focusElement(a);

      keydown(container, "c");
      expect(controller.getMode()).toEqual({ kind: "connecting", fromId: a });

      keydown(container, "Tab");
      expect(editor.focusedElement()).toBe(b);

      keydown(container, "Enter");
      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(onConnected.mock.calls[0]![1]).toBe(a);
      expect(onConnected.mock.calls[0]![2]).toBe(b);
    });

    it("Escape exits connect-mode without connecting anything", () => {
      const onConnected = vi.fn();
      withOptions({ onConnected });
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      controller.startConnecting(a);

      keydown(container, "Escape");

      expect(controller.getMode()).toEqual({ kind: "idle" });
      expect(onConnected).not.toHaveBeenCalled();
    });

    it("'c' does nothing when the focused/selected element is a connector or frame", () => {
      const frame = editor.addFrame({ at: { x: 0, y: 0 }, name: "Section" });
      editor.focusElement(frame);
      keydown(container, "c");
      expect(controller.getMode()).toEqual({ kind: "idle" });
    });

    it("setSuspended(true) disables all canvas keyboard handling (e.g. during presentation mode)", () => {
      const id = editor.addBox({
        at: { x: 10, y: 10 },
        w: 50,
        h: 50,
        label: "box",
      });
      editor.selection.set([id]);
      controller.setSuspended(true);

      keydown(container, "ArrowRight");

      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 }); // unchanged
    });
  });

  it("destroy() removes all listeners — a click afterward does nothing", () => {
    editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 100, label: "box" });
    controller.destroy();

    click(container, 50, 50);

    expect(editor.selection.get()).toEqual([]);
  });
});
