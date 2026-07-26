import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "../api/createEditor.js";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { CanvasController, type CanvasControllerOptions } from "./canvasController.js";

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
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) };
      return point;
    }
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
        tier: "ibm-cloud"
      }
    ]
  };
  return new Catalog(manifest, new Map([["vpc", '<rect width="20" height="20" fill="#0f62fe" />']]));
}

function click(target: EventTarget, x: number, y: number, opts: Partial<MouseEventInit> = {}): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y, ...opts }));
}

function keydown(target: EventTarget, key: string, opts: Partial<KeyboardEventInit> = {}): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...opts }));
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
    const id = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 100, label: "box" });
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
    const unsubscribe = controller.onModeChange((mode) => modes.push(mode.kind));

    controller.armPlacement(() => {});
    controller.cancelPlacement();

    expect(modes).toEqual(["placing", "idle"]);
    unsubscribe();
  });

  describe("keyboard operability (docs/07-accessibility.md#canvas-the-hard-20)", () => {
    it("Enter selects the currently focused element", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "box" });
      editor.focusElement(id);
      keydown(container, "Enter");
      expect(editor.selection.get()).toEqual([id]);
    });

    it("Shift+Enter toggles the focused element into the selection", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "box" });
      editor.focusElement(id);
      keydown(container, "Enter", { shiftKey: true });
      expect(editor.selection.get()).toEqual([id]);
      keydown(container, "Enter", { shiftKey: true });
      expect(editor.selection.get()).toEqual([]);
    });

    it("arrow keys nudge the current selection", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, w: 50, h: 50, label: "box" });
      editor.selection.set([id]);
      keydown(container, "ArrowRight");
      expect(editor.scene.get(id)).toMatchObject({ x: 11, y: 10 });
      keydown(container, "ArrowDown", { shiftKey: true });
      expect(editor.scene.get(id)).toMatchObject({ x: 11, y: 18 });
    });

    it("Delete removes the selection and calls onDeleted with the full elements, captured before removal", () => {
      const onDeleted = vi.fn();
      withOptions({ onDeleted });
      const id = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "box" });
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
      const b = editor.addBox({ at: { x: 200, y: 0 }, w: 50, h: 50, label: "b" });
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
      const id = editor.addBox({ at: { x: 10, y: 10 }, w: 50, h: 50, label: "box" });
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
