import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type {
  BoxElement,
  ConnectorElement,
  IconNodeElement,
  SceneElement,
} from "../scene/types.js";
import { containerLabelRect } from "../render/containerLabel.js";
import {
  connectorAnchorPoint,
  connectorLabelRectsFor,
  connectorPathPoints,
  containerAvoidanceRectsFor,
  containerLabelRectsFor,
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
  label?: string,
): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y,
    w,
    h,
    parentId,
    label: label !== undefined ? { text: label } : undefined,
  };
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

  it("guarantees a minimum separation on a typical 48px icon (M23.3 - the ratio alone gives ~9.6px here)", () => {
    const scene = sceneOf([
      icon("source", 0, 100),
      icon("top", 300, 0),
      icon("bottom", 300, 300),
      connector("to-top", "source", "e", "top", "w"),
      connector("to-bottom", "source", "e", "bottom", "w"),
    ]);
    const toTop = connectorAnchorPoint(scene, "source", "e", "to-top");
    const toBottom = connectorAnchorPoint(scene, "source", "e", "to-bottom");

    expect(toBottom.y - toTop.y).toBeGreaterThanOrEqual(16);
  });

  it("holds the minimum separation pairwise for 3 siblings, not just for 2", () => {
    const scene = sceneOf([
      icon("source", 0, 100),
      icon("a", 300, 0),
      icon("b", 300, 150),
      icon("c", 300, 300),
      connector("to-a", "source", "e", "a", "w"),
      connector("to-b", "source", "e", "b", "w"),
      connector("to-c", "source", "e", "c", "w"),
    ]);
    const ys = [
      connectorAnchorPoint(scene, "source", "e", "to-a").y,
      connectorAnchorPoint(scene, "source", "e", "to-b").y,
      connectorAnchorPoint(scene, "source", "e", "to-c").y,
    ].sort((a, b) => a - b);

    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(16);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(16);
  });

  it("doesn't shrink an already-generous ratio-based spread on a large element", () => {
    const scene = sceneOf([
      { ...icon("source", 0, 0), w: 48, h: 500 },
      icon("top", 300, 0),
      icon("bottom", 300, 400),
      connector("to-top", "source", "e", "top", "w"),
      connector("to-bottom", "source", "e", "bottom", "w"),
    ]);
    const toTop = connectorAnchorPoint(scene, "source", "e", "to-top");
    const toBottom = connectorAnchorPoint(scene, "source", "e", "to-bottom");

    // Ratio-based: span = 500*0.6 = 300, gap = 300/3 = 100 - well above the 16px floor, so the
    // floor must not kick in and shrink this back down.
    expect(toBottom.y - toTop.y).toBeCloseTo(100, 0);
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

describe("containerLabelRectsFor", () => {
  it("is empty for an unlabeled box", () => {
    const scene = sceneOf([box("b1", 0, 0, 200, 100)]);
    expect(containerLabelRectsFor(scene)).toEqual([]);
  });

  it("includes a labeled box's own label rect even though it's an ancestor of a connector's endpoint", () => {
    // Contrast with containerAvoidanceRectsFor: that function exempts a box that's an ancestor of
    // one of the connector's endpoints (legitimately crossed per M4). Label avoidance has no such
    // exemption - it applies to every labeled container regardless of relatedness.
    const scene = sceneOf([
      box("subnet", 0, 0, 200, 200, undefined, "Auto Scale Group"),
      icon("a", 20, 20, "subnet"),
      icon("b", 400, 20),
    ]);
    const subnet = scene.get("subnet")!;
    expect(containerAvoidanceRectsFor(scene, "a", "b")).toEqual([]);
    expect(containerLabelRectsFor(scene)).toEqual([containerLabelRect(subnet)]);
  });

  it("is empty for a Frame with a label hand-set on it", () => {
    const scene = sceneOf([
      {
        id: "frame",
        type: "frame",
        semantic: "boundary",
        name: "My Frame",
        order: 0,
        x: 0,
        y: 0,
        w: 1000,
        h: 1000,
        label: { text: "stray label" },
      } as SceneElement,
    ]);
    expect(containerLabelRectsFor(scene)).toEqual([]);
  });

  it("updates once the scene changes (cache invalidates on mutation)", () => {
    const scene = sceneOf([box("b1", 0, 0, 200, 100, undefined, "Subnet")]);
    expect(containerLabelRectsFor(scene)).toHaveLength(1);

    scene._put(box("b2", 300, 0, 200, 100, undefined, "Another Subnet"));
    expect(containerLabelRectsFor(scene)).toHaveLength(2);
  });

  it("keeps a connector legitimately entering its own target's ancestor from crossing that ancestor's label", () => {
    // Reconstruction of the actual dogfooding bug: a Load-Balancer-like source outside an
    // "Auto Scale Group" box connects to a target inside it. The connector must legitimately
    // enter the box (M4), but shouldn't cross the box's own label doing so.
    const scene = sceneOf([
      box("group", 300, 0, 400, 200, undefined, "Auto Scale Group"),
      icon("source", 0, 20),
      icon("target", 340, 40, "group"),
      connector("c1", "source", "e", "target", "w"),
    ]);
    const conn = scene.get("c1") as ConnectorElement;
    const waypoints = routeConnectorInScene(scene, conn);
    const fullPath = connectorPathPoints(scene, { ...conn, waypoints });
    const labelRect = containerLabelRect(scene.get("group")!)!;

    expect(pathCrossesObstacles(fullPath, [labelRect])).toBe(false);
    // Proves the fix stayed scoped to the label strip, not a regression into hard-avoiding the
    // whole container (which would violate M4) - some point of the path still falls inside the
    // group's general bounds, since the connector legitimately terminates there.
    expect(
      fullPath.some((p) => p.x >= 300 && p.x <= 700 && p.y >= 0 && p.y <= 200),
    ).toBe(true);
  });

  it("keeps a connector from hugging a related container's border it merely passes alongside before entering", () => {
    // Recreates the actual dogfooding bug (ROKS template): a source outside a container connects
    // to a target nested deep inside it. A hard obstacle in between forces the route to travel a
    // long stretch alongside the outer container's top border before diving down to the target -
    // exactly the shape that used to land precisely on (or a few px inside) that border, since
    // "outer" is an ancestor of the target endpoint and so is exempt from
    // containerAvoidanceRectsFor's soft-obstacle channel (M4 - legitimately crossed).
    const scene = sceneOf([
      box("outer", 200, 100, 400, 300),
      box("inner", 500, 300, 60, 60, "outer"),
      icon("target", 510, 310, "inner"),
      icon("source", 0, 76),
      { ...icon("blocker", 100, 150), w: 300, h: 100 },
      connector("c1", "source", "e", "target", "w"),
    ]);
    const conn = scene.get("c1") as ConnectorElement;
    const waypoints = routeConnectorInScene(scene, conn);
    const fullPath = connectorPathPoints(scene, { ...conn, waypoints });

    const outerTop = 100;
    let sawOverlappingSegment = false;
    for (let i = 0; i < fullPath.length - 1; i += 1) {
      const a = fullPath[i]!;
      const b = fullPath[i + 1]!;
      if (a.y !== b.y) continue; // only horizontal segments can hug a top edge
      const overlapsOuterWidth =
        Math.min(a.x, b.x) < 600 && Math.max(a.x, b.x) > 200;
      if (!overlapsOuterWidth) continue;
      sawOverlappingSegment = true;
      expect(Math.abs(a.y - outerTop)).toBeGreaterThanOrEqual(10);
    }
    // Guards against a vacuous pass: the blocker must actually force some horizontal segment to
    // cross outer's width, or the assertion above never ran.
    expect(sawOverlappingSegment).toBe(true);
  });

  it("excludes a connector's own two endpoint containers from border clearance (attachment isn't hugging)", () => {
    // A connector directly between two boxes (both endpoints are themselves containers) is the
    // simplest possible scene the border-clearance channel could see: no other container is
    // present or relevant. If containerRectsFor's own two endpoints weren't excluded, their edges
    // would still add new candidate grid lines purely from being present in the `containers` list
    // (regardless of whether any actual penalty fires), which was enough to perturb Dijkstra's
    // tie-breaking for this exact shape and silently produce a different, endpoint-position-
    // independent route (M27.1 dogfooding regression, caught by createEditor.test.ts's distribute
    // suite). Asserts the fix by checking the route reacts to the target box moving, which it
    // could only fail to do if some part of the route had become anchored to fixed grid lines
    // instead of the endpoints' actual positions.
    const scene = sceneOf([
      box("a", 0, 0, 100, 60),
      box("b", 200, 200, 100, 60),
      connector("c1", "a", "e", "b", "w"),
    ]);
    const conn = scene.get("c1") as ConnectorElement;
    const before = routeConnectorInScene(scene, conn);

    scene._put(box("b", 400, 200, 100, 60));
    const after = routeConnectorInScene(scene, conn);

    expect(after).not.toEqual(before);
  });
});

describe("obstaclesFor (rotation-aware hard obstacles, M27.4)", () => {
  it("uses a rotated text element's real footprint, not its unrotated stored box", () => {
    // Mirrors the actual ROKS "Master" label bug: a Text element's stored x/y/w/h describes its
    // *unrotated* footprint (rotation pivots about that box's own center) - a wide, short box here
    // (60x20) that becomes tall and narrow (20x60) once rotated -90deg. A route that only avoided
    // the raw unrotated box would cut straight through the real, rotated glyph.
    const rotatedText = {
      id: "master-label",
      type: "text",
      semantic: "node",
      text: "Master",
      rotation: -90,
      // Center (300,100); half-extents (30,10) pre-rotation, swapped to (10,30) once rotated -90.
      x: 270,
      y: 90,
      w: 60,
      h: 20,
    } as SceneElement;

    const scene = sceneOf([
      icon("source", 0, 56),
      icon("target", 600, 56),
      rotatedText,
      connector("c1", "source", "e", "target", "w"),
    ]);
    const conn = scene.get("c1") as ConnectorElement;
    const waypoints = routeConnectorInScene(scene, conn);
    const fullPath = connectorPathPoints(scene, { ...conn, waypoints });

    const rotatedRect = { x: 290, y: 70, w: 20, h: 60 };
    expect(pathCrossesObstacles(fullPath, [rotatedRect])).toBe(false);

    // Guards against a vacuous pass: without rotation-awareness the shortest path here is simply
    // the straight horizontal line both ports sit on (y=80), which the *unrotated* box (y:90-110)
    // never touches at all - so unpatched code would have returned exactly this line, oblivious to
    // where the text actually paints.
    const straightLine = [
      { x: 48, y: 80 },
      { x: 600, y: 80 },
    ];
    expect(pathCrossesObstacles(straightLine, [rotatedRect])).toBe(true);
  });
});

describe("connectorLabelRectsFor", () => {
  it("is empty when no other connector carries any text", () => {
    const scene = sceneOf([
      icon("a", 0, 0),
      icon("b", 300, 0),
      connector("c1", "a", "e", "b", "w"),
    ]);
    expect(connectorLabelRectsFor(scene, "c1")).toEqual([]);
  });

  it("excludes the connector's own text even when it's the only one asking", () => {
    // A connector's own text sits at a fraction along *its own* path, which doesn't exist yet
    // while that very path is being decided - it can never appear in its own avoidance list.
    const scene = sceneOf([
      icon("a", 0, 0),
      icon("b", 300, 0),
      { ...connector("c1", "a", "e", "b", "w"), label: { text: "HTTPS" } },
    ]);
    expect(connectorLabelRectsFor(scene, "c1")).toEqual([]);
  });

  it("includes another connector's label, annotation, cardinality, and sequence badge as separate rects", () => {
    const scene = sceneOf([
      icon("a", 0, 0),
      icon("b", 300, 0),
      {
        ...connector("labeled", "a", "e", "b", "w"),
        label: { text: "HTTPS" },
        annotation: { name: "HTTPS", security: "TLS1.3", port: "443" },
        cardinality: { from: "1", to: "0..N" },
        sequence: "1",
      },
    ]);
    const rects = connectorLabelRectsFor(scene, "some-other-connector");
    // label + annotation + cardinality.from + cardinality.to + sequence badge.
    expect(rects).toHaveLength(5);
    for (const r of rects) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });

  it("steers routeConnectorInScene's path clear of another connector's own text label", () => {
    const scene = sceneOf([
      icon("p1", 0, 0),
      icon("p2", 300, 0),
      {
        ...connector("labeled", "p1", "e", "p2", "w"),
        label: { text: "HTTPS TLS1.3" },
      },
      icon("q1", 150, -80),
      icon("q2", 150, 150),
      connector("crossing", "q1", "s", "q2", "n"),
    ]);
    const labelRects = connectorLabelRectsFor(scene, "crossing");
    // Guards against a vacuous pass: the labeled connector's text must have actually produced a
    // rect for "crossing" to have anything to avoid.
    expect(labelRects.length).toBeGreaterThan(0);

    const crossing = scene.get("crossing") as ConnectorElement;
    const waypoints = routeConnectorInScene(scene, crossing);
    const fullPath = connectorPathPoints(scene, { ...crossing, waypoints });

    expect(pathCrossesObstacles(fullPath, labelRects)).toBe(false);
  });
});
