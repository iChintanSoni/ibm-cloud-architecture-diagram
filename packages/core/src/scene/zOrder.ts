import type { Scene } from "./scene.js";
import type { ElementId, SceneElement } from "./types.js";

/** Reorders one sibling bracket (elements sharing a parent, already in z-order) given which of
 * them are selected. Used by z-order commands (packages/core/docs/canvas-parity-plan.md M18). */
export type SiblingReorder = (
  bracket: ElementId[],
  selected: Set<ElementId>,
) => ElementId[];

/** Selected elements move to the very front (highest z) of their sibling bracket, preserving
 * relative order within each partition. */
export const bringToFront: SiblingReorder = (bracket, selected) => [
  ...bracket.filter((id) => !selected.has(id)),
  ...bracket.filter((id) => selected.has(id)),
];

/** Selected elements move to the very back (lowest z) of their sibling bracket. */
export const sendToBack: SiblingReorder = (bracket, selected) => [
  ...bracket.filter((id) => selected.has(id)),
  ...bracket.filter((id) => !selected.has(id)),
];

/**
 * Each selected element steps one position toward the front, swapping with its immediate
 * unselected successor. Scans right-to-left so a just-swapped selected element is never
 * re-examined in the same pass — two adjacent selected elements each move forward by exactly one
 * without leapfrogging each other. An element already at the front, or blocked by another
 * selected element immediately ahead of it, is left in place with no special-casing: the swap
 * condition simply never triggers for it.
 */
export const bringForward: SiblingReorder = (bracket, selected) => {
  const order = [...bracket];
  for (let i = order.length - 2; i >= 0; i -= 1) {
    if (selected.has(order[i]!) && !selected.has(order[i + 1]!)) {
      [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
    }
  }
  return order;
};

/** Mirror of `bringForward`: each selected element steps one position toward the back. */
export const sendBackward: SiblingReorder = (bracket, selected) => {
  const order = [...bracket];
  for (let i = 1; i < order.length; i += 1) {
    if (selected.has(order[i]!) && !selected.has(order[i - 1]!)) {
      [order[i - 1], order[i]] = [order[i]!, order[i - 1]!];
    }
  }
  return order;
};

/** True if `element`'s parent chain loops back on itself before reaching a root. */
function hasCyclicParent(
  element: SceneElement,
  byId: Map<ElementId, SceneElement>,
): boolean {
  const visited = new Set([element.id]);
  let parentId = element.parentId;
  while (parentId) {
    if (visited.has(parentId)) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

/**
 * Pre-order DFS of the containment tree, siblings in current z-order (or `overrides`'s order for
 * a given parent bracket) — the only element ordering that's safe for `SvgRenderer`'s flat,
 * non-nested paint model (`render()`/`syncDomOrder()`, packages/core/docs/canvas-parity-plan.md M18): every
 * container is immediately followed by its whole subtree, so no z-order command can ever push a
 * container's paint order past its own descendants' — a bare per-bracket renumbering scheme
 * can't guarantee that, since a bracket's own index range can land between an unrelated
 * container's z and that container's descendants. `overrides` lets a caller substitute a
 * specific bracket's order (e.g. after a bring-to-front) before the whole document is renumbered
 * around it.
 *
 * Root/cycle handling mirrors `buildLayerTree` (packages/ui-web/src/inspectorModel.ts): an
 * element with a missing, self-referencing, or cyclic parent is treated as a root rather than
 * dropped, so a corrupt `parentId` can never make an element vanish from the paint order.
 */
export function paintOrder(
  scene: Scene,
  overrides?: Map<ElementId | undefined, ElementId[]>,
): ElementId[] {
  const elements = scene.all();
  const byId = new Map(elements.map((el) => [el.id, el]));

  const siblingsOf = (parentId: ElementId | undefined): ElementId[] => {
    const override = overrides?.get(parentId);
    if (override) return override;
    return elements.filter((el) => el.parentId === parentId).map((el) => el.id);
  };

  const isBrokenRoot = (el: SceneElement): boolean =>
    el.parentId !== undefined &&
    (!byId.has(el.parentId) ||
      el.parentId === el.id ||
      hasCyclicParent(el, byId));

  const roots = [
    ...siblingsOf(undefined),
    ...elements.filter(isBrokenRoot).map((el) => el.id),
  ];

  const visited = new Set<ElementId>();
  const out: ElementId[] = [];
  function visit(id: ElementId): void {
    if (visited.has(id)) return;
    visited.add(id);
    out.push(id);
    for (const childId of siblingsOf(id)) visit(childId);
  }
  for (const id of roots) visit(id);

  // Defensive, shouldn't trigger given the root test above: append anything unreached in its
  // current z order rather than silently dropping it from the document's paint order.
  for (const el of elements) visit(el.id);

  return out;
}
