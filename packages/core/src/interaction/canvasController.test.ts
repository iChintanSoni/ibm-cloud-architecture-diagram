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
