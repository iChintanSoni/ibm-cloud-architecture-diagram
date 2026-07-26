import type { Editor } from "../api/createEditor.js";
import { clientPointToCanvas } from "../render/dom.js";
import type { Point } from "../render/port.js";
import { portPoint } from "../render/port.js";
import type { ElementId, PortSide, SceneElement } from "../scene/types.js";
import { Emitter } from "../util/emitter.js";
import { hitTest } from "./hitTest.js";

export type CanvasMode = { kind: "idle" } | { kind: "connecting"; fromId: ElementId } | { kind: "placing" };

export interface CanvasControllerOptions {
  /** Fired after a connector is created by any input path (drag, click, keyboard connect-mode) —
   * core stays string/i18n-agnostic, so the shell formats its own announcement text from the ids. */
  onConnected?: (id: ElementId, fromId: ElementId, toId: ElementId) => void;
  /** Fired with the full deleted elements — captured *before* Delete/Backspace removes them, not
   * just their ids, since a shell formatting an announcement needs display names and
   * `scene.get(id)` would already return nothing by the time this fires otherwise. */
  onDeleted?: (elements: SceneElement[]) => void;
}

function parsePortAttr(value: string): { elementId: ElementId; side: PortSide } {
  const separator = value.lastIndexOf(":");
  return { elementId: value.slice(0, separator), side: value.slice(separator + 1) as PortSide };
}

/**
 * The canvas's own pointer + keyboard interaction, as one state machine (D27,
 * docs/00-decision-log.md) — previously ~250 lines duplicated near-identically between
 * `apps/web` and `apps/vscode`'s own `App.tsx` (docs/10-canvas-parity-plan.md's de-fork item).
 * Owns: wheel pan/zoom, click-to-select, drag-to-connect via ports, keyboard connect-mode ("c",
 * Tab, Enter, Escape), and the canvas's own keyboard operability (Tab/Shift+Tab focus,
 * Enter/Space select, arrow-key nudge, Delete/Backspace) — see
 * docs/07-accessibility.md#canvas-the-hard-20, a hard requirement this class must keep meeting,
 * not just replicate incidentally.
 *
 * Deliberately does NOT own: global app-chrome shortcuts (undo/redo/zoom/find/palette — these
 * aren't canvas-scoped, they work from anywhere), presentation-mode stepping, or *what* gets
 * placed during placement mode (`LibraryPlacement` is a `@icad/ui-web` concept; core cannot
 * depend on it, so `armPlacement` takes an opaque callback instead).
 */
export class CanvasController {
  private mode: CanvasMode = { kind: "idle" };
  private modeEmitter = new Emitter<{ change: CanvasMode }>();
  private draggingPort: { elementId: ElementId; side: PortSide } | undefined;
  private onPlace: ((point: Point) => void) | undefined;
  private suspended = false;

  constructor(
    private editor: Editor,
    private container: HTMLElement,
    private options: CanvasControllerOptions = {}
  ) {
    this.container.addEventListener("wheel", this.handleWheel, { passive: false });
    this.container.addEventListener("mousemove", this.handleMouseMove);
    this.container.addEventListener("mousedown", this.handleMouseDown);
    this.container.addEventListener("mouseup", this.handleMouseUp);
    this.container.addEventListener("click", this.handleClick);
    this.container.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keydown", this.handleGlobalKeyDown);
  }

  destroy(): void {
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("mousemove", this.handleMouseMove);
    this.container.removeEventListener("mousedown", this.handleMouseDown);
    this.container.removeEventListener("mouseup", this.handleMouseUp);
    this.container.removeEventListener("click", this.handleClick);
    this.container.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keydown", this.handleGlobalKeyDown);
  }

  getMode(): CanvasMode {
    return this.mode;
  }

  onModeChange(listener: (mode: CanvasMode) => void): () => void {
    return this.modeEmitter.on("change", listener);
  }

  /** Suppresses all canvas keyboard handling — used while presentation mode owns the keyboard
   * (an app-level concern this class doesn't otherwise know about). Mouse/wheel are unaffected. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  /** Arms placement mode: the next canvas click calls `onPlace` with the clicked scene point, then
   * returns to idle. Escape (from anywhere, not just canvas focus — matching the pre-M15 behavior
   * of the "armed" Library-panel affordance) cancels without calling it. */
  armPlacement(onPlace: (point: Point) => void): void {
    this.onPlace = onPlace;
    this.setMode({ kind: "placing" });
  }

  cancelPlacement(): void {
    if (this.mode.kind !== "placing") return;
    this.onPlace = undefined;
    this.setMode({ kind: "idle" });
  }

  /** Starts keyboard/click connect-mode from `fromId`: Tab to preview a target, Enter or a click
   * confirms, Escape cancels. Mirrors the mouse drag-a-port path onto discrete steps instead. */
  startConnecting(fromId: ElementId): void {
    this.editor.setHoveredElement(fromId);
    this.setMode({ kind: "connecting", fromId });
  }

  cancelConnecting(): void {
    if (this.mode.kind !== "connecting") return;
    this.editor.clearConnectorDraft();
    this.editor.setHoveredElement(undefined);
    this.setMode({ kind: "idle" });
  }

  private setMode(mode: CanvasMode): void {
    this.mode = mode;
    this.modeEmitter.emit("change", mode);
  }

  private svg(): SVGSVGElement | null {
    return this.container.querySelector("svg");
  }

  private toScenePoint(clientX: number, clientY: number): Point | undefined {
    const svg = this.svg();
    return svg ? clientPointToCanvas(svg, clientX, clientY) : undefined;
  }

  private connectAndNotify(
    fromId: ElementId,
    toId: ElementId,
    exact?: { fromPort: PortSide; toPort: PortSide }
  ): void {
    const from = this.editor.scene.get(fromId);
    const to = this.editor.scene.get(toId);
    if (!from || !to) return;
    const id = exact
      ? this.editor.connect({ elementId: fromId, port: exact.fromPort }, { elementId: toId, port: exact.toPort })
      : this.editor.connectNearest(fromId, toId);
    if (!id) return;
    this.editor.selection.set([id]);
    this.options.onConnected?.(id, fromId, toId);
  }

  // Scroll pans, Ctrl/Cmd+scroll zooms toward the cursor (docs/06-editor-ux.md#core-interactions).
  // Non-passive so preventDefault actually stops page scroll.
  private handleWheel = (event: WheelEvent): void => {
    const svg = this.svg();
    if (!svg) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const focal = clientPointToCanvas(svg, event.clientX, event.clientY);
      this.editor.viewport.zoomBy(Math.exp(-event.deltaY * 0.01), focal);
    } else {
      const { scale } = this.editor.viewport.get();
      this.editor.viewport.panBy(event.deltaX / scale, event.deltaY / scale);
    }
  };

  // Mouse drag-to-connect (docs/06-editor-ux.md#core-interactions): hover a shape to reveal its
  // ports (SvgRenderer draws them), mousedown on one starts a rubber-band drag; dropping on
  // another element's port uses that exact port, dropping anywhere else on it auto-picks a
  // reasonable pair (connectNearest); dropping on empty canvas cancels.
  private handleMouseMove = (event: MouseEvent): void => {
    if (this.mode.kind === "placing") return;
    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;

    if (this.draggingPort) {
      const source = this.editor.scene.get(this.draggingPort.elementId);
      if (source) this.editor.setConnectorDraftPoints(portPoint(source, this.draggingPort.side), point);
    }

    const hit = hitTest(this.editor.scene, point);
    this.editor.setHoveredElement(hit && hit.type !== "connector" && hit.type !== "frame" ? hit.id : undefined);
  };

  private handleMouseDown = (event: MouseEvent): void => {
    const portAttr =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-icad-port]")?.getAttribute("data-icad-port")
        : null;
    if (!portAttr) return;
    const { elementId, side } = parsePortAttr(portAttr);
    this.draggingPort = { elementId, side };
    const source = this.editor.scene.get(elementId);
    if (source) this.editor.setConnectorDraftPoints(portPoint(source, side), portPoint(source, side));
  };

  private handleMouseUp = (event: MouseEvent): void => {
    const dragging = this.draggingPort;
    this.draggingPort = undefined;
    this.editor.clearConnectorDraft();
    this.editor.setHoveredElement(undefined);
    if (!dragging) return;

    const targetPortAttr =
      event.target instanceof Element
        ? event.target.closest<SVGElement>("[data-icad-port]")?.getAttribute("data-icad-port")
        : null;
    if (targetPortAttr) {
      const target = parsePortAttr(targetPortAttr);
      if (target.elementId !== dragging.elementId) {
        this.connectAndNotify(dragging.elementId, target.elementId, { fromPort: dragging.side, toPort: target.side });
      }
      return;
    }

    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;
    const target = hitTest(this.editor.scene, point);
    if (target && target.id !== dragging.elementId && target.type !== "connector") {
      this.connectAndNotify(dragging.elementId, target.id);
    }
  };

  private handleClick = (event: MouseEvent): void => {
    // A drag-to-connect gesture already handled this interaction on mouseup. Ports are hover-only
    // DOM decorations, not scene elements — this stays DOM-based deliberately (C9,
    // docs/10-canvas-parity-plan.md): it isn't the divergent hit-test path that item closes.
    if (event.target instanceof Element && event.target.closest("[data-icad-port]")) return;

    const point = this.toScenePoint(event.clientX, event.clientY);
    const hit = point ? hitTest(this.editor.scene, point) : undefined;

    if (this.mode.kind === "connecting") {
      const fromId = this.mode.fromId;
      if (hit && hit.id !== fromId) this.connectAndNotify(fromId, hit.id);
      this.cancelConnecting();
      return;
    }

    if (this.mode.kind === "placing") {
      if (point) this.onPlace?.(point);
      this.cancelPlacement();
      return;
    }

    if (!hit) {
      this.editor.selection.clear();
    } else if (event.shiftKey) {
      this.editor.selection.toggle(hit.id);
      this.editor.focusElement(hit.id);
    } else {
      this.editor.selection.set([hit.id]);
      this.editor.focusElement(hit.id);
    }
  };

  // Escape cancels an armed placement from anywhere, not just canvas focus — the Library panel's
  // "armed" affordance is an app-wide modal state, matching the pre-M15 behavior of a window-level
  // listener rather than this class's own (canvas-focus-scoped) keydown handler below.
  private handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.mode.kind === "placing") this.cancelPlacement();
  };

  // Keyboard-operable canvas (docs/07-accessibility.md#canvas-the-hard-20). Tab/Shift+Tab move
  // keyboard focus only — wrapping is disabled at the boundary so Tab can still exit to
  // surrounding chrome (no keyboard trap) — Enter/Space select the focused element (Shift+
  // toggles it into/out of a multi-selection), arrow keys nudge the current selection,
  // Delete/Backspace removes it, and "c" starts keyboard connect mode (Tab to a target, Enter to
  // confirm, Escape to cancel).
  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.suspended) return;

    // Sync from wherever real DOM focus actually is: handles the bootstrap case where the very
    // first Tab into the canvas lands natively on the roving tabindex="0" element, before any
    // editor.focusElement() call has run.
    const targetId = event.target instanceof Element ? event.target.getAttribute("data-icad-id") : null;
    if (targetId && this.editor.focusedElement() !== targetId) this.editor.focusElement(targetId);
    const focusedId = this.editor.focusedElement();

    if (this.mode.kind === "connecting") {
      const fromId = this.mode.fromId;
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelConnecting();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (focusedId && focusedId !== fromId) this.connectAndNotify(fromId, focusedId);
        this.cancelConnecting();
      } else if (event.key === "Tab") {
        const order = this.editor.tabOrder();
        const currentIndex = focusedId ? order.indexOf(focusedId) : -1;
        if (currentIndex === -1) return;
        const atBoundary = event.shiftKey ? currentIndex === 0 : currentIndex === order.length - 1;
        if (atBoundary) return;
        event.preventDefault();
        if (event.shiftKey) this.editor.focusPrevious();
        else this.editor.focusNext();
        const nextId = this.editor.focusedElement();
        if (nextId && nextId !== fromId) this.editor.previewConnectorBetween(fromId, nextId);
      }
      return; // swallow every other key (e.g. arrows) while connecting
    }

    if (event.key === "Tab") {
      const order = this.editor.tabOrder();
      const currentIndex = focusedId ? order.indexOf(focusedId) : -1;
      if (currentIndex === -1) return; // nothing focused yet: let Tab enter natively
      const atBoundary = event.shiftKey ? currentIndex === 0 : currentIndex === order.length - 1;
      if (atBoundary) return; // let Tab exit to surrounding chrome instead of wrapping
      event.preventDefault();
      if (event.shiftKey) this.editor.focusPrevious();
      else this.editor.focusNext();
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      if (!focusedId) return;
      event.preventDefault();
      if (event.shiftKey) this.editor.selection.toggle(focusedId);
      else this.editor.selection.set([focusedId]);
      return;
    }

    if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const source = focusedId ?? this.editor.selection.get()[0];
      const el = source ? this.editor.scene.get(source) : undefined;
      if (!el || el.type === "connector" || el.type === "frame") return;
      event.preventDefault();
      this.startConnecting(el.id);
      return;
    }

    let selected = this.editor.selection.get();
    if (selected.length === 0 && focusedId) {
      this.editor.selection.set([focusedId]);
      selected = [focusedId];
    }
    if (selected.length === 0) return;

    const nudge = event.shiftKey ? 8 : 1;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.editor.nudgeElements(selected, 0, -nudge);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.editor.nudgeElements(selected, 0, nudge);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.editor.nudgeElements(selected, -nudge, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.editor.nudgeElements(selected, nudge, 0);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const deleted = selected
        .map((id) => this.editor.scene.get(id))
        .filter((el): el is SceneElement => el !== undefined);
      this.editor.deleteElements(selected);
      this.options.onDeleted?.(deleted);
    }
  };
}
