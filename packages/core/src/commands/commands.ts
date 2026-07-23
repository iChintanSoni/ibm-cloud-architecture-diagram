import type { Scene } from "../scene/scene.js";
import type { ElementId, SceneElement } from "../scene/types.js";
import type { Command } from "./types.js";

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
 * symmetrically to delete), every element nested under it. Undo restores the
 * whole subtree, parents before children so intermediate parentId lookups
 * stay valid throughout.
 */
export function removeElement(scene: Scene, id: ElementId): Command {
  const root = scene.get(id);
  const subtree = root ? [root, ...scene.descendantsOf(id)] : [];
  return {
    label: "remove element",
    do(s) {
      for (const el of subtree) s._remove(el.id);
    },
    undo(s) {
      for (const el of subtree) s._put(el, "add");
    }
  };
}

export function updateElement(scene: Scene, id: ElementId, patch: Partial<SceneElement>): Command {
  const previous = scene.get(id);
  return {
    label: "update element",
    do(s) {
      const current = s.get(id);
      if (!current) return;
      s._put({ ...current, ...patch } as SceneElement, "update");
    },
    undo(s) {
      if (previous) s._put(previous, "update");
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
  return {
    label: "move elements",
    do(s) {
      for (const id of allIds) {
        const el = s.get(id);
        if (el) s._put({ ...el, x: el.x + dx, y: el.y + dy } as SceneElement, "update");
      }
    },
    undo(s) {
      for (const id of allIds) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
    }
  };
}

/**
 * Changes an element's container membership. Reparenting to `undefined`
 * lifts it to the top level. Throws on a cycle (assigning an element as its
 * own descendant's child), which would hang move-with/cascading-delete.
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
