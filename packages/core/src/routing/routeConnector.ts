import type { Scene } from "../scene/scene.js";
import type { ConnectorElement } from "../scene/types.js";
import { portPoint, type Point } from "../render/port.js";
import { routeOrthogonal, type Rect } from "./orthogonalRouter.js";

/**
 * Obstacles the router avoids: leaf shapes only. Containers (box/group/zone/
 * frame) are excluded deliberately — IBM deployment diagrams routinely draw
 * a connector crossing a box or zone boundary, so treating those as
 * obstacles would make most real diagrams unroutable cleanly.
 */
function obstaclesFor(scene: Scene, excludeIds: Set<string>): Rect[] {
  return scene
    .all()
    .filter(
      (el) => (el.type === "iconNode" || el.type === "actor" || el.type === "text") && !excludeIds.has(el.id)
    )
    .map((el) => ({ x: el.x, y: el.y, w: el.w, h: el.h }));
}

/**
 * Computes an obstacle-avoiding orthogonal route between a connector's two
 * ports and returns it as inner waypoints (endpoints are re-derived from the
 * live port positions at render time, so they aren't included here).
 */
export function routeConnectorInScene(scene: Scene, connector: ConnectorElement): Point[] {
  const fromEl = scene.get(connector.from.elementId);
  const toEl = scene.get(connector.to.elementId);
  if (!fromEl || !toEl) return connector.waypoints ?? [];

  const obstacles = obstaclesFor(scene, new Set([fromEl.id, toEl.id]));
  const path = routeOrthogonal(
    { point: portPoint(fromEl, connector.from.port), side: connector.from.port },
    { point: portPoint(toEl, connector.to.port), side: connector.to.port },
    obstacles
  );
  return path.slice(1, -1);
}

/** Full rendered path (endpoints + waypoints) used by both the renderer and the linter. */
export function connectorPathPoints(scene: Scene, connector: ConnectorElement): Point[] {
  const fromEl = scene.get(connector.from.elementId);
  const toEl = scene.get(connector.to.elementId);
  const start = fromEl ? portPoint(fromEl, connector.from.port) : { x: connector.x, y: connector.y };
  const end = toEl ? portPoint(toEl, connector.to.port) : { x: connector.x + connector.w, y: connector.y + connector.h };
  return [start, ...(connector.waypoints ?? []), end];
}

export { obstaclesFor };
