import type { Catalog } from "../catalog/catalog.js";
import type { Scene } from "./scene.js";
import type { SceneElement } from "./types.js";

export type AccessibleRole = "group" | "button";

const CONTAINER_TYPE_LABEL: Record<string, string> = {
  box: "Box",
  group: "Group",
  zone: "Boundary",
  frame: "Frame",
};

/**
 * "group" for containers (screen readers announce them as regions holding other
 * elements), "button" for everything selectable/activatable via Enter/Space
 * (packages/core/docs/accessibility.md#canvas-the-hard-20).
 */
export function accessibleRole(element: SceneElement): AccessibleRole {
  return element.type === "box" ||
    element.type === "group" ||
    element.type === "zone" ||
    element.type === "frame"
    ? "group"
    : "button";
}

function elementName(element: SceneElement, catalog: Catalog): string {
  if (element.type === "text") return element.text.trim() || "Untitled text";
  if (element.type === "frame") return element.name.trim() || "Untitled frame";
  if (element.label?.text.trim()) return element.label.text.trim();
  if ("catalogRef" in element && element.catalogRef) {
    const meta = catalog.resolve(element.catalogRef);
    if (meta) return meta.name;
  }
  return `Untitled ${element.type}`;
}

/**
 * Screen-reader accessible name for a scene element
 * (packages/core/docs/accessibility.md#canvas-the-hard-20). Containers mention their
 * child count; connectors describe both endpoints and the connection/
 * relationship type instead of just geometry. Locked/hidden state is appended
 * so assistive technology can announce it (M18.4).
 */
export function accessibleName(
  element: SceneElement,
  scene: Scene,
  catalog: Catalog,
): string {
  const stateSuffix =
    element.locked && element.hidden
      ? ", locked, hidden"
      : element.locked
        ? ", locked"
        : element.hidden
          ? ", hidden"
          : "";

  if (element.type === "connector") {
    const from = scene.get(element.from.elementId);
    const to = scene.get(element.to.elementId);
    const fromName = from ? elementName(from, catalog) : "unknown element";
    const toName = to ? elementName(to, catalog) : "unknown element";
    return `Connector: ${fromName} to ${toName} (${element.connectorType})${stateSuffix}`;
  }

  const name = elementName(element, catalog);
  const containerLabel = CONTAINER_TYPE_LABEL[element.type];
  if (containerLabel) {
    const childCount = scene.childrenOf(element.id).length;
    const countLabel =
      childCount === 1 ? "1 element" : `${childCount} elements`;
    return `${containerLabel}: ${name}, contains ${countLabel}${stateSuffix}`;
  }

  return `${name}${stateSuffix}`;
}
