import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { SvgRenderer } from "./svgRenderer.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "fixtures",
    version: "1",
    categories: [],
    icons: [],
  };
  return new Catalog(manifest, new Map());
}

function box(id: string, x: number, y: number): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y,
    w: 100,
    h: 60,
    label: { text: id },
  };
}

describe("SvgRenderer connector drawing overlays", () => {
  let container: HTMLDivElement;
  let scene: Scene;
  let renderer: SvgRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    scene = new Scene();
    renderer = new SvgRenderer(container, testCatalog(), "light");
  });

  it("reveals four port markers on a hovered element and clears them on undo-hover", () => {
    scene._put(box("a", 0, 0));
    renderer.render(scene);

    renderer.setHoveredElement("a");
    const ports = [...container.querySelectorAll("[data-icad-port]")].map(
      (el) => el.getAttribute("data-icad-port"),
    );
    expect(ports.sort()).toEqual(["a:e", "a:n", "a:s", "a:w"].sort());

    renderer.setHoveredElement(undefined);
    expect(container.querySelectorAll("[data-icad-port]")).toHaveLength(0);
  });

  it("positions port markers at the element's edge midpoints", () => {
    scene._put(box("a", 0, 0));
    renderer.render(scene);
    renderer.setHoveredElement("a");

    const north = container.querySelector('[data-icad-port="a:n"]')!;
    expect(north.getAttribute("cx")).toBe("50");
    expect(north.getAttribute("cy")).toBe("0");

    const east = container.querySelector('[data-icad-port="a:e"]')!;
    expect(east.getAttribute("cx")).toBe("100");
    expect(east.getAttribute("cy")).toBe("30");
  });

  it("does not show port markers on a connector or a frame", () => {
    scene._put({
      id: "f",
      type: "frame",
      semantic: "boundary",
      name: "Frame",
      order: 1,
      x: 0,
      y: 0,
      w: 200,
      h: 200,
    });
    renderer.render(scene);
    renderer.setHoveredElement("f");
    expect(container.querySelectorAll("[data-icad-port]")).toHaveLength(0);
  });

  it("marks port markers as pointer-interactive despite the decorative overlay layer", () => {
    scene._put(box("a", 0, 0));
    renderer.render(scene);
    renderer.setHoveredElement("a");
    const marker = container.querySelector('[data-icad-port="a:n"]')!;
    expect(marker.getAttribute("pointer-events")).toBe("all");
  });

  it("draws and clears a draft connector rubber-band line", () => {
    scene._put(box("a", 0, 0));
    renderer.render(scene);

    renderer.setConnectorDraft({ x: 10, y: 10 }, { x: 90, y: 40 });
    const line = container.querySelector('[data-icad-layer="overlays"] line')!;
    expect(line.getAttribute("x1")).toBe("10");
    expect(line.getAttribute("y2")).toBe("40");

    renderer.setConnectorDraft(undefined, undefined);
    expect(
      container.querySelector('[data-icad-layer="overlays"] line'),
    ).toBeNull();
  });

  it("renders a focus ring independent of the selection outline", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 200, 0));
    renderer.render(scene);

    renderer.setSelection(["a"]);
    renderer.focusElement("b");

    const overlays = container.querySelector('[data-icad-layer="overlays"]')!;
    // Selection outline (dashed "4 2") for a, focus ring ("1 2") for b: two distinct rects.
    const rects = [...overlays.querySelectorAll("rect")];
    expect(
      rects.some((r) => r.getAttribute("stroke-dasharray") === "4 2"),
    ).toBe(true);
    expect(
      rects.some((r) => r.getAttribute("stroke-dasharray") === "1 2"),
    ).toBe(true);
  });
});

describe("SvgRenderer M19 connector editing overlays", () => {
  let container: HTMLDivElement;
  let scene: Scene;
  let renderer: SvgRenderer;

  function testConnector(
    fromId: string,
    toId: string,
    waypoints: Array<{ x: number; y: number }>,
  ) {
    return {
      id: "c1",
      type: "connector" as const,
      semantic: "node" as const,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: fromId, port: "e" as const },
      to: { elementId: toId, port: "w" as const },
      connectorType: "connection" as const,
      routing: "manual" as const,
      waypoints,
    };
  }

  beforeEach(() => {
    container = document.createElement("div");
    scene = new Scene();
    renderer = new SvgRenderer(
      container,
      new Catalog(
        { id: "t", version: "1", categories: [], icons: [] },
        new Map(),
      ),
      "light",
    );
  });

  it("shows waypoint drag handles for each inner waypoint of a selected manual connector", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 400, 0));
    scene._put(
      testConnector("a", "b", [
        { x: 200, y: 30 },
        { x: 200, y: 100 },
      ]),
    );
    renderer.render(scene);
    renderer.setSelection(["c1"]);

    const handles = container.querySelectorAll("[data-icad-waypoint-handle]");
    expect(handles).toHaveLength(2);
    expect(handles[0]!.getAttribute("data-icad-waypoint-handle")).toBe("c1:0");
    expect(handles[1]!.getAttribute("data-icad-waypoint-handle")).toBe("c1:1");
    // Handles are pointer-interactive.
    expect(handles[0]!.getAttribute("pointer-events")).toBe("all");
  });

  it("shows midpoint insert handles on segments long enough to host one", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 400, 0));
    // One inner waypoint → two segments; both are long enough.
    scene._put(testConnector("a", "b", [{ x: 200, y: 30 }]));
    renderer.render(scene);
    renderer.setSelection(["c1"]);

    const inserts = container.querySelectorAll("[data-icad-waypoint-insert]");
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(inserts[0]!.getAttribute("pointer-events")).toBe("all");
  });

  it("shows endpoint retarget handles (pink circles) on each endpoint of a selected connector", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 400, 0));
    scene._put(testConnector("a", "b", []));
    renderer.render(scene);
    renderer.setSelection(["c1"]);

    const endpoints = container.querySelectorAll("[data-icad-endpoint-handle]");
    expect(endpoints).toHaveLength(2);
    const attrs = [...endpoints].map((el) =>
      el.getAttribute("data-icad-endpoint-handle"),
    );
    expect(attrs.sort()).toEqual(["c1:from", "c1:to"].sort());
    // Endpoint handles use the retarget color (pink), not blue.
    expect(endpoints[0]!.getAttribute("stroke")).toBe("#ee5396");
  });

  it("shows no waypoint/endpoint handles when no connector is selected", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 400, 0));
    scene._put(testConnector("a", "b", [{ x: 200, y: 30 }]));
    renderer.render(scene);
    renderer.setSelection(["a"]);

    expect(
      container.querySelectorAll("[data-icad-waypoint-handle]"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll("[data-icad-endpoint-handle]"),
    ).toHaveLength(0);
  });

  it("previewConnectorWaypoints updates the rendered path without touching the scene", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 400, 0));
    scene._put(testConnector("a", "b", [{ x: 200, y: 30 }]));
    renderer.render(scene);
    renderer.setSelection(["c1"]);

    // Apply a preview with a different waypoint.
    renderer.previewConnectorWaypoints("c1", [{ x: 200, y: 150 }]);

    // The preview waypoint handle should now reflect the new position.
    const handles = container.querySelectorAll("[data-icad-waypoint-handle]");
    expect(handles).toHaveLength(1);
    // The handle x attr reflects the new y=150 position (rotated rect centered on the waypoint).
    const handle = handles[0]! as SVGRectElement;
    const cy = parseFloat(handle.getAttribute("y")!) + 5; // center = y + half width
    expect(cy).toBeCloseTo(150, 0);

    // Scene waypoints are unmodified.
    expect((scene.get("c1") as { waypoints?: unknown[] }).waypoints).toEqual([
      { x: 200, y: 30 },
    ]);

    // Clear the preview.
    renderer.previewConnectorWaypoints("c1", null);
    const handlesAfter = container.querySelectorAll(
      "[data-icad-waypoint-handle]",
    );
    expect(handlesAfter).toHaveLength(1);
    const handleAfter = handlesAfter[0]! as SVGRectElement;
    const cyAfter = parseFloat(handleAfter.getAttribute("y")!) + 5;
    expect(cyAfter).toBeCloseTo(30, 0);
  });
});
