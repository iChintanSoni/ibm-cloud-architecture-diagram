import type { Scene } from "../scene/scene.js";
import type { ConnectorElement, SceneElement } from "../scene/types.js";

function byPosition(a: SceneElement, b: SceneElement): number {
  return a.x - b.x || a.y - b.y;
}

function visit(scene: Scene, element: SceneElement, out: SceneElement[]): void {
  out.push(element);
  const children = scene
    .childrenOf(element.id)
    .filter((child) => child.type !== "connector")
    .sort(byPosition);
  for (const child of children) visit(scene, child, out);
}

function connectorPosition(scene: Scene, connector: ConnectorElement): number {
  return scene.get(connector.from.elementId)?.x ?? 0;
}

/**
 * Meaningful keyboard tab order (docs/07-accessibility.md#canvas-the-hard-20):
 * containers before their children, siblings ordered west-to-east (per
 * docs/05-ibm-spec-conformance.md#layout-convention); connectors last,
 * ordered by their source element's position since they don't nest.
 */
export function computeTabOrder(scene: Scene): SceneElement[] {
  const roots = scene.all().filter((el) => el.type !== "connector" && !el.parentId);
  roots.sort(byPosition);

  const out: SceneElement[] = [];
  for (const root of roots) visit(scene, root, out);

  const connectors = scene
    .all()
    .filter((el): el is ConnectorElement => el.type === "connector")
    .sort((a, b) => connectorPosition(scene, a) - connectorPosition(scene, b));

  return [...out, ...connectors];
}
