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

export function removeElement(scene: Scene, id: ElementId): Command {
  const previous = scene.get(id);
  return {
    label: "remove element",
    do(s) {
      s._remove(id);
    },
    undo(s) {
      if (previous) s._put(previous, "add");
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

export function moveElements(scene: Scene, ids: ElementId[], dx: number, dy: number): Command {
  const previous = new Map(ids.map((id) => [id, scene.get(id)]));
  return {
    label: "move elements",
    do(s) {
      for (const id of ids) {
        const el = s.get(id);
        if (el) s._put({ ...el, x: el.x + dx, y: el.y + dy } as SceneElement, "update");
      }
    },
    undo(s) {
      for (const id of ids) {
        const el = previous.get(id);
        if (el) s._put(el, "update");
      }
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
