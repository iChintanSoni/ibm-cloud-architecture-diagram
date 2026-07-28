import { isContainer, type SceneElement } from "@icad/core";

export interface LayerNode {
  element: SceneElement;
  children: LayerNode[];
}

function hasCyclicParent(
  element: SceneElement,
  byId: Map<string, SceneElement>,
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
 * Projects flat scene membership into the hierarchy shown by the Layers tab.
 *
 * Children are stored in **descending** z-order (highest z first) so the
 * topmost row in the panel is the frontmost element — matching Figma,
 * Illustrator, and PowerPoint's own layer panel conventions (M18.5,
 * docs/10-canvas-parity-plan.md).  The input `elements` array from
 * `Scene.all()` is already ascending-z sorted, so we simply reverse each
 * sibling list after building the tree.
 */
export function buildLayerTree(elements: SceneElement[]): LayerNode[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const nodes = new Map<string, LayerNode>(
    elements.map((element) => [element.id, { element, children: [] }]),
  );
  const roots: LayerNode[] = [];

  for (const element of elements) {
    const node = nodes.get(element.id)!;
    const parent = element.parentId ? nodes.get(element.parentId) : undefined;
    if (
      !parent ||
      element.parentId === element.id ||
      hasCyclicParent(element, byId)
    ) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  // Reverse each sibling list so frontmost (highest z) is at the top.
  roots.reverse();
  for (const node of nodes.values()) {
    node.children.reverse();
  }

  return roots;
}

export function elementDisplayName(element: SceneElement): string {
  if (element.type === "text") return element.text.trim() || "Untitled text";
  if (element.type === "frame") return element.name.trim() || "Untitled frame";
  if (element.label?.text.trim()) return element.label.text.trim();
  if ("catalogRef" in element && element.catalogRef)
    return element.catalogRef.split("/").at(-1) ?? element.catalogRef;
  return `Untitled ${element.type}`;
}

/** Valid container choices, excluding the selected element and its descendants. */
export function eligibleParentElements(
  elements: SceneElement[],
  selectedId: string,
): SceneElement[] {
  const children = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const ids = children.get(element.parentId) ?? [];
    ids.push(element.id);
    children.set(element.parentId, ids);
  }

  const excluded = new Set([selectedId]);
  const queue = [...(children.get(selectedId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (excluded.has(id)) continue;
    excluded.add(id);
    queue.push(...(children.get(id) ?? []));
  }

  return elements.filter(
    (element) => isContainer(element) && !excluded.has(element.id),
  );
}
