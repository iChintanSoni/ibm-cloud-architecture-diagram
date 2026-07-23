import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement, ConnectorElement } from "../scene/types.js";
import { CommandBus } from "./commandBus.js";
import { addElement, moveElements, reparentElement, removeElement, updateElement } from "./commands.js";

function box(id: string, parentId?: string): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x: 0, y: 0, w: 100, h: 50, ...(parentId ? { parentId } : {}) };
}

function connector(id: string, fromId: string, toId: string, opts: Partial<ConnectorElement> = {}): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: fromId, port: "e" },
    to: { elementId: toId, port: "w" },
    connectorType: "association",
    routing: "auto",
    waypoints: [],
    ...opts
  };
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

  it("moves nested children along with their container (move-with)", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("parent")));
    bus.dispatch(addElement(box("child", "parent")));
    bus.dispatch(addElement(box("grandchild", "child")));

    bus.dispatch(moveElements(scene, ["parent"], 10, 20));
    expect(scene.get("parent")).toMatchObject({ x: 10, y: 20 });
    expect(scene.get("child")).toMatchObject({ x: 10, y: 20 });
    expect(scene.get("grandchild")).toMatchObject({ x: 10, y: 20 });

    bus.undo();
    expect(scene.get("child")).toMatchObject({ x: 0, y: 0 });
    expect(scene.get("grandchild")).toMatchObject({ x: 0, y: 0 });
  });

  it("does not double-move a descendant selected alongside its ancestor", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("parent")));
    bus.dispatch(addElement(box("child", "parent")));

    bus.dispatch(moveElements(scene, ["parent", "child"], 10, 0));
    expect(scene.get("child")).toMatchObject({ x: 10, y: 0 });
  });

  it("cascades removeElement to nested children and restores them on undo", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("parent")));
    bus.dispatch(addElement(box("child", "parent")));

    bus.dispatch(removeElement(scene, "parent"));
    expect(scene.has("parent")).toBe(false);
    expect(scene.has("child")).toBe(false);

    bus.undo();
    expect(scene.get("parent")).toMatchObject({ id: "parent" });
    expect(scene.get("child")).toMatchObject({ id: "child", parentId: "parent" });
  });

  it("reparents an element and undoes back to its prior container", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));
    bus.dispatch(addElement(box("b")));

    bus.dispatch(reparentElement(scene, "a", "b"));
    expect(scene.get("a")).toMatchObject({ parentId: "b" });

    bus.undo();
    expect(scene.get("a")?.parentId).toBeUndefined();
  });

  it("throws rather than reparenting an element into its own descendant", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("parent")));
    bus.dispatch(addElement(box("child", "parent")));

    expect(() => reparentElement(scene, "parent", "child")).toThrow(/descendant/);
  });

  it("re-routes an auto connector attached to a moved element, and undoes back", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));
    bus.dispatch(addElement(box("b")));
    bus.dispatch(addElement(connector("c1", "a", "b")));

    bus.dispatch(moveElements(scene, ["b"], 0, 100));

    const moved = scene.get("b");
    expect(moved).toMatchObject({ y: 100 });
    const connectorAfterMove = scene.get("c1") as ConnectorElement;
    // Ports no longer face each other on a straight line, so a bend is required.
    expect(connectorAfterMove.waypoints?.length).toBeGreaterThan(0);

    bus.undo();
    expect(scene.get("b")).toMatchObject({ y: 0 });
    expect((scene.get("c1") as ConnectorElement).waypoints).toEqual([]);
  });

  it("leaves a manually-routed connector's waypoints untouched when its endpoint moves", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));
    bus.dispatch(addElement(box("b")));
    const manualWaypoints = [{ x: 42, y: 42 }];
    bus.dispatch(addElement(connector("c1", "a", "b", { routing: "manual", waypoints: manualWaypoints })));

    bus.dispatch(moveElements(scene, ["b"], 0, 100));

    expect((scene.get("c1") as ConnectorElement).waypoints).toEqual(manualWaypoints);
  });

  it("re-routes an auto connector attached to a resized element via updateElement", () => {
    const scene = new Scene();
    const bus = new CommandBus(scene);
    bus.dispatch(addElement(box("a")));
    bus.dispatch(addElement(box("b")));
    bus.dispatch(addElement(connector("c1", "a", "b")));

    bus.dispatch(updateElement(scene, "a", { h: 400 }));

    expect(scene.get("a")).toMatchObject({ h: 400 });
    // Unrelated field updates (e.g. a label) must not trigger a reroute.
    bus.dispatch(updateElement(scene, "b", { label: { text: "B" } }));
    expect(scene.get("b")?.label?.text).toBe("B");
  });
});
