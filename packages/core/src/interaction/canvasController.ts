import type {
  Editor,
  Interaction,
  ResizeInteraction,
} from "../api/createEditor.js";
import { clientPointToCanvas } from "../render/dom.js";
import type { Point } from "../render/port.js";
import { portPoint } from "../render/port.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import { isContainer } from "../scene/types.js";
import type {
  ConnectorElement,
  ElementId,
  PortRef,
  PortSide,
  SceneElement,
} from "../scene/types.js";
import { Emitter } from "../util/emitter.js";
import { hitTest, hitTestAll, hitTestRect } from "./hitTest.js";
import { resizeBounds, type ResizeHandle } from "./resize.js";
import { clampRectToParentInset, snapMove } from "./snapping.js";
import { pickPorts } from "../routing/pickPorts.js";

export type CanvasMode =
  | { kind: "idle" }
  | { kind: "connecting"; fromId: ElementId }
  | { kind: "placing" }
  | { kind: "dragging" }
  | { kind: "resizing" }
  | { kind: "rotating" }
  | { kind: "marquee" }
  | { kind: "panning" }
  | { kind: "waypoint-drag" }
  | { kind: "endpoint-drag" };

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
  /** Alt was held at pointerdown (M16.5): the moment this drag actually starts (crosses
   * DRAG_THRESHOLD), `ids` gets swapped for a fresh `duplicateElements()` clone so the originals
   * stay put and the clone is what ends up dragged — mirrored, not applied at pointerdown, so a
   * below-threshold Alt+click doesn't leave a stray duplicate behind. */
  cloneOnDrag: boolean;
}

interface ResizeState {
  pointerId: number;
  id: ElementId;
  handle: ResizeHandle;
  interaction: ResizeInteraction;
  startBounds: Rect;
  startScenePoint: Point;
}

/** Container types "double-click to drill into" applies to — Frame excluded, matching every
 * other place a pointer directly manipulates an element (drag, hover-ports, connect-mode): it's a
 * presentation-sectioning background, not an IBM containment primitive (docs/00-decision-log.md's
 * D24, docs/10-canvas-parity-plan.md's M14 sidebar-tab item). */
function isDrillableContainerType(el: SceneElement): boolean {
  return el.type === "box" || el.type === "zone" || el.type === "group";
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

/** Space+drag and middle-drag panning (M17.1, docs/10-canvas-parity-plan.md). No drag threshold —
 * unambiguous the moment either trigger fires, same reasoning M16.2 gave for resize handles. */
interface PanState {
  pointerId: number;
  lastClient: Point;
  /** Which trigger armed this pan — only a "space"-triggered pan ends early on keyup (mid-drag);
   * a middle-click pan only ends on its own pointerup, since there's no key to release. */
  via: "space" | "middle";
  moved: boolean;
}

/** Dragging an existing inner waypoint handle (M19). The waypoint index is 0-based within the
 * connector's `waypoints` array; a live preview is committed via `setConnectorWaypoints`. */
interface WaypointDragState {
  pointerId: number;
  connectorId: ElementId;
  /** 0-based index into the connector's inner `waypoints` array. */
  waypointIndex: number;
  /** The full waypoints snapshot at drag start — restored on Escape. */
  originalWaypoints: Array<{ x: number; y: number }>;
  startScenePoint: Point;
  currentPoint: Point;
}

/** Dragging a connector's `from` or `to` endpoint handle to a different port (M19). */
interface EndpointDragState {
  pointerId: number;
  connectorId: ElementId;
  endpoint: "from" | "to";
  startScenePoint: Point;
}

/**
 * Rotation gesture state (M20, docs/10-canvas-parity-plan.md). The rotation angle is computed
 * from the angle of the pointer vector relative to the element's center — the same approach
 * Figma and Illustrator use, which makes the handle's angular position match what the user drags.
 * `startAngle` is the initial pointer angle minus the element's current rotation so the element
 * doesn't jump when the drag starts.
 */
interface RotateState {
  pointerId: number;
  id: ElementId;
  /** Element center in scene space — constant for the duration of the gesture. */
  cx: number;
  cy: number;
  /** Angle offset so the element's current rotation is the starting point. */
  startOffset: number;
  /** Last committed rotation (for live preview label). */
  lastDeg: number;
}

/** Converts a wheel event into a zoom exponent (applied as `2 ** delta`, composable by summing
 * across events — see flushWheel). Ported from d3-zoom's wheelDelta, the cross-browser-tested
 * formula every major web map/canvas library (D3, Mapbox GL, OpenLayers) uses for exactly this
 * problem, rather than an invented constant:
 *
 * - `deltaMode` varies by device/browser (0 = pixels, the common case; 1 = lines; 2 = pages) and
 *   each mode's raw magnitude is wildly different, so the base multiplier is chosen per mode.
 * - Trackpad pinch-to-zoom (recognized by the OS as a "magnify" gesture, distinct from a "scroll"
 *   gesture — see handleWheel's doc comment) is reported as `wheel` events with `ctrlKey: true` in
 *   every major browser, including Safari, but at a far more conservative deltaY magnitude than an
 *   equivalent-speed two-finger scroll-pan's deltaX/deltaY. Without the 10x compensation here, zoom
 *   would always feel weaker than pan for the same physical gesture speed — which is exactly what
 *   was reported (docs/06-editor-ux.md#core-interactions). A real Ctrl+wheel from a physical mouse
 *   hits this same branch and gets the same boost; that's fine; both are "the user asked to zoom
 *   fast," just via different hardware.
 */
function wheelZoomDelta(event: WheelEvent): number {
  const base = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
  return -event.deltaY * base * (event.ctrlKey ? 10 : 1);
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
  /** Fired after copy/cut/paste/duplicate (M16.5) with the resulting elements — one callback
   * rather than four near-identical ones, since every shell formats these the same way ("N
   * copied"/"cut"/"pasted"/"duplicated"). Alt-drag-clone reports as "duplicate", matching its own
   * `duplicateElements()` plumbing. */
  onClipboardAction?: (
    action: "copy" | "cut" | "paste" | "duplicate",
    elements: SceneElement[],
  ) => void;
  /** Fired on a right-click (or its keyboard equivalent, the ContextMenu key / Shift+F10) with the
   * screen point to anchor a menu at and the scene point under it — the latter is what a "Paste"
   * item should pass to `Editor.paste()` so it lands where you actually right-clicked, not
   * wherever the pointer happens to be by the time the menu item runs. Core only reports *where*
   * and leaves *what the menu shows* entirely to the shell (M16.6) — selection has already been
   * synced to the hit target by the time this fires, so a shell only needs to read
   * `editor.selection` to decide which actions apply. */
  onContextMenu?: (
    screenPoint: { x: number; y: number },
    scenePoint: Point,
  ) => void;
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
 * Escape), marquee selection (fully-enclosed only, Escape-to-abort — M16.3), double-click to
 * drill into a nested Box/Zone/Group with Escape to step back out (M16.4 — while drilled, the
 * container's own background arms a scoped marquee instead of a move, mirroring Frame's existing
 * carve-out), and the canvas's own keyboard operability (Tab/Shift+Tab focus, Enter/Space select
 * — a second Enter on an already-selected drillable container drills into it, M16.4's own keyboard
 * equivalent, arrow-key nudge — drag-to-move's own keyboard equivalent, Delete/Backspace,
 * Ctrl/Cmd+A select-all — marquee's own keyboard equivalent, and Ctrl/Cmd+C/X/V/D copy/cut/paste/
 * duplicate — M16.5, inherently keyboard gestures with no separate equivalent to add) — see
 * docs/07-accessibility.md#canvas-the-hard-20, a hard requirement this class must keep meeting,
 * not just replicate incidentally. Resize's own keyboard equivalent is the Properties panel's
 * typed X/Y/W/H fields (`InspectorPanel.tsx`), which predate this gesture and already cover it —
 * mirroring how M16.1 found arrow-key nudge already covered drag-to-move; no new keyboard code was
 * needed for resize either. Alt-drag-clone (M16.5) is a new `cloneOnDrag` flag on the existing
 * `dragging` mode, not a mode of its own — the drag re-targets from the original ids onto a fresh
 * `duplicateElements()` clone the moment it crosses the drag threshold, so the originals stay put
 * and what's dragged from then on is the copy. Right-click (M16.6, keyboard equivalent: the Menu
 * key or Shift+F10) syncs selection to the hit target — an unselected target replaces the
 * selection, one already part of a multi-selection leaves it alone — and reports only *where* via
 * `onContextMenu`; *what* the menu shows and does is entirely `@icad/ui-web`'s `ContextMenu` and
 * whichever shell wires it, the same split `armPlacement`'s opaque callback already uses.
 * Alt+click (M16.7) cycles to the next element in the full occluded stack at that point
 * (`hitTestAll`'s own order) instead of always landing on the same "best" one a plain click picks
 * — no new keyboard code needed, since Tab/Shift+Tab's tab order (M8) already reaches every
 * element regardless of visual overlap.
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
  private rotateState: RotateState | undefined;
  private marqueeState: MarqueeState | undefined;
  private panState: PanState | undefined;
  private waypointDragState: WaypointDragState | undefined;
  private endpointDragState: EndpointDragState | undefined;
  /** Tracked across keydown/keyup (M17.1) so a plain left-button drag pans instead of arming a
   * marquee/element-drag while Space is held — cleared on keyup and on window blur so it never
   * gets stuck true if the key-up happens while focus is elsewhere. */
  private spaceHeld = false;
  /** Ancestor-to-innermost chain of containers currently drilled into (M16.4) — a persistent
   * scope that coexists with `mode` rather than replacing it (you can still drag/resize/marquee
   * while drilled), so it's tracked and emitted separately from CanvasMode. */
  private drillPath: ElementId[] = [];
  private drillEmitter = new Emitter<{ change: ElementId[] }>();
  /** Last scene point the pointer was seen at over the canvas (M16.5) — Ctrl/Cmd+V's "paste at
   * cursor" target. Not reset on pointer-leave: a keyboard-only paste shortly after the mouse was
   * last over the canvas landing near there is more useful than falling back to an offset paste. */
  private lastPointerScenePoint: Point | undefined;
  /** Alt+click select-through (M16.7): the client point and stack index of the last Alt+click, so
   * a second one at (near enough) the same spot advances to the next occluded element there
   * instead of restarting at the top — client space, not scene space, since it's comparing "did
   * the same pixel get clicked again," independent of pan/zoom between clicks. */
  private altClickCycle:
    { clientX: number; clientY: number; index: number } | undefined;
  /** A completed element drag or resize still fires a trailing native `click` on release — this
   * swallows exactly that one, so it doesn't re-hit-test at the (now-moved-to/resized-to) release
   * point and stomp the selection the gesture itself already settled. */
  private suppressNextClick = false;
  private onPlace: ((point: Point) => void) | undefined;
  private suspended = false;
  /** Wheel events (especially a trackpad pinch) can fire far faster than the display refreshes —
   * applying zoomBy/panBy synchronously per event forces a layout read (svgRenderer.applyViewport's
   * getBoundingClientRect) and a full app re-render on every one of them, which is expensive enough
   * that the browser starts coalescing/dropping events under load. Accumulating deltas here and
   * flushing once per animation frame caps that cost at the display refresh rate regardless of how
   * many wheel events land in between. */
  private pendingZoom: { delta: number; focal: Point | undefined } | undefined;
  private pendingPan: { dx: number; dy: number } | undefined;
  private wheelFrame: number | undefined;

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
    this.container.addEventListener("dblclick", this.handleDoubleClick);
    this.container.addEventListener("contextmenu", this.handleContextMenu);
    this.container.addEventListener("keydown", this.handleKeyDown);
    this.container.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("keydown", this.handleGlobalKeyDown);
    window.addEventListener("blur", this.handleWindowBlur);
  }

  destroy(): void {
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("pointerup", this.handlePointerUp);
    this.container.removeEventListener("click", this.handleClick);
    this.container.removeEventListener("dblclick", this.handleDoubleClick);
    this.container.removeEventListener("contextmenu", this.handleContextMenu);
    this.container.removeEventListener("keydown", this.handleKeyDown);
    this.container.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("keydown", this.handleGlobalKeyDown);
    window.removeEventListener("blur", this.handleWindowBlur);
    if (this.wheelFrame !== undefined) cancelAnimationFrame(this.wheelFrame);
  }

  getMode(): CanvasMode {
    return this.mode;
  }

  onModeChange(listener: (mode: CanvasMode) => void): () => void {
    return this.modeEmitter.on("change", listener);
  }

  /** Outermost-to-innermost chain of containers currently drilled into (M16.4) — empty when none. */
  getDrillPath(): ElementId[] {
    return this.drillPath;
  }

  onDrillChange(listener: (path: ElementId[]) => void): () => void {
    return this.drillEmitter.on("change", listener);
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

  private setDrillPath(path: ElementId[]): void {
    this.drillPath = path;
    this.editor.setDrillPath(path);
    this.drillEmitter.emit("change", path);
  }

  /** The innermost container currently drilled into, if any — the one whose own background arms
   * a scoped marquee instead of a move (see handlePointerDown/updateMarquee). */
  private drillScope(): ElementId | undefined {
    return this.drillPath[this.drillPath.length - 1];
  }

  /** A container is drillable once it actually has something inside it — an empty box/zone/group
   * has nothing a drilled marquee could reach, so entering it would be a no-op affordance. */
  private canDrillInto(id: ElementId): boolean {
    const el = this.editor.scene.get(id);
    if (!el || !isDrillableContainerType(el)) return false;
    return this.editor.scene.childrenOf(id).length > 0;
  }

  // Double-click to drill into a nested container (M16.4, docs/10-canvas-parity-plan.md — straight
  // from IBM's own kit instructions: "make sure the inside bounding box is highlighted by double
  // clicking on the inside shape"). Selects and focuses the double-clicked container itself (its
  // own two preceding native clicks already did this; explicit here so it also holds for a
  // synthetic dblclick with no preceding clicks, e.g. in tests) and pushes its drillable ancestor
  // chain — outermost first, the container itself last — so every one of them renders a faint
  // outline (SvgRenderer.setDrillPath) alongside whatever's actively selected inside it.
  private enterDrill(containerId: ElementId): void {
    const chain = [...this.editor.scene.ancestorsOf(containerId)]
      .reverse()
      .filter(isDrillableContainerType)
      .map((el) => el.id);
    chain.push(containerId);
    this.setDrillPath(chain);
    this.editor.selection.set([containerId]);
    this.editor.focusElement(containerId);
  }

  private handleDoubleClick = (event: MouseEvent): void => {
    if (this.mode.kind !== "idle") return;
    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;
    const hit = hitTest(this.editor.scene, point);
    if (!hit || !this.canDrillInto(hit.id)) return;
    if (this.drillScope() === hit.id) return; // already drilled all the way into this one
    this.enterDrill(hit.id);
  };

  /** Escape's drill-exit (M16.4): pops one level, re-selecting whatever's now the innermost
   * remaining container — mirroring how stepping "out" of a nested scope also steps the active
   * selection back out to its containing level, not just shrinking the faint-outline chain. */
  private stepOutOfDrill(): void {
    const next = this.drillPath.slice(0, -1);
    this.setDrillPath(next);
    const newInner = next[next.length - 1];
    this.editor.selection.set(newInner ? [newInner] : []);
  }

  // Right-click context menu (M16.6, docs/10-canvas-parity-plan.md): always preventDefault's the
  // browser's own menu. Syncs selection to the hit target first — an unselected target replaces
  // the selection (matching every other click-to-select path), but a target that's already part
  // of a multi-selection leaves the whole selection alone, so "right-click any member" acts on the
  // group; empty canvas or a Frame's own background (no real target, same carve-out marquee/drill
  // use) clears it instead, so the menu shows canvas-level actions. What the menu actually shows is
  // entirely the shell's call (`onContextMenu` only reports where).
  private handleContextMenu = (event: MouseEvent): void => {
    if (this.mode.kind !== "idle") return;
    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    const hit = hitTest(this.editor.scene, point);
    this.applyContextMenuSelection(hit);
    this.options.onContextMenu?.({ x: event.clientX, y: event.clientY }, point);
  };

  private applyContextMenuSelection(hit: SceneElement | undefined): void {
    if (!hit || hit.type === "frame") {
      this.editor.selection.clear();
      return;
    }
    if (!this.editor.selection.isSelected(hit.id)) {
      this.editor.selection.set([hit.id]);
      this.editor.focusElement(hit.id);
    }
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
  // Non-passive so preventDefault actually stops page scroll. Deltas are accumulated and applied
  // via flushWheel() at most once per animation frame rather than synchronously here — see
  // pendingZoom/pendingPan's doc comment for why.
  private handleWheel = (event: WheelEvent): void => {
    const svg = this.svg();
    if (!svg) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const focal = clientPointToCanvas(svg, event.clientX, event.clientY);
      this.pendingZoom = {
        delta: (this.pendingZoom?.delta ?? 0) + wheelZoomDelta(event),
        focal,
      };
    } else {
      this.pendingPan = {
        dx: (this.pendingPan?.dx ?? 0) + event.deltaX,
        dy: (this.pendingPan?.dy ?? 0) + event.deltaY,
      };
    }
    if (this.wheelFrame === undefined) {
      this.wheelFrame = requestAnimationFrame(this.flushWheel);
    }
  };

  private flushWheel = (): void => {
    this.wheelFrame = undefined;
    if (this.pendingZoom) {
      const { delta, focal } = this.pendingZoom;
      this.pendingZoom = undefined;
      // 2**delta factors compose by summing exponents, so batching every event's wheelZoomDelta
      // into one sum before a single exponentiation reproduces applying zoomBy per-event exactly.
      this.editor.viewport.zoomBy(2 ** delta, focal);
    }
    if (this.pendingPan) {
      const { dx, dy } = this.pendingPan;
      this.pendingPan = undefined;
      const { scale } = this.editor.viewport.get();
      this.editor.viewport.panBy(dx / scale, dy / scale);
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

  /** Panning cursor feedback (M17.1): "grab" while armed (Space held, not yet dragging) and
   * "grabbing" while actively panning — mirrors the existing inline `resizeCursor(handle)` styling
   * already used for resize handles. */
  private updateCursor(): void {
    this.container.style.cursor = this.panState
      ? "grabbing"
      : this.spaceHeld
        ? "grab"
        : "";
  }

  /** Ends an in-progress pan and restores idle, regardless of what triggered it — shared by
   * pointerup, Space keyup (mid-drag), and window blur (M17.1). */
  private endPan(): void {
    if (!this.panState) return;
    this.releasePointer(this.panState.pointerId);
    if (this.panState.moved) this.suppressNextClick = true;
    this.panState = undefined;
    this.setMode({ kind: "idle" });
    this.updateCursor();
  }

  /** Space/middle-drag panning cleared if focus leaves the window mid-gesture (e.g. Alt-Tab while
   * holding Space) — otherwise `spaceHeld`/the "grab" cursor could get stuck on with no keyup ever
   * arriving to clear it. */
  private handleWindowBlur = (): void => {
    this.spaceHeld = false;
    this.endPan();
    this.updateCursor();
  };

  // Pointer drag-to-connect (docs/06-editor-ux.md#core-interactions): hover a shape to reveal its
  // ports (SvgRenderer draws them), pointerdown on one starts a rubber-band drag; dropping on
  // another element's port uses that exact port, dropping anywhere else on it auto-picks a
  // reasonable pair (connectNearest); dropping on empty canvas cancels.
  private handlePointerMove = (event: PointerEvent): void => {
    if (this.panState) {
      this.updatePan(event);
      return;
    }
    if (this.mode.kind === "placing") return;
    const point = this.toScenePoint(event.clientX, event.clientY);
    if (!point) return;
    this.lastPointerScenePoint = point;

    if (this.resizeState) {
      this.updateResize(event, point);
      return;
    }

    if (this.dragState) {
      this.updateDrag(event, point);
      return;
    }

    if (this.rotateState) {
      this.updateRotate(event, point);
      return;
    }

    if (this.marqueeState) {
      this.updateMarquee(event, point);
      return;
    }

    if (this.waypointDragState) {
      this.updateWaypointDrag(point);
      return;
    }

    if (this.endpointDragState) {
      this.updateEndpointDrag(point);
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

  // Space+drag / middle-drag panning (M17.1, docs/10-canvas-parity-plan.md): no scene/command
  // involvement at all — purely a `ViewportController` change. Note the sign is the *opposite* of
  // `handleWheel`'s scroll-pan: a "grab" gesture drags the content along with the cursor (dragging
  // right moves the viewport's scene-space origin left, so content visually follows the hand),
  // where scrolling conventionally pans the viewport itself in the scroll direction. Two gestures,
  // two intuitive conventions — not an inconsistency. No drag threshold, matching resize's own
  // "grabbing is unambiguous" reasoning (M16.2).
  private updatePan(event: PointerEvent): void {
    const pan = this.panState;
    if (!pan) return;
    const dxClient = event.clientX - pan.lastClient.x;
    const dyClient = event.clientY - pan.lastClient.y;
    if (dxClient !== 0 || dyClient !== 0) pan.moved = true;
    pan.lastClient = { x: event.clientX, y: event.clientY };
    const { scale } = this.editor.viewport.get();
    this.editor.viewport.panBy(-dxClient / scale, -dyClient / scale);
  }

  // Rotation gesture (M20, docs/10-canvas-parity-plan.md): compute the pointer's current angle
  // about the element center, subtract the startOffset to get the candidate rotation, 15° snap on
  // Shift, live-preview via a renderer repaint, show the HUD readout.
  private updateRotate(event: PointerEvent, point: Point): void {
    const s = this.rotateState;
    if (!s || !point) return;
    const dx = point.x - s.cx;
    const dy = point.y - s.cy;
    const rawAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    let deg = (((rawAngleDeg - s.startOffset) % 360) + 360) % 360;
    if (event.shiftKey) deg = Math.round(deg / 15) * 15;
    s.lastDeg = deg;
    // Live preview: re-render just this element at the candidate rotation.
    this.editor.rotateElementPreview(s.id, deg);
    this.editor.setGestureReadout({
      text: `${Math.round(deg)}°`,
      at: { x: s.cx, y: s.cy },
    });
  }

  // Drag-to-move (M16, docs/10-canvas-parity-plan.md): armed on pointerdown over a selectable
  // element, but only becomes a real drag once the pointer has moved DRAG_THRESHOLD client px —
  // short of that, this stays a plain click (handleClick fires normally on release). Selection is
  // updated here rather than in handleClick so a drag can start immediately with the right
  // elements, matching standard direct-manipulation editors: an unselected target becomes the
  // (possibly Shift-extended) selection right away; an already-selected target's whole
  // multi-selection is preserved so the group drags together; Shift-clicking an already-selected
  // target is left for handleClick's own toggle-off, not armed as a drag at all.
  private handlePointerDown = (event: PointerEvent): void => {
    // Space+drag / middle-drag panning (M17.1) takes priority over every other pointerdown
    // branch below — resize handle, port, element, marquee — same as a resize handle grab takes
    // priority over hit-testing. Gated on `idle` (matching the resize-handle check just below) to
    // keep the state machine to one active gesture at a time; middle-click while some other
    // gesture is already mid-flight is an unsupported chord, not a case this needs to handle.
    if (this.mode.kind === "idle" && (event.button === 1 || this.spaceHeld)) {
      event.preventDefault();
      this.panState = {
        pointerId: event.pointerId,
        lastClient: { x: event.clientX, y: event.clientY },
        via: event.button === 1 ? "middle" : "space",
        moved: false,
      };
      this.capturePointer(event.pointerId);
      this.setMode({ kind: "panning" });
      this.updateCursor();
      return;
    }

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
      // Locked elements cannot be resized (M18.4).
      if (!id || !el || !point || el.locked) return;
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

    // M20 — Rotation handle (data-icad-rotation-handle="elementId").
    const rotationHandleAttr =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-rotation-handle]")
            ?.getAttribute("data-icad-rotation-handle")
        : null;
    if (rotationHandleAttr && this.mode.kind === "idle") {
      const id = rotationHandleAttr;
      const el = this.editor.scene.get(id);
      const point = this.toScenePoint(event.clientX, event.clientY);
      if (
        !el ||
        !point ||
        el.locked ||
        el.type === "connector" ||
        el.type === "frame"
      )
        return;
      event.preventDefault();
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const pointerAngleDeg =
        (Math.atan2(point.y - cy, point.x - cx) * 180) / Math.PI + 90;
      const startOffset = pointerAngleDeg - (el.rotation ?? 0);
      this.rotateState = {
        pointerId: event.pointerId,
        id,
        cx,
        cy,
        startOffset,
        lastDeg: el.rotation ?? 0,
      };
      this.capturePointer(event.pointerId);
      this.setMode({ kind: "rotating" });
      this.editor.setGestureReadout({
        text: `${Math.round(el.rotation ?? 0)}°`,
        at: { x: cx, y: cy },
      });
      return;
    }

    // M19 — Waypoint drag handle (data-icad-waypoint-handle="connId:index").
    const waypointHandleAttr =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-waypoint-handle]")
            ?.getAttribute("data-icad-waypoint-handle")
        : null;
    if (waypointHandleAttr && this.mode.kind === "idle") {
      const point = this.toScenePoint(event.clientX, event.clientY);
      if (!point) return;
      const separator = waypointHandleAttr.lastIndexOf(":");
      const connectorId = waypointHandleAttr.slice(0, separator);
      const waypointIndex = parseInt(
        waypointHandleAttr.slice(separator + 1),
        10,
      );
      const el = this.editor.scene.get(connectorId) as
        ConnectorElement | undefined;
      if (!el) return;
      event.preventDefault();
      this.waypointDragState = {
        pointerId: event.pointerId,
        connectorId,
        waypointIndex,
        originalWaypoints: [...(el.waypoints ?? [])],
        startScenePoint: point,
        currentPoint: point,
      };
      this.capturePointer(event.pointerId);
      this.setMode({ kind: "waypoint-drag" });
      return;
    }

    // M19 — Midpoint insert handle (data-icad-waypoint-insert="connId:insertIndex").
    const waypointInsertAttr =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-waypoint-insert]")
            ?.getAttribute("data-icad-waypoint-insert")
        : null;
    if (waypointInsertAttr && this.mode.kind === "idle") {
      const point = this.toScenePoint(event.clientX, event.clientY);
      if (!point) return;
      const separator = waypointInsertAttr.lastIndexOf(":");
      const connectorId = waypointInsertAttr.slice(0, separator);
      const insertIndex = parseInt(waypointInsertAttr.slice(separator + 1), 10);
      const el = this.editor.scene.get(connectorId) as
        ConnectorElement | undefined;
      if (!el) return;
      // Insert the new point at `insertIndex` (between fullPoints[insertIndex] and
      // fullPoints[insertIndex+1], which means before innerWaypoints[insertIndex]).
      const current = [...(el.waypoints ?? [])];
      current.splice(insertIndex, 0, { x: point.x, y: point.y });
      event.preventDefault();
      this.waypointDragState = {
        pointerId: event.pointerId,
        connectorId,
        waypointIndex: insertIndex,
        originalWaypoints: [...(el.waypoints ?? [])],
        startScenePoint: point,
        currentPoint: point,
      };
      // Immediately write the waypoints so this now has something to drag.
      this.editor.setConnectorWaypoints(connectorId, current);
      this.capturePointer(event.pointerId);
      this.setMode({ kind: "waypoint-drag" });
      return;
    }

    // M19 — Endpoint retarget handle (data-icad-endpoint-handle="connId:from|to").
    const endpointHandleAttr =
      event.target instanceof Element
        ? event.target
            .closest<SVGElement>("[data-icad-endpoint-handle]")
            ?.getAttribute("data-icad-endpoint-handle")
        : null;
    if (endpointHandleAttr && this.mode.kind === "idle") {
      const point = this.toScenePoint(event.clientX, event.clientY);
      if (!point) return;
      const separator = endpointHandleAttr.lastIndexOf(":");
      const connectorId = endpointHandleAttr.slice(0, separator);
      const endpoint = endpointHandleAttr.slice(separator + 1) as "from" | "to";
      event.preventDefault();
      this.endpointDragState = {
        pointerId: event.pointerId,
        connectorId,
        endpoint,
        startScenePoint: point,
      };
      // Show a draft line from the current endpoint while dragging.
      const el = this.editor.scene.get(connectorId) as
        ConnectorElement | undefined;
      if (el) {
        const anchorEl = this.editor.scene.get(
          endpoint === "from" ? el.to.elementId : el.from.elementId,
        );
        if (anchorEl) {
          const anchorPort = endpoint === "from" ? el.to.port : el.from.port;
          this.editor.setConnectorDraftPoints(
            portPoint(anchorEl, anchorPort),
            point,
          );
        }
      }
      this.capturePointer(event.pointerId);
      this.setMode({ kind: "endpoint-drag" });
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
    // Hidden elements are excluded from pointer hit-testing (M18.4) — still reachable via keyboard.
    const hit = hitTest(this.editor.scene, point, { excludeHidden: true });
    // A connector has no drag semantics and no drag-arm-able background either — leave it to the
    // trailing click, same as before marquee existed.
    if (hit && hit.type === "connector") return;

    if (!hit || hit.type === "frame" || hit.id === this.drillScope()) {
      // Empty canvas, a Frame's own background (Frame has no drag semantics, D25), or the
      // background of the container currently drilled into (M16.4): in all three cases a
      // press-drag starting there is unambiguously a marquee, not a move — otherwise dragging the
      // drilled container's own body would make it impossible to rubber-band select its contents,
      // exactly the problem Frame's carve-out already solves for the "spans most of the canvas"
      // case.
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

    // Locked elements cannot be dragged — if every selected element is locked, fall through
    // to a marquee instead. If only some are locked, the unlocked subset can still move (M18.4).
    const ids = this.editor.selection
      .get()
      .filter((id) => !this.editor.scene.get(id)?.locked);
    if (ids.length === 0) return; // all locked: arm nothing (allow trailing click to still select)
    this.dragState = {
      pointerId: event.pointerId,
      ids,
      interaction: this.editor.beginInteraction(ids),
      startClient: { x: event.clientX, y: event.clientY },
      startScenePoint: point,
      moved: false,
      cloneOnDrag: event.altKey,
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
    let enclosed = hitTestRect(this.editor.scene, rect);
    // Drilled in (M16.4): a rubber-band drawn while working inside a container should only ever
    // reach that container's own contents, even if it happens to also enclose something outside
    // it — the whole point of drilling in is to scope the working set to what's inside.
    const scope = this.drillScope();
    if (scope) {
      enclosed = enclosed.filter((el) =>
        this.editor.scene.isSelfOrDescendant(scope, el.id),
      );
    }
    const enclosedIds = enclosed.map((el) => el.id);
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

      // Alt-drag-clone (M16.5): only now, at the exact moment this becomes a real drag — arming
      // it eagerly at pointerdown would leave a stray duplicate behind a plain Alt+click that
      // never actually dragged. `duplicateElements` already dispatches its own undoable command
      // and re-selects the clone; the fresh `beginInteraction` below re-targets the *live* drag
      // preview onto it, so what visibly moves under the pointer from here on is the clone, not
      // the originals (which stay exactly where they were).
      if (drag.cloneOnDrag) {
        const clonedIds = this.editor.duplicateElements(drag.ids);
        if (clonedIds.length > 0) {
          this.options.onClipboardAction?.(
            "duplicate",
            clonedIds
              .map((id) => this.editor.scene.get(id))
              .filter((el): el is SceneElement => el !== undefined),
          );
          drag.interaction.abort(); // no-op: nothing was ever previewed on the originals
          drag.ids = clonedIds;
          drag.interaction = this.editor.beginInteraction(clonedIds);
        }
      }
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
    // Alignment guides + live position readout (M17.2, docs/10-canvas-parity-plan.md) — cleared
    // together at drag end/abort (handlePointerUp/handleGlobalKeyDown). A locked axis's own guide
    // is dropped too (its delta is forced to 0 regardless of what snapMove found there, so drawing
    // it would describe a snap that isn't actually being applied).
    const guides = snapped.guides.filter((guide) =>
      lockAxis === "x"
        ? guide.orientation !== "vertical"
        : lockAxis === "y"
          ? guide.orientation !== "horizontal"
          : true,
    );
    this.editor.setSnapGuides(guides);
    const bbox = this.editor.boundsOf(drag.ids);
    if (bbox) {
      const x = bbox.x + finalDx;
      const y = bbox.y + finalDy;
      this.editor.setGestureReadout({
        text: `${Math.round(x)}, ${Math.round(y)}`,
        at: { x, y },
      });
    }
    const dropTargetId = this.dropTargetAt(point, drag.ids);
    this.editor.setDropTarget(dropTargetId);
    drag.interaction.update(finalDx, finalDy, dropTargetId);
  }

  // Drop-target detection (M17.6, docs/10-canvas-parity-plan.md): the deepest container under the
  // pointer's *current* scene point — hitTestAll's own deepest-first stack means a point over a
  // nested leaf (e.g. hovering a sibling icon inside the real target container) still resolves to
  // that container, not just a bare-background hit. Excludes the dragged selection's own current
  // shared parent (nothing new would happen), every one of the dragged ids, and any of their own
  // descendants (a cycle `reparentElement` would otherwise throw constructing) — mirrors
  // `reparentElement`'s own `isSelfOrDescendant` guard so this never promises a drop that would
  // then fail at commit.
  private dropTargetAt(
    point: Point,
    draggedIds: ElementId[],
  ): ElementId | undefined {
    const scene = this.editor.scene;
    const currentParentId = scene.sharedParentId(draggedIds);
    const stack = hitTestAll(scene, point);
    const target = stack.find(
      (hit) =>
        isContainer(hit) &&
        hit.id !== currentParentId &&
        !draggedIds.some((id) => scene.isSelfOrDescendant(id, hit.id)),
    );
    return target?.id;
  }

  // 8-handle resize (M16.2, docs/10-canvas-parity-plan.md): unlike drag-to-move there's no
  // threshold — grabbing a handle is unambiguous, so this is "resizing" from the first pointermove.
  // No move-with — resizeBounds/beginResizeInteraction only ever touch the one resized element,
  // not its descendants. Parent-inset clamping (M17.3) mirrors drag's own layering: this class
  // already owns calling snapMove() for drag, so it owns calling clampRectToParentInset() here too
  // — beginResizeInteraction() just previews/commits whatever geometry it's given either way.
  private updateResize(event: PointerEvent, point: Point): void {
    const resize = this.resizeState;
    if (!resize) return;
    const dx = point.x - resize.startScenePoint.x;
    const dy = point.y - resize.startScenePoint.y;
    const raw = resizeBounds(resize.startBounds, resize.handle, dx, dy, {
      aspectLock: event.shiftKey,
      fromCenter: event.altKey,
    });
    const parentId = this.editor.scene.get(resize.id)?.parentId;
    const bounds = clampRectToParentInset(this.editor.scene, parentId, raw);
    // Live dimension readout (M17.2, docs/10-canvas-parity-plan.md) — cleared at resize end/abort
    // (handlePointerUp/handleGlobalKeyDown), same lifecycle as drag's own position readout. Reads
    // the clamped bounds, not the raw candidate, so the HUD always matches what's actually
    // previewed/committed.
    this.editor.setGestureReadout({
      text: `${Math.round(bounds.w)} × ${Math.round(bounds.h)}`,
      at: { x: bounds.x, y: bounds.y },
    });
    resize.interaction.update(bounds);
  }

  /** Live waypoint drag preview (M19): updates the renderer's preview path (no command
   * dispatched — a single setConnectorWaypoints command fires on pointerup so there's exactly
   * one undo entry for the whole drag, matching resize's own one-commit-per-gesture model).
   * No drag threshold — a handle grab is unambiguous, same reasoning as resize handles. */
  private updateWaypointDrag(point: Point): void {
    const wds = this.waypointDragState;
    if (!wds) return;
    wds.currentPoint = point;
    const el = this.editor.scene.get(wds.connectorId) as
      ConnectorElement | undefined;
    const baseWaypoints = el?.waypoints ?? wds.originalWaypoints;
    const updated = [...baseWaypoints];
    updated[wds.waypointIndex] = { x: point.x, y: point.y };
    wds.currentPoint = point;
    this.editor.previewConnectorWaypoints(wds.connectorId, updated);
  }

  /** Live endpoint retarget draft (M19): updates the draft connector line while the endpoint is
   * being dragged toward a new target element. */
  private updateEndpointDrag(point: Point): void {
    const eds = this.endpointDragState;
    if (!eds) return;
    const el = this.editor.scene.get(eds.connectorId) as
      ConnectorElement | undefined;
    if (!el) return;
    // Show a draft line from the fixed endpoint to the current cursor position.
    const anchorEl = this.editor.scene.get(
      eds.endpoint === "from" ? el.to.elementId : el.from.elementId,
    );
    if (anchorEl) {
      const anchorPort = eds.endpoint === "from" ? el.to.port : el.from.port;
      this.editor.setConnectorDraftPoints(
        portPoint(anchorEl, anchorPort),
        point,
      );
    }
    // Highlight the element under the pointer as a potential drop target.
    const hit = hitTest(this.editor.scene, point, { excludeHidden: true });
    this.editor.setHoveredElement(
      hit && hit.type !== "connector" && hit.type !== "frame"
        ? hit.id
        : undefined,
    );
  }

  private handlePointerUp = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);

    if (this.panState) {
      this.endPan();
      return;
    }

    if (this.resizeState) {
      const { interaction } = this.resizeState;
      this.resizeState = undefined;
      interaction.commit();
      this.editor.setGestureReadout(undefined);
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
      this.editor.setSnapGuides([]);
      this.editor.setGestureReadout(undefined);
      this.editor.setDropTarget(undefined);
      this.setMode({ kind: "idle" });
      return;
    }

    if (this.rotateState) {
      const { id, lastDeg } = this.rotateState;
      this.rotateState = undefined;
      // Clear live preview before committing so the commit renders the final state.
      this.editor.rotateElementPreview(id, null);
      this.editor.rotateElement(id, lastDeg);
      this.editor.setGestureReadout(undefined);
      this.suppressNextClick = true;
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

    if (this.waypointDragState) {
      // Clear the renderer-only preview, then commit the final waypoints as one undo step.
      const { connectorId, waypointIndex, currentPoint } =
        this.waypointDragState;
      this.waypointDragState = undefined;
      this.editor.previewConnectorWaypoints(connectorId, null);
      this.setMode({ kind: "idle" });
      // Build the final waypoints from the scene state (which still has the original, since
      // the preview was renderer-only) plus the final drag position.
      const el = this.editor.scene.get(connectorId) as
        ConnectorElement | undefined;
      if (el?.waypoints) {
        const final = [...el.waypoints];
        final[waypointIndex] = { x: currentPoint.x, y: currentPoint.y };
        this.editor.setConnectorWaypoints(connectorId, final);
      }
      this.suppressNextClick = true;
      return;
    }

    if (this.endpointDragState) {
      const { connectorId, endpoint } = this.endpointDragState;
      this.endpointDragState = undefined;
      this.editor.clearConnectorDraft();
      this.setMode({ kind: "idle" });
      const point = this.toScenePoint(event.clientX, event.clientY);
      if (point) {
        // Check if dropped on a port handle.
        const targetPortAttrOnUp =
          event.target instanceof Element
            ? event.target
                .closest<SVGElement>("[data-icad-port]")
                ?.getAttribute("data-icad-port")
            : null;
        if (targetPortAttrOnUp) {
          const target = parsePortAttr(targetPortAttrOnUp);
          const portRef: PortRef = {
            elementId: target.elementId,
            port: target.side,
          };
          const current = this.editor.scene.get(connectorId) as
            ConnectorElement | undefined;
          if (
            current &&
            target.elementId !==
              (endpoint === "from"
                ? current.from.elementId
                : current.to.elementId)
          ) {
            this.editor.retargetConnector(
              connectorId,
              endpoint === "from" ? portRef : undefined,
              endpoint === "to" ? portRef : undefined,
            );
          }
        } else {
          // Dropped on an element — auto-pick the nearest port between
          // the fixed endpoint and the drop target.
          const hit = hitTest(this.editor.scene, point, {
            excludeHidden: true,
          });
          if (hit && hit.type !== "connector") {
            const current = this.editor.scene.get(connectorId) as
              ConnectorElement | undefined;
            const fixedId =
              endpoint === "from"
                ? current?.to.elementId
                : current?.from.elementId;
            if (
              current &&
              hit.id !==
                (endpoint === "from"
                  ? current.from.elementId
                  : current.to.elementId)
            ) {
              const fixed = fixedId
                ? this.editor.scene.get(fixedId)
                : undefined;
              const pickedPort = fixed
                ? pickPorts(hit, fixed)[endpoint === "from" ? "from" : "to"]
                : "center";
              const portRef: PortRef = { elementId: hit.id, port: pickedPort };
              this.editor.retargetConnector(
                connectorId,
                endpoint === "from" ? portRef : undefined,
                endpoint === "to" ? portRef : undefined,
              );
            }
          }
        }
      }
      this.suppressNextClick = true;
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
    // Hidden elements are excluded from pointer hit-testing (M18.4) — consistent with pointerdown.
    const hit = point
      ? hitTest(this.editor.scene, point, { excludeHidden: true })
      : undefined;

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
    } else if (event.altKey) {
      this.selectThrough(event.clientX, event.clientY, point!);
    } else if (event.shiftKey) {
      this.editor.selection.toggle(hit.id);
      this.editor.focusElement(hit.id);
    } else {
      this.editor.selection.set([hit.id]);
      this.editor.focusElement(hit.id);
    }
  };

  // Alt+click select-through (M16.7, docs/10-canvas-parity-plan.md): cycles to the next element in
  // the full occluded stack at this point (hitTestAll's own deepest-then-topmost order) rather than
  // always landing on the same "best" one a plain click picks. Alt+click always replaces the
  // selection outright — it's a reveal tool for reaching one specific occluded element, not a
  // multi-select gesture like Shift-click. No new keyboard code needed: Tab/Shift+Tab's tab order
  // (M8) already reaches every element regardless of visual overlap, the same "already covered"
  // finding M16.1/M16.2 made for nudge/Properties respectively.
  private selectThrough(clientX: number, clientY: number, point: Point): void {
    const stack = hitTestAll(this.editor.scene, point);
    if (stack.length === 0) {
      this.editor.selection.clear();
      this.altClickCycle = undefined;
      return;
    }
    const previous = this.altClickCycle;
    const samePoint =
      previous !== undefined &&
      Math.hypot(clientX - previous.clientX, clientY - previous.clientY) < 2;
    const index = samePoint ? (previous!.index + 1) % stack.length : 0;
    this.altClickCycle = { clientX, clientY, index };
    const target = stack[index]!;
    this.editor.selection.set([target.id]);
    this.editor.focusElement(target.id);
  }

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
      this.editor.setGestureReadout(undefined);
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.rotateState) {
      const { id, pointerId } = this.rotateState;
      this.rotateState = undefined;
      this.editor.rotateElementPreview(id, null);
      this.editor.setGestureReadout(undefined);
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.dragState) {
      const { interaction, pointerId } = this.dragState;
      this.dragState = undefined;
      interaction.abort();
      this.editor.setSnapGuides([]);
      this.editor.setGestureReadout(undefined);
      this.editor.setDropTarget(undefined);
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.waypointDragState) {
      // Preview was renderer-only — clear it without dispatching any command.
      const { connectorId, pointerId } = this.waypointDragState;
      this.waypointDragState = undefined;
      this.editor.previewConnectorWaypoints(connectorId, null);
      this.releasePointer(pointerId);
      this.setMode({ kind: "idle" });
      return;
    }
    if (this.endpointDragState) {
      const { pointerId } = this.endpointDragState;
      this.endpointDragState = undefined;
      this.editor.clearConnectorDraft();
      this.editor.setHoveredElement(undefined);
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
    if (this.mode.kind === "placing") {
      this.cancelPlacement();
      return;
    }
    // Drill step-out (M16.4): only once nothing else claimed this Escape — a gesture in progress
    // or an armed placement takes priority, matching how those checks above already order
    // themselves from most to least transient.
    if (this.drillPath.length > 0) this.stepOutOfDrill();
  };

  // Keyboard-operable canvas (docs/07-accessibility.md#canvas-the-hard-20). Tab/Shift+Tab move
  // keyboard focus only — wrapping is disabled at the boundary so Tab can still exit to
  // surrounding chrome (no keyboard trap) — Enter/Space select the focused element (Shift+
  // toggles it into/out of a multi-selection), arrow keys nudge the current selection,
  // Delete/Backspace removes it, and "c" starts keyboard connect mode (Tab to a target, Enter to
  // confirm, Escape to cancel).
  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.suspended) return;

    // Space+drag panning (M17.1): tracked here rather than gated to a specific mode, so a
    // subsequent pointerdown can arm panning regardless of what's currently focused/selected.
    // Never returns early — Space's existing "select the focused element" meaning (below, and
    // inside the "connecting" branch's own confirm-key handling) is unaffected: a keyboard-only
    // user never also fires a pointerdown, so there's no real conflict, only a harmless flag that
    // arming (handlePointerDown) checks and this event alone never acts on.
    if (event.key === " ") {
      if (!event.repeat) {
        this.spaceHeld = true;
        this.updateCursor();
      }
      event.preventDefault();
    }

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
      // Enter on an already-selected, already-focused drillable container is the keyboard
      // equivalent of the second click in a double-click (D19): the first Enter selects it (the
      // branch below, same as any other element), a second Enter drills into it. Space stays
      // pure toggle-selection, never drills — mirroring how the mouse path only drills on an
      // actual double-click, not two separate single clicks.
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        this.editor.selection.get().length === 1 &&
        this.editor.selection.isSelected(focusedId) &&
        this.drillScope() !== focusedId &&
        this.canDrillInto(focusedId)
      ) {
        this.enterDrill(focusedId);
        return;
      }
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

    // Clipboard (M16.5): copy/cut/duplicate need a selection; paste doesn't. All four are
    // inherently keyboard-native gestures, so — unlike drag/resize/marquee — there's no separate
    // "keyboard equivalent" to add; Alt-drag-clone's own equivalent is Ctrl/Cmd+D (this duplicate)
    // followed by arrow-key nudge, both already covered.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === "c" || key === "x") {
        const ids = this.editor.selection.get();
        if (ids.length === 0) return;
        event.preventDefault();
        const copied =
          key === "c" ? this.editor.copy(ids) : this.editor.cut(ids);
        if (copied.length > 0)
          this.options.onClipboardAction?.(
            key === "c" ? "copy" : "cut",
            copied,
          );
        return;
      }
      if (key === "v") {
        event.preventDefault();
        const pastedIds = this.editor.paste(this.lastPointerScenePoint);
        if (pastedIds.length > 0) {
          this.options.onClipboardAction?.(
            "paste",
            pastedIds
              .map((id) => this.editor.scene.get(id))
              .filter((el): el is SceneElement => el !== undefined),
          );
        }
        return;
      }
      if (key === "d") {
        const ids = this.editor.selection.get();
        if (ids.length === 0) return;
        event.preventDefault();
        const duplicatedIds = this.editor.duplicateElements(ids);
        if (duplicatedIds.length > 0) {
          this.options.onClipboardAction?.(
            "duplicate",
            duplicatedIds
              .map((id) => this.editor.scene.get(id))
              .filter((el): el is SceneElement => el !== undefined),
          );
        }
        return;
      }
    }

    // Context menu (M16.6): the dedicated Menu key, or Shift+F10 (the conventional fallback on
    // keyboards without one) — opens at the focused/selected element's own screen and scene
    // position, mirroring a right-click there. A pure-keyboard user with nothing focused/selected
    // yet has no meaningful anchor point, so this is a no-op rather than guessing one.
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      const id = focusedId ?? this.editor.selection.get()[0];
      if (!id || !this.editor.scene.has(id)) return;
      event.preventDefault();
      const node = this.container.querySelector(`[data-icad-id="${id}"]`);
      const rect =
        node instanceof Element ? node.getBoundingClientRect() : null;
      const screenPoint = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 0, y: 0 };
      const bbox = this.editor.boundsOf([id]);
      const scenePoint = bbox
        ? { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }
        : { x: 0, y: 0 };
      this.options.onContextMenu?.(screenPoint, scenePoint);
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
      // Locked elements cannot be deleted via keyboard (M18.4) — same gate as drag.
      const deletable = selected.filter(
        (id) => !this.editor.scene.get(id)?.locked,
      );
      if (deletable.length === 0) return;
      event.preventDefault();
      const deleted = deletable
        .map((id) => this.editor.scene.get(id))
        .filter((el): el is SceneElement => el !== undefined);
      this.editor.deleteElements(deletable);
      this.options.onDeleted?.(deleted);
    }
  };

  // Space+drag panning (M17.1): releasing Space ends a space-triggered pan immediately even if the
  // mouse button is still down (matching how other direct-manipulation editors treat the key, not
  // the button, as what defines the gesture) — a middle-click pan has no key to release, so it's
  // untouched here and only ever ends on its own pointerup.
  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key !== " ") return;
    this.spaceHeld = false;
    if (this.panState?.via === "space") this.endPan();
    this.updateCursor();
  };
}
