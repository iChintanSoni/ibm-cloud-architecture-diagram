import { routeConnectorInScene } from "../routing/routeConnector.js";
import type { AlignMove } from "../scene/align.js";
import type { DistributeMove } from "../scene/distribute.js";
import { autoFitContainer } from "../scene/bounds.js";
import type { Scene } from "../scene/scene.js";
import type {
  ConformanceSettings,
  ConnectorElement,
  ElementId,
  ExportGate,
  SceneElement,
  ConformanceSeverity,
} from "../scene/types.js";
import { paintOrder } from "../scene/zOrder.js";
import type { Command } from "./types.js";

/** Auto-routed connectors whose `from`/`to` is one of `ids` — these need rerouting after a move/resize. */
function attachedAutoConnectors(
  scene: Scene,
  ids: Set<ElementId>,
): ConnectorElement[] {
  return scene
    .all()
    .filter(
      (el): el is ConnectorElement =>
        el.type === "connector" &&
        el.routing !== "manual" &&
        (ids.has(el.from.elementId) || ids.has(el.to.elementId)),
    );
}

function rerouteConnectors(scene: Scene, connectors: ConnectorElement[]): void {
  for (const connector of connectors) {
    const current = scene.get(connector.id) as ConnectorElement | undefined;
    if (!current) continue;
    scene._put(
      {
        ...current,
        waypoints: routeConnectorInScene(scene, current),
      } as SceneElement,
      "update",
    );
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
    },
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
        (subtreeIds.has(el.from.elementId) || subtreeIds.has(el.to.elementId)),
    );
  const removed = [...subtree, ...danglingConnectors];
  return {
    label: "remove element",
    do(s) {
      for (const el of removed) s._remove(el.id);
    },
    undo(s) {
      for (const el of removed) s._put(el, "add");
    },
  };
}

const GEOMETRY_FIELDS = ["x", "y", "w", "h"] as const;

export function updateElement(
  scene: Scene,
  id: ElementId,
  patch: Partial<SceneElement>,
): Command {
  const previous = scene.get(id);
  const geometryChanged = GEOMETRY_FIELDS.some((k) => k in patch);
  const affectedConnectors = geometryChanged
    ? attachedAutoConnectors(scene, new Set([id]))
    : [];
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
          : {}),
      } as SceneElement;
      s._put(next, "update");
      rerouteConnectors(s, affectedConnectors);
    },
    undo(s) {
      if (previous) s._put(previous, "update");
      for (const connector of affectedConnectors) s._put(connector, "update");
    },
  };
}

/**
 * Moves the given elements by a delta, cascading to every element nested
 * inside them (move-with, docs/02-architecture.md#scene-model) so dragging a
 * container carries its contents along. Descendants shared by more than one
 * selected id are only moved once.
 */
export function moveElements(
  scene: Scene,
  ids: ElementId[],
  dx: number,
  dy: number,
): Command {
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
        if (el)
          s._put(
            { ...el, x: el.x + dx, y: el.y + dy } as SceneElement,
            "update",
          );
      }
      rerouteConnectors(s, affectedConnectors);
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
      for (const connector of affectedConnectors) s._put(connector, "update");
    },
  };
}

/**
 * Grows `containerId` to fit its current children plus the 16px buffer, never shrinking it (M17.4,
 * docs/10-canvas-parity-plan.md) — the counterpart to `moveElements` no longer clamping a dragged
 * child to its parent's inset (`snapping.ts`'s `snapMove`): instead of stopping the child at a
 * wall mid-gesture, the parent grows to fit once the move actually commits. Meant to be batched
 * immediately after a `moveElements` targeting (some of) this container's own children — `do()`
 * calls `autoFitContainer` fresh against the *current* scene rather than a value computed at
 * construction time, so within a `batch()` (which runs each sub-command's `do()` in sequence) it
 * naturally sees the move already applied. A no-op (no `_put`, no ids in the resulting change
 * event) when the container already comfortably contains its children.
 */
export function autoGrowContainer(
  scene: Scene,
  containerId: ElementId,
  padding = 16,
): Command {
  const previous = scene.get(containerId);
  return {
    label: "auto-grow container",
    do(s) {
      const current = s.get(containerId);
      const fitted = autoFitContainer(s, containerId, padding);
      if (!current || !fitted) return;
      if (
        fitted.x === current.x &&
        fitted.y === current.y &&
        fitted.w === current.w &&
        fitted.h === current.h
      )
        return;
      s._put({ ...current, ...fitted } as SceneElement, "update");
    },
    undo(s) {
      if (previous) s._put(previous, "update");
    },
  };
}

/**
 * Changes an element's container membership. Reparenting to `undefined`
 * lifts it to the top level. Throws on a cycle (assigning an element as its
 * own descendant's child), which would hang move-with/cascading-delete.
 *
 * Reports its `_put` as reason **"replace"**, not "update" (a real bug, found and fixed building
 * M17.6, docs/10-canvas-parity-plan.md): a reparent changes the *old* parent's `aria-owns` list and
 * child count too, not just the moved element's own `parentId` — but the old parent's own scene
 * object is never itself `_put`, so `createEditor.ts`'s "update"-reason fast path
 * (`SvgRenderer.renderElements(event.ids)`, scoped to only the ids a `Scene._transaction` actually
 * touched) never repaints it, leaving its `aria-owns` stale (still claiming a child that has since
 * left) — confirmed live: the accessibility tree kept showing a reparented element nested under
 * its *previous* parent. `groupElements`/`ungroupElement` never surfaced this because they always
 * batch a reparent alongside a genuine "add"/"remove", which already coalesced the whole batch's
 * reason away from "update" (`Scene._transaction`'s `batchedReasons.size > 1` rule); M17.6's own
 * move+reparent+auto-grow batch is the first caller where every *other* sub-command also reports
 * "update", so reparenting had to stop pretending to be one — "replace" (already the batch
 * coalescing's own "mixed/structural change" fallback) forces the full `render()` path
 * unconditionally, which re-derives every element's `aria-owns`, "contains N elements" accessible
 * name, and alternating fill depth in one pass, not just the moved element's own.
 *
 * `do()` also reads the element's *current* state fresh (mirroring `updateElement`'s own pattern)
 * rather than reusing a `previous` snapshot captured at construction time — a second real bug the
 * same M17.6 batch surfaced: constructing `next` from a stale construction-time snapshot would
 * silently clobber a position change `moveElements` already applied earlier in the same batch.
 */
export function reparentElement(
  scene: Scene,
  id: ElementId,
  parentId: ElementId | undefined,
): Command {
  const previous = scene.get(id);
  if (!previous) throw new Error(`Cannot reparent unknown element "${id}"`);
  if (parentId !== undefined && scene.isSelfOrDescendant(id, parentId)) {
    throw new Error(
      `Cannot reparent "${id}" into its own descendant "${parentId}"`,
    );
  }
  return {
    label: "reparent element",
    do(s) {
      const current = s.get(id);
      if (!current) return;
      const next = { ...current, parentId } as SceneElement;
      if (parentId === undefined) delete next.parentId;
      s._put(next, "replace");
    },
    undo(s) {
      s._put(previous, "replace");
    },
  };
}

/**
 * Renumbers the whole document's `z` to `paintOrder(scene, overrides)`, one undo step —
 * bring-to-front/send-to-back/step commands always renumber the whole document, not just the
 * elements that moved, since `paintOrder`'s pre-order-DFS invariant (every container immediately
 * followed by its whole subtree) is a property of the *entire* z assignment, not any one sibling
 * bracket in isolation (docs/10-canvas-parity-plan.md M18). Skips `_put` for any id already at
 * its target index, mirroring `reorderFrames`'s own "skip unchanged" pattern.
 *
 * `do()` recomputes `paintOrder` fresh against the *current* scene rather than a value captured
 * at construction time — the same reason `autoGrowContainer` (above) reads `autoFitContainer`
 * fresh: composed into a `batch()` after other structural changes (e.g. `groupElements`'s reparents
 * into a not-yet-existing group), a construction-time snapshot would still reflect the pre-batch
 * scene. `overrides` themselves are plain id lists, not z-dependent, so they stay valid regardless
 * of when `do()` actually runs.
 *
 * Reports its `_put`s as reason **"replace"**, not "update" — the same reason, and for the same
 * cause, as `reparentElement` above: a z-order change is exactly the kind of change
 * `SvgRenderer.renderElements()` (the "update"-reason fast path) explicitly does not handle,
 * since it never reorders DOM nodes — only the full `render()` path (reached via a non-"update"
 * reason) calls `syncDomOrder()`.
 */
export function setZOrder(
  scene: Scene,
  overrides: Map<ElementId | undefined, ElementId[]> | undefined,
  label: string,
): Command {
  const previous = new Map(scene.all().map((el) => [el.id, el.z]));
  return {
    label,
    do(s) {
      paintOrder(s, overrides).forEach((id, index) => {
        const current = s.get(id);
        if (!current || current.z === index) return;
        s._put({ ...current, z: index } as SceneElement, "replace");
      });
    },
    undo(s) {
      for (const [id, z] of previous) {
        const current = s.get(id);
        if (!current || current.z === z) continue;
        const next = { ...current } as SceneElement;
        if (z === undefined) delete next.z;
        else next.z = z;
        s._put(next, "replace");
      }
    },
  };
}

/**
 * Applies every `AlignMove` (computed by `computeAlignMoves`, `scene/align.ts`) as one undo step —
 * one whole-operation command, not `batch()` of N `moveElements` calls, the same reasoning
 * `setZOrder` gives above: each aligned element can move by a *different* delta, unlike
 * `moveElements`'s single shared `dx`/`dy`, so the cascade-to-descendants and shared-descendant
 * dedup that `moveElements` does for one delta has to be redone here per-id.
 *
 * Walks `moves` building one `Map<ElementId, delta>`: each id's own delta is recorded first, then
 * the same delta cascades to `scene.descendantsOf(id)` (move-with, matching `moveElements`) —
 * both skipped if already present, so a descendant reachable from more than one aligned id (or an
 * id that is itself both a direct align target and another's descendant) only ever moves once,
 * first-write-wins by `moves`' own order.
 */
export function alignElements(
  scene: Scene,
  moves: AlignMove[],
  label: string,
): Command {
  const deltas = new Map<ElementId, { dx: number; dy: number }>();
  for (const { id, dx, dy } of moves) {
    if (!deltas.has(id)) deltas.set(id, { dx, dy });
    for (const descendant of scene.descendantsOf(id)) {
      if (!deltas.has(descendant.id)) deltas.set(descendant.id, { dx, dy });
    }
  }
  const allIds = new Set(deltas.keys());
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  const affectedConnectors = attachedAutoConnectors(scene, allIds);
  return {
    label,
    do(s) {
      for (const [id, { dx, dy }] of deltas) {
        const el = s.get(id);
        if (el)
          s._put(
            { ...el, x: el.x + dx, y: el.y + dy } as SceneElement,
            "update",
          );
      }
      rerouteConnectors(s, affectedConnectors);
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
      for (const connector of affectedConnectors) s._put(connector, "update");
    },
  };
}

/**
 * Applies every `DistributeMove` (computed by `computeDistributeMoves`,
 * `scene/distribute.ts`) as one undo step — the same shape as `alignElements`
 * above. Each redistributed element can move by a *different* delta, so
 * cascade-to-descendants and shared-descendant dedup are rebuilt per-id, the
 * same way `alignElements` does rather than using a single-delta `moveElements`.
 */
export function distributeElements(
  scene: Scene,
  moves: DistributeMove[],
  label: string,
): Command {
  const deltas = new Map<ElementId, { dx: number; dy: number }>();
  for (const { id, dx, dy } of moves) {
    if (!deltas.has(id)) deltas.set(id, { dx, dy });
    for (const descendant of scene.descendantsOf(id)) {
      if (!deltas.has(descendant.id)) deltas.set(descendant.id, { dx, dy });
    }
  }
  const allIds = new Set(deltas.keys());
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  const affectedConnectors = attachedAutoConnectors(scene, allIds);
  return {
    label,
    do(s) {
      for (const [id, { dx, dy }] of deltas) {
        const el = s.get(id);
        if (el)
          s._put(
            { ...el, x: el.x + dx, y: el.y + dy } as SceneElement,
            "update",
          );
      }
      rerouteConnectors(s, affectedConnectors);
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
      for (const connector of affectedConnectors) s._put(connector, "update");
    },
  };
}

function requireConnector(scene: Scene, id: ElementId): ConnectorElement {
  const el = scene.get(id);
  if (!el || el.type !== "connector")
    throw new Error(`Not a connector: "${id}"`);
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
  waypoints: Array<{ x: number; y: number }>,
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
    },
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
        {
          ...current,
          routing: "auto",
          waypoints: routeConnectorInScene(s, { ...current, routing: "auto" }),
        },
        "update",
      );
    },
    undo(s) {
      s._put(previous, "update");
    },
  };
}

/**
 * Changes one or both endpoints of a connector to new element/port targets
 * (M19 endpoint retargeting, docs/10-canvas-parity-plan.md). Automatically
 * re-routes auto-routing connectors after the change; manual connectors keep
 * their current waypoints (the user will drag them into shape).
 */
export function retargetConnector(
  scene: Scene,
  id: ElementId,
  from: ConnectorElement["from"] | undefined,
  to: ConnectorElement["to"] | undefined,
): Command {
  const previous = requireConnector(scene, id);
  return {
    label: "retarget connector",
    do(s) {
      const current = requireConnector(s, id);
      const next: ConnectorElement = {
        ...current,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      };
      const routed: ConnectorElement =
        next.routing === "manual"
          ? next
          : { ...next, waypoints: routeConnectorInScene(s, next) };
      s._put(routed, "update");
    },
    undo(s) {
      s._put(previous, "update");
    },
  };
}

/**
 * Sets `locked: true` on the given ids and all their descendants (M18.4,
 * docs/10-canvas-parity-plan.md). Skip-unchanged: any id already locked is
 * silently skipped so a no-op selection doesn't produce a spurious undo entry.
 * Reports `_put`s as reason `"update"` — a field-only change (no geometry, no
 * containment), so the `renderElements` fast path handles it.
 */
export function lockElements(scene: Scene, ids: ElementId[]): Command {
  const allIds = new Set(ids);
  for (const id of ids) {
    for (const descendant of scene.descendantsOf(id)) allIds.add(descendant.id);
  }
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  return {
    label: "lock elements",
    do(s) {
      for (const id of allIds) {
        const el = s.get(id);
        if (el && !el.locked)
          s._put({ ...el, locked: true } as SceneElement, "update");
      }
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
    },
  };
}

/**
 * Sets `locked: false` (removes the field) on the given ids and all their
 * descendants, mirroring `lockElements` (M18.4).
 */
export function unlockElements(scene: Scene, ids: ElementId[]): Command {
  const allIds = new Set(ids);
  for (const id of ids) {
    for (const descendant of scene.descendantsOf(id)) allIds.add(descendant.id);
  }
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  return {
    label: "unlock elements",
    do(s) {
      for (const id of allIds) {
        const el = s.get(id);
        if (el && el.locked) {
          const next = { ...el } as SceneElement;
          delete next.locked;
          s._put(next, "update");
        }
      }
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
    },
  };
}

/**
 * Sets `hidden: true` on the given ids and all their descendants (M18.4,
 * docs/10-canvas-parity-plan.md). Reports `_put`s as reason `"update"` — same
 * rationale as `lockElements`.
 */
export function hideElements(scene: Scene, ids: ElementId[]): Command {
  const allIds = new Set(ids);
  for (const id of ids) {
    for (const descendant of scene.descendantsOf(id)) allIds.add(descendant.id);
  }
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  return {
    label: "hide elements",
    do(s) {
      for (const id of allIds) {
        const el = s.get(id);
        if (el && !el.hidden)
          s._put({ ...el, hidden: true } as SceneElement, "update");
      }
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
    },
  };
}

/**
 * Sets `hidden: false` (removes the field) on the given ids and all their
 * descendants, mirroring `hideElements` (M18.4).
 */
export function showElements(scene: Scene, ids: ElementId[]): Command {
  const allIds = new Set(ids);
  for (const id of ids) {
    for (const descendant of scene.descendantsOf(id)) allIds.add(descendant.id);
  }
  const previous = new Map([...allIds].map((id) => [id, scene.get(id)]));
  return {
    label: "show elements",
    do(s) {
      for (const id of allIds) {
        const el = s.get(id);
        if (el && el.hidden) {
          const next = { ...el } as SceneElement;
          delete next.hidden;
          s._put(next, "update");
        }
      }
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
    },
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
      for (let i = commands.length - 1; i >= 0; i -= 1)
        commands[i]!.undo(scene);
    },
  };
}

/** Updates document-level conformance settings as one undoable command. */
export function updateConformance(
  scene: Scene,
  patch: {
    exportGate?: ExportGate;
    ruleSeverity?: { ruleId: string; severity?: ConformanceSeverity };
  },
): Command {
  const previous: ConformanceSettings = {
    exportGate: scene.conformance.exportGate,
    ruleSeverities: { ...scene.conformance.ruleSeverities },
  };
  const next: ConformanceSettings = {
    exportGate: patch.exportGate ?? previous.exportGate,
    ruleSeverities: { ...previous.ruleSeverities },
  };
  if (patch.ruleSeverity) {
    if (patch.ruleSeverity.severity === undefined)
      delete next.ruleSeverities[patch.ruleSeverity.ruleId];
    else
      next.ruleSeverities[patch.ruleSeverity.ruleId] =
        patch.ruleSeverity.severity;
  }
  return {
    label: "update conformance settings",
    do(s) {
      s._setConformance(next);
    },
    undo(s) {
      s._setConformance(previous);
    },
  };
}
