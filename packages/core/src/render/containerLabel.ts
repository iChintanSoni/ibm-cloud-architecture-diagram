import type { SceneElement } from "../scene/types.js";
import type { Rect } from "../routing/orthogonalRouter.js";
import { measureText } from "./textMetrics.js";

/**
 * Inset and on-screen size of a container's (box/group/zone) corner glyph from its own top-left
 * corner — an ICAD affordance for confirmed presets (packages/ui-web/src/presets.ts), not a
 * full-tile IBM node icon: IBM's own worked examples render container tabs with no corner icon at
 * all, so this display size isn't itself IBM-specified and is kept at its pre-existing 20x20
 * (scaled down from the shared GLYPH_VIEWBOX_SIZE coordinate space) rather than matched to
 * NODE_GLYPH_SIZE.
 */
export const CONTAINER_GLYPH_INSET = 12;
export const CONTAINER_GLYPH_SIZE = 20;
/**
 * Horizontal gap between a Group's corner icon and its own label, rendered beside it —
 * confirmed by IBM's own worked examples (IKS_SR_MZ_Classic.svg: Region/Zone/Kubernetes
 * boundary labels sit to the right of their corner glyph, baseline-aligned, not below the
 * boundary), consistent with D24's Box/Boundary corner-glyph convention.
 */
export const CONTAINER_LABEL_GAP = 8;

/**
 * Font-size a container label renders at (svgRenderer.ts's containerLabelText sets no explicit
 * font-size, inheriting whatever the embedding context's default is — ~16-18px; 16 matches
 * textMetrics.ts's own DEFAULT_FONT_SIZE_PX). Named/exported so containerLabelText can measure and
 * ellipsize using the exact same value this file's own width estimate assumes — the two can never
 * drift apart the way an inlined magic number in each file could.
 */
export const CONTAINER_LABEL_FONT_SIZE_PX = 16;

/**
 * The available on-screen width for a container's own label before it would run past the
 * container's own right edge — `x` reuses containerLabelText's exact start-x formula (icon inset +
 * gap, or just the inset with no icon), and the right bound mirrors that same inset for visual
 * symmetry. Shared by containerLabelText (to decide when to ellipsize what's actually drawn) and
 * containerLabelRect below (so the routing-obstacle rect matches the rendered, possibly-ellipsized
 * footprint instead of the full untruncated string) — moved here for the same reason `x` itself
 * was: the two must never drift apart, or the router would protect the wrong-sized rect.
 */
export function containerLabelMaxWidth(
  el: SceneElement & { catalogRef?: string },
): number {
  const hasIcon = Boolean(el.catalogRef);
  const startX =
    el.x +
    CONTAINER_GLYPH_INSET +
    (hasIcon ? CONTAINER_GLYPH_SIZE + CONTAINER_LABEL_GAP : 0);
  const rightBound = el.x + el.w - CONTAINER_GLYPH_INSET;
  return Math.max(0, rightBound - startX);
}

/**
 * A container's (box/group/zone) own label's on-screen footprint, for routing to prefer to avoid —
 * distinct from svgRenderer.ts's containerLabelText, which places the actual text-baseline point
 * for rendering. `x` reuses that exact same formula (moved here so the two can never drift apart —
 * an icon/no-icon misalignment between rendering and avoidance would be visually obvious). `y`/`h`
 * describe a rect spanning the same row the corner glyph occupies
 * ([el.y+CONTAINER_GLYPH_INSET, el.y+CONTAINER_GLYPH_INSET+CONTAINER_GLYPH_SIZE]), which also
 * contains the render formula's own text baseline — a defensible "at least as tall as the row the
 * label visually sits in," not an arbitrary height. `w` is measureText's estimate of the full label
 * string, clamped to containerLabelMaxWidth — matching what containerLabelText actually draws once
 * M27.3 wires ellipsis in, rather than protecting a wider rect than what's visually there (or a
 * narrower one, for a short label that fits with room to spare).
 *
 * Returns undefined when there's no label to protect (matches containerLabelText's own render-time
 * `el.label?.text` truthiness check exactly, including the empty-string case).
 */
export function containerLabelRect(
  el: SceneElement & { catalogRef?: string },
): Rect | undefined {
  if (!el.label?.text) return undefined;
  const hasIcon = Boolean(el.catalogRef);
  const x =
    el.x +
    CONTAINER_GLYPH_INSET +
    (hasIcon ? CONTAINER_GLYPH_SIZE + CONTAINER_LABEL_GAP : 0);
  const fullWidth = measureText(el.label.text, CONTAINER_LABEL_FONT_SIZE_PX);
  const w = Math.min(fullWidth, containerLabelMaxWidth(el));
  return {
    x,
    y: el.y + CONTAINER_GLYPH_INSET,
    w,
    h: CONTAINER_GLYPH_SIZE,
  };
}
