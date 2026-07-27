import { describe, expect, it } from "vitest";
import { autoFitContainer, boundsOf, fitRectWithPadding } from "./bounds.js";
import { Scene } from "./scene.js";
import type { BoxElement, ConnectorElement, IconNodeElement } from "./types.js";

function box(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  parentId?: string,
): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    ...rect,
    ...(parentId ? { parentId } : {}),
  };
}

function icon(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  parentId?: string,
): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef: "test/icon",
    ...rect,
    ...(parentId ? { parentId } : {}),
  };
}

function connector(
  id: string,
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
    from: { elementId: "a", port: "e" },
    to: { elementId: "b", port: "w" },
    connectorType: "association",
    routing: "auto",
    waypoints,
  };
}

describe("boundsOf", () => {
  it("returns undefined for an unknown element", () => {
    const scene = new Scene();
    expect(boundsOf(scene, ["missing"])).toBeUndefined();
  });

  it("returns a single element's own rect", () => {
    const scene = new Scene();
    scene._put(box("a", { x: 10, y: 20, w: 100, h: 50 }));
    expect(boundsOf(scene, ["a"])).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it("unions multiple elements", () => {
    const scene = new Scene();
    scene._put(box("a", { x: 0, y: 0, w: 10, h: 10 }));
    scene._put(box("b", { x: 100, y: 100, w: 10, h: 10 }));
    expect(boundsOf(scene, ["a", "b"])).toEqual({ x: 0, y: 0, w: 110, h: 110 });
  });

  it("includes a container's descendants even when not passed explicitly", () => {
    const scene = new Scene();
    scene._put(box("parent", { x: 0, y: 0, w: 200, h: 200 }));
    scene._put(icon("child", { x: 300, y: 300, w: 48, h: 48 }, "parent"));
    expect(boundsOf(scene, ["parent"])).toEqual({ x: 0, y: 0, w: 348, h: 348 });
  });

  it("uses a connector's waypoints instead of its degenerate 0x0 rect", () => {
    const scene = new Scene();
    scene._put(
      connector("conn", [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 30 },
      ]),
    );
    expect(boundsOf(scene, ["conn"])).toEqual({ x: 0, y: 0, w: 50, h: 30 });
  });

  it("skips a connector with no waypoints", () => {
    const scene = new Scene();
    scene._put(connector("conn", []));
    scene._put(box("a", { x: 5, y: 5, w: 10, h: 10 }));
    expect(boundsOf(scene, ["conn", "a"])).toEqual({
      x: 5,
      y: 5,
      w: 10,
      h: 10,
    });
  });
});

describe("fitRectWithPadding (M17.4, docs/10-canvas-parity-plan.md)", () => {
  it("pads a bare bbox on every side when no existing rect is given", () => {
    const result = fitRectWithPadding({ x: 10, y: 10, w: 100, h: 50 }, 16);
    expect(result).toEqual({ x: -6, y: -6, w: 132, h: 82 });
  });

  it("unions with an existing rect, never shrinking below it", () => {
    // The bbox already sits with >=16px of buffer inside existing on every side (20 and
    // 300-120=180 horizontally, 20 and 300-70=230 vertically) — existing wins outright.
    const result = fitRectWithPadding({ x: 20, y: 20, w: 100, h: 50 }, 16, {
      x: 0,
      y: 0,
      w: 300,
      h: 300,
    });
    expect(result).toEqual({ x: 0, y: 0, w: 300, h: 300 });
  });

  it("grows past an existing rect only on the side the bbox actually overflows", () => {
    // Top-left already has >=16px buffer against existing (20 >= 16) so it's untouched; the
    // bbox's right/bottom edge (220) overflows existing's own (100), so only that side grows.
    const result = fitRectWithPadding({ x: 20, y: 20, w: 200, h: 200 }, 16, {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    expect(result).toEqual({ x: 0, y: 0, w: 236, h: 236 });
  });
});

describe("autoFitContainer (M17.4, docs/10-canvas-parity-plan.md)", () => {
  it("returns undefined for an unknown container", () => {
    const scene = new Scene();
    expect(autoFitContainer(scene, "missing")).toBeUndefined();
  });

  it("returns undefined for a container with no children — nothing to fit around", () => {
    const scene = new Scene();
    scene._put(box("parent", { x: 0, y: 0, w: 100, h: 100 }));
    expect(autoFitContainer(scene, "parent")).toBeUndefined();
  });

  it("leaves the container untouched when it already comfortably contains its children", () => {
    const scene = new Scene();
    scene._put(box("parent", { x: 0, y: 0, w: 200, h: 200 }));
    scene._put(box("child", { x: 20, y: 20, w: 40, h: 40 }, "parent"));
    expect(autoFitContainer(scene, "parent")).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 200,
    });
  });

  it("grows to fit a child that now extends past its bottom-right edge, plus the buffer", () => {
    const scene = new Scene();
    scene._put(box("parent", { x: 0, y: 0, w: 200, h: 200 }));
    scene._put(box("child", { x: 20, y: 20, w: 400, h: 400 }, "parent"));
    expect(autoFitContainer(scene, "parent")).toEqual({
      x: 0,
      y: 0,
      w: 20 + 400 + 16,
      h: 20 + 400 + 16,
    });
  });
});
