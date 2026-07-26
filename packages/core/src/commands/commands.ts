import { routeConnectorInScene } from "../routing/routeConnector.js";
import type { Scene } from "../scene/scene.js";
import type {
  ConformanceSettings,
  ConnectorElement,
  ElementId,
  ExportGate,
  SceneElement,
  ConformanceSeverity
} from "../scene/types.js";
import type { Command } from "./types.js";

/** Auto-routed connectors whose `from`/`to` is one of `ids` — these need rerouting after a move/resize. */
function attachedAutoConnectors(scene: Scene, ids: Set<ElementId>): ConnectorElement[] {
  return scene
    .all()
    .filter(
      (el): el is ConnectorElement =>
        el.type === "connector" &&
        el.routing !== "manual" &&
        (ids.has(el.from.elementId) || ids.has(el.to.elementId))
    );
}

function rerouteConnectors(scene: Scene, connectors: ConnectorElement[]): void {
  for (const connector of connectors) {
    const current = scene.get(connector.id) as ConnectorElement | undefined;
    if (!current) continue;
    scene._put({ ...current, waypoints: routeConnectorInScene(scene, current) } as SceneElement, "update");
  }
}

export function addElement(element: SceneElement): Command {
  return {
    label: `add ${element.type}`,
    do(scene) {
      scene._put(element, "add");
    },
    undo(scene) {
      scene._remove(element.id);
    }
  };
}

/**
 * Removes an element and, per containment membership (move-with applies
 * symmetrically to delete), every element nested under it. Also removes any
 * connector attached to a deleted element but left outside the subtree (e.g.
 * a Group's member connected to a sibling elsewhere on the canvas) — without
 * this, the connector survives with an endpoint that no longer resolves,
 * which the `.icad` repair pass only cleans up on next load, not live in the
 * editor (docs/03-file-format.md#versioning--migration). Undo restores
 * everything, parents before children so intermediate parentId lookups stay
 * valid throughout.
 */
export function removeElement(scene: Scene, id: ElementId): Command {
  const root = scene.get(id);
  const subtree = root ? [root, ...scene.descendantsOf(id)] : [];
  const subtreeIds = new Set(subtree.map((el) => el.id));
  const danglingConnectors = scene
    .all()
    .filter(
      (el): el is ConnectorElement =>
        el.type === "connector" &&
        !subtreeIds.has(el.id) &&
        (subtreeIds.has(el.from.elementId) || subtreeIds.has(el.to.elementId))
    );
  const removed = [...subtree, ...danglingConnectors];
  return {
    label: "remove element",
    do(s) {
      for (const el of removed) s._remove(el.id);
    },
    undo(s) {
      for (const el of removed) s._put(el, "add");
    }
  };
}

const GEOMETRY_FIELDS = ["x", "y", "w", "h"] as const;

export function updateElement(scene: Scene, id: ElementId, patch: Partial<SceneElement>): Command {
  const previous = scene.get(id);
  const geometryChanged = GEOMETRY_FIELDS.some((k) => k in patch);
  const affectedConnectors = geometryChanged ? attachedAutoConnectors(scene, new Set([id])) : [];
  return {
    label: "update element",
    do(s) {
      const current = s.get(id);
      if (!current) return;
      const next = {
        ...current,
        ...patch,
        ...("style" in patch && patch.style
          ? { style: { ...(current.style ?? {}), ...patch.style } }
          : {})
      } as SceneElement;
      s._put(next, "update");
      rerouteConnectors(s, affectedConnectors);
    },
    undo(s) {
      if (previous) s._put(previous, "update");
      for (const connector of affectedConnectors) s._put(connector, "update");
    }
  };
}

/**
 * Moves the given elements by a delta, cascading to every element nested
 * inside them (move-with, docs/02-architecture.md#scene-model) so dragging a
 * container carries its contents along. Descendants shared by more than one
 * selected id are only moved once.
 */
export function moveElements(scene: Scene, ids: ElementId[], dx: number, dy: number): Command {
  const allIds = new Set(ids);
  for (const id of ids) {
    for (const descendant of scene.descendantsOf(id)) allIds.add(descendant.id);
  }
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  const affectedConnectors = attachedAutoConnectors(scene, allIds);
  return {
    label: "move elements",
    do(s) {
      for (const id of allIds) {
        const el = s.get(id);
        if (el) s._put({ ...el, x: el.x + dx, y: el.y + dy } as SceneElement, "update");
      }
      rerouteConnectors(s, affectedConnectors);
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
      for (const connector of affectedConnectors) s._put(connector, "update");
    }
  };
}

/**
 * Changes an element's container membership. Reparenting to `undefined`
 * lifts it to the top level. Throws on a cycle (assigning an element as its
 * own descendant's child), which would hang move-with/cascading-delete.
 *
 * Reports its `_put` as reason "update": today every caller (`groupElements`, `ungroupElement`)
 * batches it alongside an "add"/"remove", which coalesces the dispatch's reason to "replace" and
 * forces a full render (`Scene._transaction`, `createEditor.ts`'s `scene.on()` subscription) — a
 * reparent changes both the old and new parent's `aria-owns` list, which the "update"-reason fast
 * render path does not repaint. A future gesture that dispatches this alone (e.g. drag-to-reparent)
 * would need to account for that, not rely on this reason as-is.
 */
export function reparentElement(scene: Scene, id: ElementId, parentId: ElementId | undefined): Command {
  const previous = scene.get(id);
  if (!previous) throw new Error(`Cannot reparent unknown element "${id}"`);
  if (parentId !== undefined && scene.isSelfOrDescendant(id, parentId)) {
    throw new Error(`Cannot reparent "${id}" into its own descendant "${parentId}"`);
  }
  const next = { ...previous, parentId } as SceneElement;
  if (parentId === undefined) delete next.parentId;
  return {
    label: "reparent element",
    do(s) {
      s._put(next, "update");
    },
    undo(s) {
      s._put(previous, "update");
    }
  };
}

function requireConnector(scene: Scene, id: ElementId): ConnectorElement {
  const el = scene.get(id);
  if (!el || el.type !== "connector") throw new Error(`Not a connector: "${id}"`);
  return el;
}

/**
 * Overrides a connector's route with explicit waypoints and switches it to
 * "manual" routing, so future moves/resizes of its endpoints no longer
 * recompute the path (D13's "manual override" escape hatch).
 */
export function setManualWaypoints(
  scene: Scene,
  id: ElementId,
  waypoints: Array<{ x: number; y: number }>
): Command {
  const previous = requireConnector(scene, id);
  const next: ConnectorElement = { ...previous, waypoints, routing: "manual" };
  return {
    label: "set connector waypoints",
    do(s) {
      s._put(next, "update");
    },
    undo(s) {
      s._put(previous, "update");
    }
  };
}

/** Switches a connector back to "auto" routing and recomputes its path immediately. */
export function autoRouteConnector(scene: Scene, id: ElementId): Command {
  const previous = requireConnector(scene, id);
  return {
    label: "auto-route connector",
    do(s) {
      const current = requireConnector(s, id);
      s._put(
        { ...current, routing: "auto", waypoints: routeConnectorInScene(s, { ...current, routing: "auto" }) },
        "update"
      );
    },
    undo(s) {
      s._put(previous, "update");
    }
  };
}

/** Composes multiple commands into one undo/redo step (e.g. quick-fixes). */
export function batch(label: string, commands: Command[]): Command {
  return {
    label,
    do(scene) {
      for (const c of commands) c.do(scene);
    },
    undo(scene) {
      for (let i = commands.length - 1; i >= 0; i -= 1) commands[i]!.undo(scene);
    }
  };
}

/** Updates document-level conformance settings as one undoable command. */
export function updateConformance(
  scene: Scene,
  patch: {
    exportGate?: ExportGate;
    ruleSeverity?: { ruleId: string; severity?: ConformanceSeverity };
  }
): Command {
  const previous: ConformanceSettings = {
    exportGate: scene.conformance.exportGate,
    ruleSeverities: { ...scene.conformance.ruleSeverities }
  };
  const next: ConformanceSettings = {
    exportGate: patch.exportGate ?? previous.exportGate,
    ruleSeverities: { ...previous.ruleSeverities }
  };
  if (patch.ruleSeverity) {
    if (patch.ruleSeverity.severity === undefined) delete next.ruleSeverities[patch.ruleSeverity.ruleId];
    else next.ruleSeverities[patch.ruleSeverity.ruleId] = patch.ruleSeverity.severity;
  }
  return {
    label: "update conformance settings",
    do(s) {
      s._setConformance(next);
    },
    undo(s) {
      s._setConformance(previous);
    }
  };
}
