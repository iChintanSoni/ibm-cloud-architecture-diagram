import { Emitter } from "../util/emitter.js";
import type { ElementId } from "../scene/types.js";

type SelectionEvents = { change: ElementId[] };

export class SelectionManager {
  private selected = new Set<ElementId>();
  private emitter = new Emitter<SelectionEvents>();

  get(): ElementId[] {
    return [...this.selected];
  }

  set(ids: ElementId[]): void {
    this.selected = new Set(ids);
    this.emitChange();
  }

  toggle(id: ElementId): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.emitChange();
  }

  clear(): void {
    this.selected.clear();
    this.emitChange();
  }

  isSelected(id: ElementId): boolean {
    return this.selected.has(id);
  }

  on(listener: (ids: ElementId[]) => void): () => void {
    return this.emitter.on("change", listener);
  }

  private emitChange(): void {
    this.emitter.emit("change", this.get());
  }
}
