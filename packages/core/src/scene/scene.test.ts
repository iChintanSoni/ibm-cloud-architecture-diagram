import { describe, expect, it, vi } from "vitest";
import { Scene } from "./scene.js";
import type { BoxElement } from "./types.js";

function box(id: string, parentId?: string): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x: 0, y: 0, w: 100, h: 100, ...(parentId ? { parentId } : {}) };
}

describe("Scene", () => {
  it("stores and retrieves elements", () => {
    const scene = new Scene();
    scene._put(box("a"));
    expect(scene.get("a")).toMatchObject({ id: "a", type: "box" });
    expect(scene.has("a")).toBe(true);
    expect(scene.has("missing")).toBe(false);
  });

  it("lists children by parentId", () => {
    const scene = new Scene();
    scene._put(box("parent"));
    scene._put(box("child-1", "parent"));
    scene._put(box("child-2", "parent"));
    scene._put(box("unrelated"));

    const children = scene.childrenOf("parent").map((el) => el.id);
    expect(children.sort()).toEqual(["child-1", "child-2"]);
  });

  it("removes elements and stops listing them", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._remove("a");
    expect(scene.has("a")).toBe(false);
    expect(scene.all()).toHaveLength(0);
  });

  it("emits change events on put/remove/replace", () => {
    const scene = new Scene();
    const listener = vi.fn();
    scene.on(listener);

    scene._put(box("a"), "add");
    scene._remove("a");
    scene._replaceAll([box("b")]);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ reason: "add", ids: ["a"] });
    expect(listener.mock.calls[1]?.[0]).toMatchObject({ reason: "remove", ids: ["a"] });
    expect(listener.mock.calls[2]?.[0]).toMatchObject({ reason: "replace", ids: ["b"] });
  });
});
