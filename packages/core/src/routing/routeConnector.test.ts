import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type {
  BoxElement,
  ConnectorElement,
  IconNodeElement,
  SceneElement,
} from "../scene/types.js";
import {
  connectorAnchorPoint,
  connectorPathPoints,
  containerAvoidanceRectsFor,
  routeConnectorInScene,
} from "./routeConnector.js";
import { pathCrossesObstacles } from "./orthogonalRouter.js";

function icon(
  id: string,
  x: number,
  y: number,
  parentId?: string,
): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef: "bench/vm",
    x,
    y,
    w: 48,
    h: 48,
    parentId,
  };
}

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId?: string,
): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x, y, w, h, parentId };
}

function connector(
  id: string,
  fromId: string,
  fromPort: "n" | "e" | "s" | "w" | "center",
  toId: string,
  toPort: "n" | "e" | "s" | "w" | "center",
): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: fromId, port: fromPort },
    to: { elementId: toId, port: toPort },
    connectorType: "connection",
    direction: "unidirectional",
    flowColor: "private",
    routing: "manual",
  };
}

function sceneOf(elements: SceneElement[]): Scene {
  const scene = new Scene();
  scene._replaceAll(elements);
  return scene;
}

describe("connectorAnchorPoint", () => {
  it("returns the exact port center when only one connector uses that port", () => {
    const scene = sceneOf([
      icon("a", 0, 0),
      icon("b", 300, 0),
      connector("c1", "a", "e", "b", "w"),
    ]);
    expect(connectorAnchorPoint(scene, "a", "e", "c1")).toEqual({
      x: 48,
      y: 24,
    });
  });

  it("spreads two connectors sharing the same (element, side) instead of stacking on the same point", () => {
    const scene = sceneOf([
      icon("source", 0, 100),
      icon("top", 300, 0),
      icon("bottom", 300, 300),
      connector("to-top", "source", "e", "top", "w"),
      connector("to-bottom", "source", "e", "bottom", "w"),
    ]);
    const toTop = connectorAnchorPoint(scene, "source", "e", "to-top");
    const toBottom = connectorAnchorPoint(scene, "source", "e", "to-bottom");

    // Both still attach to source's east side (x unchanged)...
    expect(toTop.x).toBe(48);
    expect(toBottom.x).toBe(48);
    // ...but no longer sit on the exact same point, and the one heading to the
    // element positioned higher up exits higher (non-crossing fan).
    expect(toTop.y).not.toBe(toBottom.y);
    expect(toTop.y).toBeLessThan(toBottom.y);
    // Symmetric around the true port center (y=124).
    expect(toTop.y + toBottom.y).toBeCloseTo(248, 5);
  });

  it("leaves a non-directional (center) port untouched even when shared", () => {
    const scene = sceneOf([
      icon("source", 0, 100),
      icon("top", 300, 0),
      connector("c1", "source", "e", "top", "center"),
      connector("c2", "source", "w", "top", "center"),
    ]);
    expect(connectorAnchorPoint(scene, "top", "center", "c1")).toEqual({
      x: 324,
      y: 24,
    });
    expect(connectorAnchorPoint(scene, "top", "center", "c2")).toEqual({
      x: 324,
      y: 24,
    });
  });

  it("updates once the scene changes (cache invalidates on mutation, not stale forever)", () => {
    const scene = sceneOf([
      icon("source", 0, 100),
      icon("only", 300, 0),
      connector("solo", "source", "e", "only", "w"),
    ]);
    expect(connectorAnchorPoint(scene, "source", "e", "solo")).toEqual({
      x: 48,
      y: 124,
    });

    scene._put(icon("second", 300, 300));
    scene._put(connector("new", "source", "e", "second", "w"));

    const solo = connectorAnchorPoint(scene, "source", "e", "solo");
    const fresh = connectorAnchorPoint(scene, "source", "e", "new");
    expect(solo.y).not.toBe(124); // no longer alone on this port
    expect(solo.y).not.toBe(fresh.y);
  });
});

describe("connectorPathPoints", () => {
  it("uses the fanned anchor points as the path's first and last point", () => {
    const scene = sceneOf([
      icon("source", 0, 100),
      icon("top", 300, 0),
      icon("bottom", 300, 300),
      connector("to-top", "source", "e", "top", "w"),
      connector("to-bottom", "source", "e", "bottom", "w"),
    ]);
    const conn = scene.get("to-top") as ConnectorElement;
    const points = connectorPathPoints(scene, conn);
    expect(points[0]).toEqual(
      connectorAnchorPoint(scene, "source", "e", "to-top"),
    );
    expect(points[points.length - 1]).toEqual(
      connectorAnchorPoint(scene, "top", "w", "to-top"),
    );
  });
});

describe("containerAvoidanceRectsFor", () => {
  it("excludes a container that's an ancestor of either endpoint", () => {
    const scene = sceneOf([
      box("subnet", 0, 0, 200, 200),
      icon("a", 20, 20, "subnet"),
      icon("b", 400, 20),
    ]);
    expect(containerAvoidanceRectsFor(scene, "a", "b")).toEqual([]);
  });

  it("excludes a container the connector attaches to directly (endpoint is itself a container)", () => {
    const scene = sceneOf([box("subnet", 0, 0, 200, 200), icon("b", 400, 20)]);
    expect(containerAvoidanceRectsFor(scene, "subnet", "b")).toEqual([]);
  });

  it("excludes a container that's a descendant of an endpoint (endpoint is itself a container)", () => {
    const scene = sceneOf([
      box("subnet", 0, 0, 200, 200),
      box("inner", 20, 20, 100, 100, "subnet"),
      icon("b", 400, 20),
    ]);
    expect(containerAvoidanceRectsFor(scene, "subnet", "b")).toEqual([]);
  });

  it("includes an unrelated sibling container as a soft obstacle", () => {
    const scene = sceneOf([
      box("subnet-a", 0, 0, 200, 200),
      box("subnet-b", 400, 0, 200, 200),
      icon("a", 20, 20, "subnet-a"),
      icon("b", 420, 20, "subnet-b"),
      box("unrelated", 800, 0, 100, 100),
    ]);
    expect(containerAvoidanceRectsFor(scene, "a", "b")).toEqual([
      { x: 800, y: 0, w: 100, h: 100 },
    ]);
  });

  it("excludes a container shared by both endpoints' ancestor chains, but still includes an unrelated sibling nested at the same depth under it", () => {
    const scene = sceneOf([
      box("vpc", 0, 0, 1000, 500),
      box("subnet-a", 0, 0, 200, 200, "vpc"),
      box("subnet-b", 400, 0, 200, 200, "vpc"),
      icon("a", 20, 20, "subnet-a"),
      icon("b", 420, 20, "subnet-b"),
    ]);
    // vpc is a shared ancestor (exempt); subnet-a and subnet-b are each an ancestor of one
    // endpoint (exempt for that connector) -- nothing unrelated remains.
    expect(containerAvoidanceRectsFor(scene, "a", "b")).toEqual([]);

    const withSibling = sceneOf([
      box("vpc", 0, 0, 1000, 500),
      box("subnet-a", 0, 0, 200, 200, "vpc"),
      box("subnet-b", 400, 0, 200, 200, "vpc"),
      box("subnet-c", 700, 0, 200, 200, "vpc"),
      icon("a", 20, 20, "subnet-a"),
      icon("b", 420, 20, "subnet-b"),
    ]);
    expect(containerAvoidanceRectsFor(withSibling, "a", "b")).toEqual([
      { x: 700, y: 0, w: 200, h: 200 },
    ]);
  });

  it("never includes a Frame element regardless of relation", () => {
    const scene = sceneOf([
      {
        id: "frame",
        type: "frame",
        semantic: "boundary",
        x: 0,
        y: 0,
        w: 1000,
        h: 1000,
      } as SceneElement,
      icon("a", 20, 20),
      icon("b", 500, 20),
    ]);
    expect(containerAvoidanceRectsFor(scene, "a", "b")).toEqual([]);
  });

  it("keeps routeConnectorInScene's waypoints clear of an unrelated box's rect", () => {
    const scene = sceneOf([
      box("subnet-a", 0, 0, 100, 100),
      box("subnet-c", 250, 0, 100, 40),
      box("subnet-b", 0, 300, 100, 100),
      icon("source", 20, 20, "subnet-a"),
      icon("target", 20, 320, "subnet-b"),
      connector("c1", "source", "e", "target", "e"),
    ]);
    const conn = scene.get("c1") as ConnectorElement;
    const waypoints = routeConnectorInScene(scene, conn);
    const fullPath = connectorPathPoints(scene, { ...conn, waypoints });
    expect(
      pathCrossesObstacles(fullPath, [{ x: 250, y: 0, w: 100, h: 40 }]),
    ).toBe(false);
  });
});
