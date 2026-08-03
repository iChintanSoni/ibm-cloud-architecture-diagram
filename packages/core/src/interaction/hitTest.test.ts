import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type {
  BoxElement,
  ConnectorElement,
  IconNodeElement,
} from "../scene/types.js";
import { hitTest, hitTestAll, hitTestRect } from "./hitTest.js";

function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId?: string,
): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y,
    w,
    h,
    ...(parentId ? { parentId } : {}),
  };
}

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
    catalogRef: "test/icon",
    x,
    y,
    w: 48,
    h: 48,
    ...(parentId ? { parentId } : {}),
  };
}

function connector(
  id: string,
  from: string,
  to: string,
  waypoints: Array<{ x: number; y: number }>,
): ConnectorElement {
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
    waypoints,
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
    scene._put(
      { ...(scene.get("child") as IconNodeElement), parentId: "container" },
      "update",
    );

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
        { x: 200, y: 20 },
      ]),
    );

    expect(hitTest(scene, { x: 100, y: 20 })?.id).toBe("conn"); // dead-center on the line
    expect(hitTest(scene, { x: 100, y: 23 }, { tolerance: 6 })?.id).toBe(
      "conn",
    ); // within tolerance
    expect(hitTest(scene, { x: 100, y: 40 }, { tolerance: 6 })).toBeUndefined(); // well outside it
  });

  it("hitTestAll orders overlapping candidates deepest-first, for alt-click cycling", () => {
    const scene = new Scene();
    scene._put(box("outer", 0, 0, 300, 300));
    scene._put(box("middle", 20, 20, 200, 200, "outer"));
    scene._put(icon("inner", 40, 40, "middle"));

    expect(hitTestAll(scene, { x: 50, y: 50 }).map((el) => el.id)).toEqual([
      "inner",
      "middle",
      "outer",
    ]);
  });

  it("prefers a connector over an unrelated container it happens to overlap, when the connector is on top (F1)", () => {
    // Reproduces the original bug: a Zone nested inside a Region (an unrelated container to the
    // connector) used to always win on raw depth alone, even when the connector was added later
    // (and thus painted on top). The zone is added first (lower z); the connector, whose
    // endpoints are two unrelated boxes, is added after and its polyline crosses the zone's fill.
    const scene = new Scene();
    scene._put(box("region", 0, 0, 300, 300));
    scene._put(box("zone", 20, 20, 200, 200, "region"));
    scene._put(box("extA", 0, 0, 10, 10));
    scene._put(box("extB", 290, 290, 10, 10));
    scene._put(
      connector("conn", "extA", "extB", [
        { x: 0, y: 100 },
        { x: 300, y: 100 },
      ]),
    );

    expect(hitTest(scene, { x: 100, y: 100 })?.id).toBe("conn");
  });

  it("still prefers a container over a connector it happens to overlap, when the container is on top (F1)", () => {
    // The flip side: the fix is a genuine z-order fallback, not a blanket connector bias. Here
    // the connector is added first (lower z) and the unrelated zone is added after, covering it.
    const scene = new Scene();
    scene._put(box("region", 0, 0, 300, 300));
    scene._put(box("extA", 0, 0, 10, 10));
    scene._put(box("extB", 290, 290, 10, 10));
    scene._put(
      connector("conn", "extA", "extB", [
        { x: 0, y: 100 },
        { x: 300, y: 100 },
      ]),
    );
    scene._put(box("zone", 20, 20, 200, 200, "region"));

    expect(hitTest(scene, { x: 100, y: 100 })?.id).toBe("zone");
  });

  it("falls back to z-order (topmost) for unrelated overlapping containers at different depths", () => {
    // Extends the same-depth case above: a top-level box and a zone nested inside a region, with
    // no ancestor relationship to each other, resolve by z-order alone, not by raw depth.
    const scene = new Scene();
    scene._put(box("region", 0, 0, 300, 300));
    scene._put(box("zone", 0, 0, 300, 300, "region"));
    scene._put(box("topLevel", 0, 0, 300, 300));

    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe("topLevel");
  });

  it("still prefers a deeply nested icon over an unrelated connector overlapping the same point (F1 regression guard)", () => {
    const scene = new Scene();
    scene._put(box("region", 0, 0, 300, 300));
    scene._put(box("group", 20, 20, 200, 200, "region"));
    scene._put(box("extA", 0, 0, 10, 10));
    scene._put(box("extB", 290, 290, 10, 10));
    scene._put(
      connector("conn", "extA", "extB", [
        { x: 0, y: 50 },
        { x: 300, y: 50 },
      ]),
    );
    scene._put(icon("inner", 40, 40, "group"));

    expect(hitTest(scene, { x: 50, y: 50 })?.id).toBe("inner");
  });

  it("resolves to a connector crossing its own endpoints' shared container, with no special-casing by parentId (F1)", () => {
    // Confirms the fix works purely because connectors never carry a parentId (so they're always
    // "unrelated" to any container in the ancestor check) — not via any explicit endpoint lookup.
    const scene = new Scene();
    scene._put(box("zone", 0, 0, 200, 200));
    scene._put(icon("a", 10, 10, "zone"));
    scene._put(icon("b", 130, 130, "zone"));
    scene._put(
      connector("conn", "a", "b", [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ]),
    );

    expect(hitTest(scene, { x: 100, y: 100 })?.id).toBe("conn");
  });

  it("hitTestRect matches only elements fully enclosed by the rect, not merely overlapping (fully-enclosed marquee semantics)", () => {
    const scene = new Scene();
    scene._put(box("enclosed", 10, 10, 50, 50));
    scene._put(box("straddling", 80, 10, 100, 50));

    const ids = hitTestRect(scene, { x: 0, y: 0, w: 100, h: 100 }).map(
      (el) => el.id,
    );
    expect(ids).toEqual(["enclosed"]);
  });

  it("hitTestRect encloses a connector only if every point on its path sits inside the rect", () => {
    const scene = new Scene();
    scene._put(box("from", 0, 0, 40, 40));
    scene._put(box("to", 500, 0, 40, 40));
    scene._put(
      connector("conn", "from", "to", [
        { x: 40, y: 20 },
        { x: 500, y: 20 },
      ]),
    );

    expect(
      hitTestRect(scene, { x: 0, y: 0, w: 600, h: 100 }).map((el) => el.id),
    ).toContain("conn");
    expect(
      hitTestRect(scene, { x: 0, y: 0, w: 100, h: 100 }).map((el) => el.id),
    ).not.toContain("conn");
  });
});
