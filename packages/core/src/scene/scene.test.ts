import { describe, expect, it, vi } from "vitest";
import { Scene } from "./scene.js";
import type { BoxElement } from "./types.js";

function box(id: string, parentId?: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...(parentId ? { parentId } : {}),
  };
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

    expect(
      scene
        .descendantsOf("a")
        .map((el) => el.id)
        .sort(),
    ).toEqual(["b"]);
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

    expect(scene.ancestorsOf("leaf").map((el) => el.id)).toEqual([
      "mid",
      "root",
    ]);
  });

  it("emits change events on put/remove/replace", () => {
    const scene = new Scene();
    const listener = vi.fn();
    scene.on(listener);

    scene._put(box("a"), "add");
    scene._remove("a");
    scene._replaceAll([box("b")]);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      reason: "add",
      ids: ["a"],
    });
    expect(listener.mock.calls[1]?.[0]).toMatchObject({
      reason: "remove",
      ids: ["a"],
    });
    expect(listener.mock.calls[2]?.[0]).toMatchObject({
      reason: "replace",
      ids: ["b"],
    });
  });

  describe("_transaction", () => {
    it("coalesces every _put inside the callback into one change event covering all ids", () => {
      const scene = new Scene();
      scene._put(box("a"));
      scene._put(box("b"));
      scene._put(box("c"));
      const listener = vi.fn();
      scene.on(listener);

      scene._transaction(() => {
        scene._put({ ...scene.get("a")!, x: 5 }, "update");
        scene._put({ ...scene.get("b")!, x: 5 }, "update");
        scene._put({ ...scene.get("c")!, x: 5 }, "update");
      });

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0]?.[0];
      expect(event.reason).toBe("update");
      expect([...event.ids].sort()).toEqual(["a", "b", "c"]);
    });

    it("does not flush early for a nested transaction", () => {
      const scene = new Scene();
      scene._put(box("a"));
      const listener = vi.fn();
      scene.on(listener);

      scene._transaction(() => {
        scene._transaction(() => {
          scene._put({ ...scene.get("a")!, x: 1 }, "update");
        });
        expect(listener).not.toHaveBeenCalled();
        scene._put({ ...scene.get("a")!, x: 2 }, "update");
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("still flushes a conformance-only transaction, whose ids stay empty", () => {
      const scene = new Scene();
      const listener = vi.fn();
      scene.on(listener);

      scene._transaction(() => {
        scene._setConformance({ exportGate: "block", ruleSeverities: {} });
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toMatchObject({
        reason: "update",
        ids: [],
      });
    });

    it("reports 'replace' when the buffered calls mix reasons", () => {
      const scene = new Scene();
      scene._put(box("a"));
      const listener = vi.fn();
      scene.on(listener);

      scene._transaction(() => {
        scene._put(box("b"), "add");
        scene._put({ ...scene.get("a")!, x: 1 }, "update");
      });

      expect(listener.mock.calls[0]?.[0]).toMatchObject({ reason: "replace" });
    });

    it("still flushes if fn throws, and resets batching state for the next transaction", () => {
      const scene = new Scene();
      const listener = vi.fn();
      scene.on(listener);

      expect(() =>
        scene._transaction(() => {
          scene._put(box("a"));
          throw new Error("boom");
        }),
      ).toThrow("boom");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toMatchObject({
        reason: "add",
        ids: ["a"],
      });

      scene._put(box("b"));
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });
});
