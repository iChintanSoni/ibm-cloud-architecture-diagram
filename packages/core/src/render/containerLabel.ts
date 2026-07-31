import type { SceneElement } from "../scene/types.js";
import type { Rect } from "../routing/orthogonalRouter.js";

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
 * Rough average glyph advance width for the ~16-18px unset-font-size a container label renders at
 * (svgRenderer.ts's containerLabelText sets no explicit font-size, inheriting whatever the
 * embedding context's default is). Not a real font metric — packages/core has none anywhere,
 * deliberately, since it must run headless under jsdom (the MCP server) with no real canvas/font
 * layout engine available. Biased slightly wide on purpose: an undersized estimate silently
 * defeats containerLabelRect's whole purpose (the route still crosses the real text), while an
 * oversized one only costs a marginally less direct detour — the two failure modes aren't
 * symmetric, so lean generous. Tunable; refine by visual inspection of a real diagram, not by
 * re-deriving this number analytically.
 */
const AVG_CHAR_WIDTH_PX = 9;

/**
 * A container's (box/group/zone) own label's approximate footprint, for routing to prefer to
 * avoid — distinct from svgRenderer.ts's containerLabelText, which places the actual text-baseline
 * point for rendering. `x` reuses that exact same formula (moved here so the two can never drift
 * apart — an icon/no-icon misalignment between rendering and avoidance would be visually obvious).
 * `y`/`h` describe a rect spanning the same row the corner glyph occupies
 * ([el.y+CONTAINER_GLYPH_INSET, el.y+CONTAINER_GLYPH_INSET+CONTAINER_GLYPH_SIZE]), which also
 * contains the render formula's own text baseline — a defensible "at least as tall as the row the
 * label visually sits in," not an arbitrary height. `w` is the heuristic estimate above.
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
  return {
    x,
    y: el.y + CONTAINER_GLYPH_INSET,
    w: AVG_CHAR_WIDTH_PX * el.label.text.length,
    h: CONTAINER_GLYPH_SIZE,
  };
}
