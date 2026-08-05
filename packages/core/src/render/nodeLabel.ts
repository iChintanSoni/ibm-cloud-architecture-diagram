import type { Scene } from "../scene/scene.js";
import type { SceneElement } from "../scene/types.js";

/** Used when an icon/actor label has no parent to derive available width from (e.g. detached in
 * tests, or a top-level element) — generous enough that wrapping stays rare in that fallback case. */
export const FALLBACK_LABEL_MAX_WIDTH = 200;

/**
 * The available width for an icon/actor's own caption to wrap within before it would run past
 * its parent container's edge — mirrors containerLabel.ts's containerLabelMaxWidth's "don't
 * overflow the boundary" intent, but centered rather than left-anchored, since these captions are
 * centered under/over their element (svgRenderer.ts's labelText). Falls back to a generous flat
 * width when there's no parent to derive it from (a detached element in tests, or a top-level icon
 * on the canvas itself, which has no enclosing box/zone to respect).
 *
 * Lives outside SvgRenderer (which is its only renderer) so linter/rules.ts's
 * textOverflowNeedsWrapRule (M27.7) can reuse the exact same width computation the renderer
 * itself uses — the two must never drift apart, or the lint rule would flag overflow that the
 * renderer doesn't actually produce, or vice versa.
 */
export function nodeLabelMaxWidth(el: SceneElement, scene: Scene): number {
  const parent = el.parentId ? scene.get(el.parentId) : undefined;
  if (!parent) return FALLBACK_LABEL_MAX_WIDTH;
  const centerX = el.x + el.w / 2;
  const left = centerX - parent.x;
  const right = parent.x + parent.w - centerX;
  return Math.max(0, 2 * Math.min(left, right));
}
