import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { CommandBus } from "./commandBus.js";
import { addElement, moveElements, removeElement, updateElement } from "./commands.js";

function box(id: string): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x: 0, y: 0, w: 100, h: 50 };
}

describe("CommandBus", () => {
  it("applies a command and supports undo/redo", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);

    bus.dispatch(addElement(box("a")));
    expect(scene.has("a")).toBe(true);
    expect(bus.canUndo()).toBe(true);
    expect(bus.canRedo()).toBe(false);

    bus.undo();
    expect(scene.has("a")).toBe(false);
    expect(bus.canRedo()).toBe(true);

    bus.redo();
    expect(scene.has("a")).toBe(true);
  });

  it("clears the redo stack after a new dispatch", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);

    bus.dispatch(addElement(box("a")));
    bus.undo();
    bus.dispatch(addElement(box("b")));

    expect(bus.canRedo()).toBe(false);
    expect(scene.has("a")).toBe(false);
    expect(scene.has("b")).toBe(true);
  });

  it("restores prior values when undoing an update", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));

    bus.dispatch(updateElement(scene, "a", { label: { text: "VPC" } }));
    expect(scene.get("a")?.label?.text).toBe("VPC");

    bus.undo();
    expect(scene.get("a")?.label).toBeUndefined();
  });

  it("restores a removed element on undo", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));

    bus.dispatch(removeElement(scene, "a"));
    expect(scene.has("a")).toBe(false);

    bus.undo();
    expect(scene.get("a")).toMatchObject({ id: "a", type: "box" });
  });

  it("moves elements by a delta and undoes back to origin", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));

    bus.dispatch(moveElements(scene, ["a"], 10, 20));
    expect(scene.get("a")).toMatchObject({ x: 10, y: 20 });

    bus.undo();
    expect(scene.get("a")).toMatchObject({ x: 0, y: 0 });
  });
});
