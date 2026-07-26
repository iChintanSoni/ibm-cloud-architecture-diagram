import type { Rect } from "../routing/orthogonalRouter.js";
import { Emitter } from "../util/emitter.js";

export interface ViewportState {
  /** Scene-space x of the viewport's top-left corner. */
  x: number;
  /** Scene-space y of the viewport's top-left corner. */
  y: number;
  /** Scene units per pixel is `1 / scale`; scale > 1 zooms in. */
  scale: number;
}

export interface ViewportSize {
  w: number;
  h: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Ephemeral pan/zoom camera (docs/06-editor-ux.md#core-interactions). Kept
 * outside the undo history and out of the `.icad` document — it's view
 * state, not document state.
 */
export class ViewportController {
  private state: ViewportState = { x: 0, y: 0, scale: 1 };
  private emitter = new Emitter<{ change: ViewportState }>();

  get(): ViewportState {
    return this.state;
  }

  set(next: Partial<ViewportState>): void {
    this.state = {
      x: next.x ?? this.state.x,
      y: next.y ?? this.state.y,
      scale: clampScale(next.scale ?? this.state.scale),
    };
    this.emitter.emit("change", this.state);
  }

  panBy(dx: number, dy: number): void {
    this.set({ x: this.state.x + dx, y: this.state.y + dy });
  }

  /** Zooms by a multiplicative factor, keeping `focal` (scene coords) fixed under the cursor. */
  zoomBy(factor: number, focal?: { x: number; y: number }): void {
    this.zoomTo(this.state.scale * factor, focal);
  }

  zoomTo(scale: number, focal?: { x: number; y: number }): void {
    const clamped = clampScale(scale);
    if (focal && clamped !== this.state.scale) {
      const ratio = this.state.scale / clamped;
      const x = focal.x - (focal.x - this.state.x) * ratio;
      const y = focal.y - (focal.y - this.state.y) * ratio;
      this.set({ x, y, scale: clamped });
    } else {
      this.set({ scale: clamped });
    }
  }

  reset(): void {
    this.set({ x: 0, y: 0, scale: 1 });
  }

  /** Centers on a scene-space rect, fitting it (with padding) into a viewport of `size` pixels. */
  focusOn(
    rect: Rect,
    size: ViewportSize,
    opts: { padding?: number; maxScale?: number } = {},
  ): void {
    const padding = opts.padding ?? 48;
    const availW = Math.max(1, size.w - padding * 2);
    const availH = Math.max(1, size.h - padding * 2);
    const fit = Math.min(
      availW / Math.max(rect.w, 1),
      availH / Math.max(rect.h, 1),
    );
    const scale = clampScale(Math.min(fit, opts.maxScale ?? 2));
    const x = rect.x + rect.w / 2 - size.w / (2 * scale);
    const y = rect.y + rect.h / 2 - size.h / (2 * scale);
    this.set({ x, y, scale });
  }

  on(listener: (state: ViewportState) => void): () => void {
    return this.emitter.on("change", listener);
  }
}
