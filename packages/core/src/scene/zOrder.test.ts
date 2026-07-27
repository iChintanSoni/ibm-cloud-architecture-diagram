import { describe, expect, it } from "vitest";
import { Scene } from "./scene.js";
import type { BoxElement } from "./types.js";
import {
  bringForward,
  bringToFront,
  paintOrder,
  sendBackward,
  sendToBack,
} from "./zOrder.js";

function box(id: string, parentId?: string, z?: number): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...(parentId ? { parentId } : {}),
    ...(z !== undefined ? { z } : {}),
  };
}

const BRACKET = ["A", "B", "C", "D", "E"];

describe("SiblingReorder ops", () => {
  it("bringToFront moves selected ids to the end, preserving relative order in each partition", () => {
    expect(bringToFront(BRACKET, new Set(["B", "D"]))).toEqual([
      "A",
      "C",
      "E",
      "B",
      "D",
    ]);
  });

  it("sendToBack moves selected ids to the start, preserving relative order in each partition", () => {
    expect(sendToBack(BRACKET, new Set(["B", "D"]))).toEqual([
      "B",
      "D",
      "A",
      "C",
      "E",
    ]);
  });

  it("bringForward steps each selected id one position forward without leapfrogging another selected id", () => {
    expect(bringForward(BRACKET, new Set(["B", "D"]))).toEqual([
      "A",
      "C",
      "B",
      "E",
      "D",
    ]);
    expect(bringForward(BRACKET, new Set(["C", "D"]))).toEqual([
      "A",
      "B",
      "E",
      "C",
      "D",
    ]);
    expect(bringForward(BRACKET, new Set(["A", "C"]))).toEqual([
      "B",
      "A",
      "D",
      "C",
      "E",
    ]);
  });

  it("sendBackward steps each selected id one position backward without leapfrogging another selected id", () => {
    expect(sendBackward(BRACKET, new Set(["B", "D"]))).toEqual([
      "B",
      "A",
      "D",
      "C",
      "E",
    ]);
    expect(sendBackward(BRACKET, new Set(["C", "D"]))).toEqual([
      "A",
      "C",
      "D",
      "B",
      "E",
    ]);
    expect(sendBackward(BRACKET, new Set(["A", "C"]))).toEqual([
      "A",
      "C",
      "B",
      "D",
      "E",
    ]);
  });

  it("no-ops at the front/back edge with no special-casing", () => {
    expect(bringForward(BRACKET, new Set(["E"]))).toEqual(BRACKET);
    expect(bringForward(BRACKET, new Set(["D", "E"]))).toEqual(BRACKET);
    expect(sendBackward(BRACKET, new Set(["A"]))).toEqual(BRACKET);
    expect(sendBackward(BRACKET, new Set(["A", "B"]))).toEqual(BRACKET);
  });

  it("bringToFront/sendToBack no-op when the whole bracket is already at the requested end", () => {
    expect(bringToFront(BRACKET, new Set(BRACKET))).toEqual(BRACKET);
    expect(sendToBack(BRACKET, new Set(BRACKET))).toEqual(BRACKET);
  });
});

describe("paintOrder", () => {
  function everyContainerPrecedesItsDescendants(
    scene: Scene,
    order: string[],
  ): boolean {
    const indexOf = new Map(order.map((id, i) => [id, i]));
    for (const el of scene.all()) {
      for (const descendant of scene.descendantsOf(el.id)) {
        if (indexOf.get(el.id)! >= indexOf.get(descendant.id)!) return false;
      }
    }
    return true;
  }

  it("is a pre-order DFS: every container precedes its whole subtree, siblings in z-order", () => {
    const scene = new Scene();
    // Mirrors the real template shape: deeply-negative-z containers, default-z leaves.
    scene._put(box("frame", undefined, -100));
    scene._put(box("outer", "frame", -20));
    scene._put(box("inner", "outer", -10));
    scene._put(box("leaf-in-inner", "inner"));
    scene._put(box("sibling-of-outer", "frame"));
    scene._put(box("top-level-leaf"));

    const order = paintOrder(scene);
    expect(everyContainerPrecedesItsDescendants(scene, order)).toBe(true);
    expect(new Set(order)).toEqual(
      new Set([
        "frame",
        "outer",
        "inner",
        "leaf-in-inner",
        "sibling-of-outer",
        "top-level-leaf",
      ]),
    );
  });

  it("reproduces the corruption a dense per-bracket renumbering scheme would cause", () => {
    // frame:-100 -> outer:-20 -> inner:-10 -> leaf:0, sibling:0 — the real system-context shape.
    const scene = new Scene();
    scene._put(box("frame", undefined, -100));
    scene._put(box("outer", "frame", -20));
    scene._put(box("inner", "outer", -10));
    scene._put(box("leaf", "frame"));
    scene._put(box("sibling", "frame"));

    // Sending "leaf" to the back of "frame"'s sibling bracket [outer, leaf, sibling] must not
    // let "outer" end up after its own child "inner".
    const overrides = new Map([
      ["frame", sendToBack(["outer", "leaf", "sibling"], new Set(["leaf"]))],
    ]);
    const order = paintOrder(scene, overrides);
    expect(everyContainerPrecedesItsDescendants(scene, order)).toBe(true);
  });

  it("applies an override for one bracket while leaving others in their current z order", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b"));
    scene._put(box("child-of-a", "a"));
    const overrides = new Map([[undefined, ["b", "a"]]]);
    expect(paintOrder(scene, overrides)).toEqual(["b", "a", "child-of-a"]);
  });

  it("is idempotent", () => {
    const scene = new Scene();
    scene._put(box("frame", undefined, -100));
    scene._put(box("outer", "frame", -20));
    scene._put(box("inner", "outer"));
    scene._put(box("leaf"));
    const first = paintOrder(scene);
    // Actually renumber z to the computed order (what setZOrder's do() would write), then
    // recompute — a real idempotency check, not just calling a pure function twice unchanged.
    first.forEach((id, index) => scene._put({ ...scene.get(id)!, z: index }));
    expect(paintOrder(scene)).toEqual(first);
  });

  it("treats a dangling parentId as a root instead of dropping the element", () => {
    const scene = new Scene();
    scene._put(box("orphan", "does-not-exist"));
    scene._put(box("normal"));
    const order = paintOrder(scene);
    expect(new Set(order)).toEqual(new Set(["orphan", "normal"]));
  });

  it("treats a cyclic parentId chain as a root instead of hanging", () => {
    const scene = new Scene();
    scene._put(box("a", "b"));
    scene._put(box("b", "a"));
    const order = paintOrder(scene);
    expect(new Set(order)).toEqual(new Set(["a", "b"]));
  });

  it("treats a self-parenting element as a root instead of hanging", () => {
    const scene = new Scene();
    scene._put(box("self", "self"));
    expect(paintOrder(scene)).toEqual(["self"]);
  });
});
