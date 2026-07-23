import type { Scene } from "../scene/scene.js";

/**
 * Every mutation in the engine is a Command. Humans, autosave, and the
 * future MCP server all go through the same CommandBus so undo/redo,
 * validation, and change notification stay in one place.
 */
export interface Command {
  label: string;
  do(scene: Scene): void;
  undo(scene: Scene): void;
}
