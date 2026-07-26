import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement, ConnectorElement, IconNodeElement } from "../scene/types.js";
import { hitTest, hitTestAll, hitTestRect } from "./hitTest.js";

function box(id: string, x: number, y: number, w: number, h: number, parentId?: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y,
    w,
    h,
    ...(parentId ? { parentId } : {})
  };
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

function connector(id: string, from: string, to: string, waypoints: Array<{ x: number; y: number }>): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: from, port: "e" },
    to: { elementId: to, port: "w" },
    connectorType: "association",
    routing: "manual",
    waypoints
  };
}

describe("hitTest", () => {
  it("hits an element whose bounding box contains the point", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe("a");
  });

  it("returns undefined when nothing is under the point", () => {
    const scene = new Scene();
    scene._put(box("a", 0, 0, 100, 100));
    expect(hitTest(scene, { x: 500, y: 500 })).toBeUndefined();
  });

  it("prefers a nested child over its container, even when the container is later in z-order", () => {
    const scene = new Scene();
    // The container is added (and thus z-tie-broken later) AFTER its own child — the shape a
    // Ctrl+G group operation produces (addElement(group) then reparent existing members into
    // it), which previously defeated the old z-order-only heuristic (C9).
    scene._put(icon("child", 20, 20));
    scene._put(box("container", 0, 0, 200, 200));
    scene._put({ ...(scene.get("child") as IconNodeElement), parentId: "container" }, "update");

    expect(hitTest(scene, { x: 40, y: 40 })?.id).toBe("child");
  });

  it("prefers the deepest of three nested levels", () => {
    const scene = new Scene();
    scene._put(box("outer", 0, 0, 300, 300));
    scene._put(box("middle", 20, 20, 200, 200, "outer"));
    scene._put(icon("inner", 40, 40, "middle"));

    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe("inner");
  });

  it("falls back to z-order (topmost) for unrelated overlapping elements at the same depth", () => {
    const scene = new Scene();
    scene._put(box("under", 0, 0, 100, 100));
    scene._put(box("over", 0, 0, 100, 100));
    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe("over");
  });

  it("hits a connector within tolerance of its rendered polyline, not its degenerate 0x0 bbox", () => {
    const scene = new Scene();
    scene._put(box("from", 0, 0, 40, 40));
    scene._put(box("to", 200, 0, 40, 40));
    scene._put(
      connector("conn", "from", "to", [
        { x: 40, y: 20 },
        { x: 200, y: 20 }
      ])
    );

    expect(hitTest(scene, { x: 100, y: 20 })?.id).toBe("conn"); // dead-center on the line
    expect(hitTest(scene, { x: 100, y: 23 }, { tolerance: 6 })?.id).toBe("conn"); // within tolerance
    expect(hitTest(scene, { x: 100, y: 40 }, { tolerance: 6 })).toBeUndefined(); // well outside it
  });

  it("hitTestAll orders overlapping candidates deepest-first, for alt-click cycling", () => {
    const scene = new Scene();
    scene._put(box("outer", 0, 0, 300, 300));
    scene._put(box("middle", 20, 20, 200, 200, "outer"));
    scene._put(icon("inner", 40, 40, "middle"));

    expect(hitTestAll(scene, { x: 50, y: 50 }).map((el) => el.id)).toEqual(["inner", "middle", "outer"]);
  });

  it("hitTestRect matches only elements fully enclosed by the rect, not merely overlapping (fully-enclosed marquee semantics)", () => {
    const scene = new Scene();
    scene._put(box("enclosed", 10, 10, 50, 50));
    scene._put(box("straddling", 80, 10, 100, 50));

    const ids = hitTestRect(scene, { x: 0, y: 0, w: 100, h: 100 }).map((el) => el.id);
    expect(ids).toEqual(["enclosed"]);
  });

  it("hitTestRect encloses a connector only if every point on its path sits inside the rect", () => {
    const scene = new Scene();
    scene._put(box("from", 0, 0, 40, 40));
    scene._put(box("to", 500, 0, 40, 40));
    scene._put(
      connector("conn", "from", "to", [
        { x: 40, y: 20 },
        { x: 500, y: 20 }
      ])
    );

    expect(hitTestRect(scene, { x: 0, y: 0, w: 600, h: 100 }).map((el) => el.id)).toContain("conn");
    expect(hitTestRect(scene, { x: 0, y: 0, w: 100, h: 100 }).map((el) => el.id)).not.toContain("conn");
  });
});
