import type { Scene } from "../scene/scene.js";
import { Emitter } from "../util/emitter.js";
import type { Command } from "./types.js";

type CommandBusEvents = { dispatch: { command: Command } };

/** Applies commands against a Scene and maintains a linear undo/redo history. */
export class CommandBus {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private emitter = new Emitter<CommandBusEvents>();

  constructor(private scene: Scene) {}

  dispatch(command: Command): void {
    command.do(this.scene);
    this.undoStack.push(command);
    this.redoStack = [];
    this.emitter.emit("dispatch", { command });
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo(this.scene);
    this.redoStack.push(command);
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.do(this.scene);
    this.undoStack.push(command);
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Drops history when the entire document is replaced by Open/New. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  onDispatch(listener: (e: { command: Command }) => void): () => void {
    return this.emitter.on("dispatch", listener);
  }
}
