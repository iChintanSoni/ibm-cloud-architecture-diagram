import type {
  Editor,
  Interaction,
  ResizeInteraction,
} from "../api/createEditor.js";
import { clientPointToCanvas } from "../render/dom.js";
import type { Point } from "../render/port.js";
import { portPoint } from "../render/port.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import type { ElementId, PortSide, SceneElement } from "../scene/types.js";
import { Emitter } from "../util/emitter.js";
import { hitTest, hitTestRect } from "./hitTest.js";
import { resizeBounds, type ResizeHandle } from "./resize.js";
import { snapMove } from "./snapping.js";

export type CanvasMode =
  | { kind: "idle" }
  | { kind: "connecting"; fromId: ElementId }
  | { kind: "placing" }
  | { kind: "dragging" }
  | { kind: "resizing" }
  | { kind: "marquee" };

/** Client-space (zoom-independent) pixels the pointer must move before a mousedown-on-an-element
 * becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;

interface DragState {
  pointerId: number;
  ids: ElementId[];
  interaction: Interaction;
  startClient: Point;
  startScenePoint: Point;
  moved: boolean;
}

interface ResizeState {
  pointerId: number;
  id: ElementId;
  handle: ResizeHandle;
  interaction: ResizeInteraction;
  startBounds: Rect;
  startScenePoint: Point;
}

interface MarqueeState {
  pointerId: number;
  startClient: Point;
  startScenePoint: Point;
  /** Selection as it was before the marquee started — restored verbatim on Escape, and unioned
   * with the enclosed set on every move when the gesture started with Shift held. */
  preSelection: ElementId[];
  additive: boolean;
  moved: boolean;
}

/** Scene-space rect spanning two arbitrary points, normalized to a non-negative x/y/w/h regardless
 * of which corner the drag started from. */
function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export interface CanvasControllerOptions {
  /** Fired after a connector is created by any input path (drag, click, keyboard connect-mode) —
   * core stays string/i18n-agnostic, so the shell formats its own announcement text from the ids. */
  onConnected?: (id: ElementId, fromId: ElementId, toId: ElementId) => void;
  /** Fired with the full deleted elements — captured *before* Delete/Backspace removes them, not
   * just their ids, since a shell formatting an announcement needs display names and
   * `scene.get(id)` would already return nothing by the time this fires otherwise. */
  onDeleted?: (elements: SceneElement[]) => void;
}

function parsePortAttr(value: string): {
  elementId: ElementId;
  side: PortSide;
} {
  const separator = value.lastIndexOf(":");
  return {
    elementId: value.slice(0, separator),
    side: value.slice(separator + 1) as PortSide,
  };
}

/**
 * The canvas's own pointer + keyboard interaction, as one state machine (D27,
 * docs/00-decision-log.md) — previously ~250 lines duplicated near-identically between
 * `apps/web` and `apps/vscode`'s own `App.tsx` (docs/10-canvas-parity-plan.md's de-fork item).
 * Owns: wheel pan/zoom, click-to-select, drag-to-move (with a drag threshold, Shift axis-lock,
 * snapping, and Escape-to-abort), 8-handle resize (Shift aspect-lock, Alt resize-from-center,
 * Escape-to-abort — M16.2), drag-to-connect via ports, keyboard connect-mode ("c", Tab, Enter,
 * Escape), marquee selection (fully-enclosed only, Escape-to-abort — M16.3), and the canvas's own
 * keyboard operability (Tab/Shift+Tab focus, Enter/Space select, arrow-key nudge — drag-to-move's
 * own keyboard equivalent, Delete/Backspace, Ctrl/Cmd+A select-all — marquee's own keyboard
 * equivalent) — see docs/07-accessibility.md#canvas-the-hard-20, a hard requirement this class
 * must keep meeting, not just replicate incidentally. Resize's own keyboard equivalent is the
 * Properties panel's typed X/Y/W/H fields (`InspectorPanel.tsx`), which predate this gesture and
 * already cover it — mirroring how M16.1 found arrow-key nudge already covered drag-to-move; no
 * new keyboard code was needed for resize either.
 *
 * Built on Pointer Events with `setPointerCapture` (D27, docs/00-decision-log.md) so a drag
 * survives the cursor leaving the container.
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
  private dragState: DragState | undefined;
  private resizeState: ResizeState | undefined;
  private marqueeState: MarqueeState | undefined;
  /** A completed element drag or resize still fires a trailing native `click` on release — this
   * swallows exactly that one, so it doesn't re-hit-test at the (now-moved-to/resized-to) release
   * point and stomp the selection the gesture itself already settled. */
  private suppressNextClick = false;
  private onPlace: ((point: Point) => void) | undefined;
  private suspended = false;

  constructor(
    private editor: Editor,
    private container: HTMLElement,
    private options: CanvasControllerOptions = {},
  ) {
    this.container.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.container.addEventListener("pointerup", this.handlePointerUp);
    this.container.addEventListener("click", this.handleClick);
    this.container.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keydown", this.handleGlobalKeyDown);
  }

  destroy(): void {
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("pointerup", this.handlePointerUp);
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
    exact?: { fromPort: PortSide; toPort: PortSide },
  ): void {
    const from = this.editor.scene.get(fromId);
    const to = this.editor.scene.get(toId);
    if (!from || !to) return;
    const id = exact
      ? this.editor.connect(
          { elementId: fromId, port: exact.fromPort },
          { elementId: toId, port: exact.toPort },
        )
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

  private capturePointer(pointerId: number): void {
    if (typeof this.container.setPointerCapture === "function")
      this.container.setPointerCapture(pointerId);
  }

  private releasePointer(pointerId: number): void {
    if (
      typeof this.container.hasPointerCapture === "function" &&
      this.container.hasPointerCapture(pointerId) &&
      typeof this.container.releasePointerCapture === "function"
    ) {
      this.container.releasePointerCapture(pointerId);
    }
  }

  // Pointer drag-to-connect (docs/06-editor-ux.md#core-interactions): hover a shape to reveal its
  // ports (SvgRenderer draws them), pointerdown on one starts a rubber-band drag; dropping on
  // another element's port uses that exact port, dropping anywhere else on it auto-picks a
  // reasonable pair (connectNearest); dropping on empty canvas cancels.
  private handlePointerMove = (event: PointerEvent): void => {
    if (this.mode.kind === "placing") return;
    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;

    if (this.resizeState) {
      this.updateResize(event, point);
      return;
    }

    if (this.dragState) {
      this.updateDrag(event, point);
      return;
    }

    if (this.marqueeState) {
      this.updateMarquee(event, point);
      return;
    }

    if (this.draggingPort) {
      const source = this.editor.scene.get(this.draggingPort.elementId);
      if (source)
        this.editor.setConnectorDraftPoints(
          portPoint(source, this.draggingPort.side),
          point,
        );
    }

    const hit = hitTest(this.editor.scene, point);
    this.editor.setHoveredElement(
      hit && hit.type !== "connector" && hit.type !== "frame"
        ? hit.id
        : undefined,
    );
  };

  // Drag-to-move (M16, docs/10-canvas-parity-plan.md): armed on pointerdown over a selectable
  // element, but only becomes a real drag once the pointer has moved DRAG_THRESHOLD client px —
  // short of that, this stays a plain click (handleClick fires normally on release). Selection is
  // updated here rather than in handleClick so a drag can start immediately with the right
  // elements, matching standard direct-manipulation editors: an unselected target becomes the
  // (possibly Shift-extended) selection right away; an already-selected target's whole
  // multi-selection is preserved so the group drags together; Shift-clicking an already-selected
  // target is left for handleClick's own toggle-off, not armed as a drag at all.
  private handlePointerDown = (event: PointerEvent): void => {
    const resizeHandle =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-resize-handle]")
            ?.getAttribute("data-icad-resize-handle")
        : null;
    // A resize handle only ever renders for the single currently-selected element
    // (svgRenderer.ts's renderOverlays), so that's its unambiguous target — no need to hit-test.
    if (resizeHandle && this.mode.kind === "idle") {
      const id = this.editor.selection.get()[0];
      const el = id ? this.editor.scene.get(id) : undefined;
      const point = this.toScenePoint(event.clientX, event.clientY);
      if (!id || !el || !point) return;
      event.preventDefault();
      this.resizeState = {
        pointerId: event.pointerId,
        id,
        handle: resizeHandle as ResizeHandle,
        interaction: this.editor.beginResizeInteraction(id),
        startBounds: { x: el.x, y: el.y, w: el.w, h: el.h },
        startScenePoint: point,
      };
      this.capturePointer(event.pointerId);
      this.setMode({ kind: "resizing" });
      return;
    }

    const portAttr =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-port]")
            ?.getAttribute("data-icad-port")
        : null;
    if (portAttr) {
      const { elementId, side } = parsePortAttr(portAttr);
      this.draggingPort = { elementId, side };
      this.capturePointer(event.pointerId);
      const source = this.editor.scene.get(elementId);
      if (source)
        this.editor.setConnectorDraftPoints(
          portPoint(source, side),
          portPoint(source, side),
        );
      return;
    }

    if (this.mode.kind !== "idle") return;
    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;
    const hit = hitTest(this.editor.scene, point);
    // A connector has no drag semantics and no drag-arm-able background either — leave it to the
    // trailing click, same as before marquee existed.
    if (hit && hit.type === "connector") return;

    if (!hit || hit.type === "frame") {
      // Empty canvas, or a Frame's own background: Frame has no drag semantics (D25) so a
      // press-drag starting on one is unambiguously a marquee, not a move — otherwise a Frame
      // spanning most of the canvas (its usual presentation-sectioning role) would make it
      // impossible to rubber-band select anything inside it.
      this.marqueeState = {
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startScenePoint: point,
        preSelection: this.editor.selection.get(),
        additive: event.shiftKey,
        moved: false,
      };
      this.capturePointer(event.pointerId);
      return;
    }

    const alreadySelected = this.editor.selection.isSelected(hit.id);
    if (event.shiftKey) {
      if (alreadySelected) return; // defer to handleClick's toggle-off; don't arm a drag
      this.editor.selection.toggle(hit.id);
      this.editor.focusElement(hit.id);
    } else if (!alreadySelected) {
      this.editor.selection.set([hit.id]);
      this.editor.focusElement(hit.id);
    }

    // Belt-and-suspenders alongside the SVG root's `user-select: none` (svgRenderer.ts): stops a
    // real mouse drag from also kicking off the browser's own native text-selection/drag-image
    // behavior over a label.
    event.preventDefault();

    const ids = this.editor.selection.get();
    this.dragState = {
      pointerId: event.pointerId,
      ids,
      interaction: this.editor.beginInteraction(ids),
      startClient: { x: event.clientX, y: event.clientY },
      startScenePoint: point,
      moved: false,
    };
    this.capturePointer(event.pointerId);
  };

  // Marquee selection (M16.3, docs/10-canvas-parity-plan.md): armed by a pointerdown on empty
  // canvas or a Frame's background, becomes real once past the same DRAG_THRESHOLD drag-to-move
  // uses. Unlike drag/resize there's no separate commit step — `selection.set()` is applied live
  // on every move (cheap: it only repaints overlays, not the scene/linter), and Escape restores
  // the pre-marquee snapshot rather than undoing a command, since nothing was ever dispatched.
  private updateMarquee(event: PointerEvent, point: Point): void {
    const marquee = this.marqueeState;
    if (!marquee) return;

    if (!marquee.moved) {
      const clientDx = event.clientX - marquee.startClient.x;
      const clientDy = event.clientY - marquee.startClient.y;
      if (Math.hypot(clientDx, clientDy) < DRAG_THRESHOLD) return;
      marquee.moved = true;
      this.setMode({ kind: "marquee" });
    }

    const rect = rectFromPoints(marquee.startScenePoint, point);
    this.editor.setMarqueeRect(rect);
    // Fully-enclosed only (Decisions taken, docs/10-canvas-parity-plan.md), matching draw.io and
    // Excalidraw — safest in dense nested diagrams where intersect-mode would constantly grab the
    // enclosing Box/Zone instead of what's inside it.
    const enclosedIds = hitTestRect(this.editor.scene, rect).map((el) => el.id);
    this.editor.selection.set(
      marquee.additive
        ? [...new Set([...marquee.preSelection, ...enclosedIds])]
        : enclosedIds,
    );
  }

  private updateDrag(event: PointerEvent, point: Point): void {
    const drag = this.dragState;
    if (!drag) return;

    if (!drag.moved) {
      const clientDx = event.clientX - drag.startClient.x;
      const clientDy = event.clientY - drag.startClient.y;
      if (Math.hypot(clientDx, clientDy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.setMode({ kind: "dragging" });
    }

    let dx = point.x - drag.startScenePoint.x;
    let dy = point.y - drag.startScenePoint.y;
    let lockAxis: "x" | "y" | undefined;
    if (event.shiftKey) {
      // Lock to whichever axis currently has the larger raw delta; re-evaluated every move rather
      // than latched at drag-start, the simplest rule that still feels correct.
      lockAxis = Math.abs(dx) >= Math.abs(dy) ? "y" : "x";
      if (lockAxis === "y") dy = 0;
      else dx = 0;
    }

    const snapped = snapMove(this.editor.scene, drag.ids, dx, dy);
    // The lock always wins over a snap candidate on that axis — a grid/sibling candidate near 0
    // could otherwise reintroduce a tiny delta on the axis the user asked to freeze.
    const finalDx = lockAxis === "x" ? 0 : snapped.dx;
    const finalDy = lockAxis === "y" ? 0 : snapped.dy;
    // Guide-line rendering is M17's ("alignment guides ... drawn from M15's snapping engine",
    // docs/10-canvas-parity-plan.md) — snapping itself is fully applied here, just not drawn yet.
    drag.interaction.update(finalDx, finalDy);
  }

  // 8-handle resize (M16.2, docs/10-canvas-parity-plan.md): unlike drag-to-move there's no
  // threshold — grabbing a handle is unambiguous, so this is "resizing" from the first pointermove.
  // No grid/sibling/inset snapping (M17's own item, "live 16px buffer enforcement... rather than
  // the pad applying only at group creation") and no move-with — resizeBounds/beginResizeInteraction
  // only ever touch the one resized element, not its descendants.
  private updateResize(event: PointerEvent, point: Point): void {
    const resize = this.resizeState;
    if (!resize) return;
    const dx = point.x - resize.startScenePoint.x;
    const dy = point.y - resize.startScenePoint.y;
    const bounds = resizeBounds(resize.startBounds, resize.handle, dx, dy, {
      aspectLock: event.shiftKey,
      fromCenter: event.altKey,
    });
    resize.interaction.update(bounds);
  }

  private handlePointerUp = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);

    if (this.resizeState) {
      const { interaction } = this.resizeState;
      this.resizeState = undefined;
      interaction.commit();
      this.suppressNextClick = true;
      this.setMode({ kind: "idle" });
      return;
    }

    if (this.dragState) {
      const { interaction, moved } = this.dragState;
      this.dragState = undefined;
      if (moved) {
        interaction.commit();
        this.suppressNextClick = true;
      } else {
        interaction.abort();
      }
      this.setMode({ kind: "idle" });
      return;
    }

    if (this.marqueeState) {
      const { moved } = this.marqueeState;
      this.marqueeState = undefined;
      this.editor.setMarqueeRect(undefined);
      // The selection was already applied live on every move; a moved marquee just needs to keep
      // it and swallow the trailing click so it doesn't re-hit-test at the release point. An
      // unmoved one (a plain click on empty space or a Frame) never touched selection at all —
      // the trailing click still runs normally and clears/selects as it always did.
      if (moved) this.suppressNextClick = true;
      this.setMode({ kind: "idle" });
      return;
    }

    const dragging = this.draggingPort;
    this.draggingPort = undefined;
    this.editor.clearConnectorDraft();
    this.editor.setHoveredElement(undefined);
    if (!dragging) return;

    const targetPortAttr =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-port]")
            ?.getAttribute("data-icad-port")
        : null;
    if (targetPortAttr) {
      const target = parsePortAttr(targetPortAttr);
      if (target.elementId !== dragging.elementId) {
        this.connectAndNotify(dragging.elementId, target.elementId, {
          fromPort: dragging.side,
          toPort: target.side,
        });
      }
      return;
    }

    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;
    const target = hitTest(this.editor.scene, point);
    if (
      target &&
      target.id !== dragging.elementId &&
      target.type !== "connector"
    ) {
      this.connectAndNotify(dragging.elementId, target.id);
    }
  };

  private handleClick = (event: MouseEvent): void => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    // A drag-to-connect gesture already handled this interaction on pointerup. Ports are
    // hover-only DOM decorations, not scene elements — this stays DOM-based deliberately (C9,
    // docs/10-canvas-parity-plan.md): it isn't the divergent hit-test path that item closes.
    if (
      event.target instanceof Element &&
      event.target.closest("[data-icad-port]")
    )
      return;

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

  // Escape cancels an armed placement, or aborts an in-progress drag, from anywhere — not just
  // canvas focus. Placement's "armed" affordance is an app-wide modal state (pre-M15 behavior); a
  // mouse-driven drag similarly doesn't guarantee the canvas itself has keyboard focus, so both
  // live on this window-level listener rather than the canvas-focus-scoped one below. Aborting a
  // drag only cancels the transform (nothing was ever dispatched, so there's nothing to undo) — it
  // does not revert whatever selection change pointerdown already made, matching how drag-abort
  // works in other direct-manipulation editors.
  private handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (this.resizeState) {
      const { interaction, pointerId } = this.resizeState;
      this.resizeState = undefined;
      interaction.abort();
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.dragState) {
      const { interaction, pointerId } = this.dragState;
      this.dragState = undefined;
      interaction.abort();
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.marqueeState) {
      // Unlike drag/resize, a moved marquee already mutated `selection` live (no command was ever
      // dispatched) — Escape must restore the pre-marquee snapshot itself, not just drop a preview.
      const { pointerId, preSelection } = this.marqueeState;
      this.marqueeState = undefined;
      this.editor.setMarqueeRect(undefined);
      this.editor.selection.set(preSelection);
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.mode.kind === "placing") this.cancelPlacement();
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
    const targetId =
      event.target instanceof Element
        ? event.target.getAttribute("data-icad-id")
        : null;
    if (targetId && this.editor.focusedElement() !== targetId)
      this.editor.focusElement(targetId);
    const focusedId = this.editor.focusedElement();

    if (this.mode.kind === "connecting") {
      const fromId = this.mode.fromId;
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancelConnecting();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (focusedId && focusedId !== fromId)
          this.connectAndNotify(fromId, focusedId);
        this.cancelConnecting();
      } else if (event.key === "Tab") {
        const order = this.editor.tabOrder();
        const currentIndex = focusedId ? order.indexOf(focusedId) : -1;
        if (currentIndex === -1) return;
        const atBoundary = event.shiftKey
          ? currentIndex === 0
          : currentIndex === order.length - 1;
        if (atBoundary) return;
        event.preventDefault();
        if (event.shiftKey) this.editor.focusPrevious();
        else this.editor.focusNext();
        const nextId = this.editor.focusedElement();
        if (nextId && nextId !== fromId)
          this.editor.previewConnectorBetween(fromId, nextId);
      }
      return; // swallow every other key (e.g. arrows) while connecting
    }

    if (event.key === "Tab") {
      const order = this.editor.tabOrder();
      const currentIndex = focusedId ? order.indexOf(focusedId) : -1;
      if (currentIndex === -1) return; // nothing focused yet: let Tab enter natively
      const atBoundary = event.shiftKey
        ? currentIndex === 0
        : currentIndex === order.length - 1;
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

    if (
      event.key.toLowerCase() === "c" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const source = focusedId ?? this.editor.selection.get()[0];
      const el = source ? this.editor.scene.get(source) : undefined;
      if (!el || el.type === "connector" || el.type === "frame") return;
      event.preventDefault();
      this.startConnecting(el.id);
      return;
    }

    // Ctrl/Cmd+A (M16.3): the keyboard equivalent of marquee-selecting the entire canvas — every
    // scene element, matching what a click/marquee can already select (connectors and Frames
    // included).
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.editor.selection.set(this.editor.scene.all().map((el) => el.id));
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
