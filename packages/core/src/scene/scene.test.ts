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

  it("collects transitive descendants", () => {
    const scene = new Scene();
    scene._put(box("root"));
    scene._put(box("child", "root"));
    scene._put(box("grandchild", "child"));
    scene._put(box("unrelated"));

    const ids = scene.descendantsOf("root").map((el) => el.id);
    expect(ids.sort()).toEqual(["child", "grandchild"]);
  });

  it("does not hang on a cyclic parentId chain", () => {
    const scene = new Scene();
    scene._put(box("a", "b"));
    scene._put(box("b", "a"));

    expect(scene.descendantsOf("a").map((el) => el.id).sort()).toEqual(["b"]);
    expect(scene.ancestorsOf("a").map((el) => el.id)).toEqual(["b"]);
  });

  it("reports isSelfOrDescendant for self and nested elements", () => {
    const scene = new Scene();
    scene._put(box("root"));
    scene._put(box("child", "root"));
    scene._put(box("sibling"));

    expect(scene.isSelfOrDescendant("root", "root")).toBe(true);
    expect(scene.isSelfOrDescendant("root", "child")).toBe(true);
    expect(scene.isSelfOrDescendant("root", "sibling")).toBe(false);
  });

  it("walks ancestorsOf from immediate parent to root", () => {
    const scene = new Scene();
    scene._put(box("root"));
    scene._put(box("mid", "root"));
    scene._put(box("leaf", "mid"));

    expect(scene.ancestorsOf("leaf").map((el) => el.id)).toEqual(["mid", "root"]);
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
