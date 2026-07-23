import { autoRouteConnector, updateElement } from "../commands/commands.js";
import { pathCrossesObstacles } from "../routing/orthogonalRouter.js";
import { connectorPathPoints, obstaclesFor } from "../routing/routeConnector.js";
import type { Scene } from "../scene/scene.js";
import type { Diagnostic, Rule } from "./types.js";

const LABELED_TYPES = new Set(["box", "group", "zone", "actor"]);

/** Boxes/groups/zones/actors should carry a label per docs/05-ibm-spec-conformance.md. */
export const missingLabelRule: Rule = (scene: Scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (!LABELED_TYPES.has(el.type)) continue;
    if (el.label?.text) continue;
    diagnostics.push({
      id: `missing-label:${el.id}`,
      ruleId: "missing-label",
      severity: "warn",
      elementId: el.id,
      message: `"${el.id}" (${el.type}) is missing a label.`,
      quickFix: updateElement(scene, el.id, { label: { text: "Untitled" } })
    });
  }
  return diagnostics;
};

/** Connectors whose endpoint element no longer exists. */
export const danglingConnectorRule: Rule = (scene: Scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector") continue;
    const missing = !scene.has(el.from.elementId) || !scene.has(el.to.elementId);
    if (missing) {
      diagnostics.push({
        id: `dangling-connector:${el.id}`,
        ruleId: "dangling-connector",
        severity: "error",
        elementId: el.id,
        message: `Connector "${el.id}" has an endpoint that no longer exists.`
      });
    }
  }
  return diagnostics;
};

/**
 * Connectors whose current route crosses a leaf shape (icon/actor/text) it
 * isn't attached to — a clean obstacle-avoiding route exists, so re-routing
 * (docs/05-ibm-spec-conformance.md#the-linter, "Crossing/overlapping
 * routes") is offered as a quick-fix regardless of the connector's current
 * routing mode.
 */
export const connectorCrossesObstacleRule: Rule = (scene: Scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector") continue;
    if (!scene.has(el.from.elementId) || !scene.has(el.to.elementId)) continue;

    const points = connectorPathPoints(scene, el);
    const obstacles = obstaclesFor(scene, new Set([el.from.elementId, el.to.elementId]));
    if (!pathCrossesObstacles(points, obstacles)) continue;

    diagnostics.push({
      id: `connector-crosses-obstacle:${el.id}`,
      ruleId: "connector-crosses-obstacle",
      severity: "warn",
      elementId: el.id,
      message: `Connector "${el.id}" crosses another shape; a clean orthogonal route is available.`,
      quickFix: autoRouteConnector(scene, el.id)
    });
  }
  return diagnostics;
};

/**
 * A `deployedTo` Group models services grouped onto a `deployedOn` Box
 * (docs/05-ibm-spec-conformance.md#element-semantics: "a VSI is deployedOn a
 * subnet and deployedTo a security group" — the security-group Group nests
 * inside the subnet Box). A Group with no Box ancestor is missing that
 * location context. No quick-fix: we can't guess which Box was intended.
 */
export const groupWithoutBoxAncestorRule: Rule = (scene: Scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "group") continue;
    const hasBoxAncestor = scene.ancestorsOf(el.id).some((ancestor) => ancestor.type === "box");
    if (hasBoxAncestor) continue;
    diagnostics.push({
      id: `group-without-box:${el.id}`,
      ruleId: "group-without-box",
      severity: "warn",
      elementId: el.id,
      message: `"${el.id}" (deployedTo group) isn't nested inside a deployedOn box.`
    });
  }
  return diagnostics;
};

export const defaultRules: Rule[] = [
  missingLabelRule,
  danglingConnectorRule,
  connectorCrossesObstacleRule,
  groupWithoutBoxAncestorRule
];
