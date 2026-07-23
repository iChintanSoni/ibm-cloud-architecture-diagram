import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement, ConnectorElement, IconNodeElement } from "../scene/types.js";
import { computeTabOrder } from "./tabOrder.js";

function box(id: string, x: number, y: number, parentId?: string): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x, y, w: 100, h: 100, ...(parentId ? { parentId } : {}) };
}

function icon(id: string, x: number, y: number, parentId?: string): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef: "test/icon",
    x,
    y,
    w: 48,
    h: 48,
    ...(parentId ? { parentId } : {})
  };
}

function connector(id: string, fromId: string, toId: string): ConnectorElement {
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
    routing: "auto"
  };
}

describe("computeTabOrder", () => {
  it("orders root-level siblings west-to-east", () => {
    const scene = new Scene();
    scene._put(box("east", 200, 0));
    scene._put(box("west", 0, 0));
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["west", "east"]);
  });

  it("breaks x ties by y", () => {
    const scene = new Scene();
    scene._put(box("south", 0, 200));
    scene._put(box("north", 0, 0));
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["north", "south"]);
  });

  it("visits a container immediately before its children (pre-order)", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0));
    scene._put(icon("child", 10, 10, "parent"));
    scene._put(box("sibling", 500, 0));
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["parent", "child", "sibling"]);
  });

  it("recurses through nested containers", () => {
    const scene = new Scene();
    scene._put(box("outer", 0, 0));
    scene._put(box("inner", 10, 10, "outer"));
    scene._put(icon("leaf", 20, 20, "inner"));
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["outer", "inner", "leaf"]);
  });

  it("orders children of the same parent west-to-east too", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0, undefined));
    scene._put(icon("child-east", 300, 10, "parent"));
    scene._put(icon("child-west", 10, 10, "parent"));
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["parent", "child-west", "child-east"]);
  });

  it("places connectors last, ordered by their source element's position", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0));
    scene._put(box("b", 300, 0));
    scene._put(connector("conn-from-b", "b", "a"));
    scene._put(connector("conn-from-a", "a", "b"));
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["a", "b", "conn-from-a", "conn-from-b"]);
  });

  it("excludes a connector from a container's children even if it has a parentId", () => {
    const scene = new Scene();
    scene._put(box("parent", 0, 0));
    scene._put(icon("child", 10, 10, "parent"));
    const wayward = { ...connector("stray", "parent", "child"), parentId: "parent" };
    scene._put(wayward);
    expect(computeTabOrder(scene).map((el) => el.id)).toEqual(["parent", "child", "stray"]);
  });
});
