import { boundsOf } from "./bounds.js";
import type { Scene } from "./scene.js";
import type { ElementId } from "./types.js";

/** The six alignment edges/axes (M18.2, docs/10-canvas-parity-plan.md) — "centerH"/"middle" match
 * PowerPoint's split naming (horizontal centering vs. vertical centering) rather than reusing
 * "center" for both. */
export type AlignMode =
  "left" | "centerH" | "right" | "top" | "middle" | "bottom";

export interface AlignMove {
  id: ElementId;
  dx: number;
  dy: number;
}

/**
 * Computes the per-element move needed to align `ids` along `mode`, relative to the bounding box
 * of the selection as a whole (the Figma/Illustrator/PowerPoint convention) — never a designated
 * anchor element. Connectors are excluded: a `ConnectorElement`'s `x`/`y`/`w`/`h` is a degenerate
 * 0x0 rect (`bounds.ts`), its visual path coming from `waypoints` derived from the elements it
 * connects (`from`/`to` ports) plus routing — there's no independent position to align it *to* or
 * move it *by*, so one present in `ids` is silently dropped rather than treated as alignable.
 *
 * Returns one move per alignable element whose position actually changes — an element already on
 * the requested edge/axis is omitted, mirroring the z-order commands' own skip-unchanged
 * convention. Fewer than two alignable elements (nothing to align relative to) returns `[]`.
 */
export function computeAlignMoves(
  scene: Scene,
  ids: ElementId[],
  mode: AlignMode,
): AlignMove[] {
  const alignable = [...new Set(ids)].filter((id) => {
    const el = scene.get(id);
    return el !== undefined && el.type !== "connector";
  });
  if (alignable.length < 2) return [];

  const overall = boundsOf(scene, alignable);
  if (!overall) return [];

  const moves: AlignMove[] = [];
  for (const id of alignable) {
    const box = boundsOf(scene, [id]);
    if (!box) continue;
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case "left":
        dx = overall.x - box.x;
        break;
      case "right":
        dx = overall.x + overall.w - (box.x + box.w);
        break;
      case "centerH":
        dx = overall.x + overall.w / 2 - (box.x + box.w / 2);
        break;
      case "top":
        dy = overall.y - box.y;
        break;
      case "bottom":
        dy = overall.y + overall.h - (box.y + box.h);
        break;
      case "middle":
        dy = overall.y + overall.h / 2 - (box.y + box.h / 2);
        break;
    }
    if (dx !== 0 || dy !== 0) moves.push({ id, dx, dy });
  }
  return moves;
}
