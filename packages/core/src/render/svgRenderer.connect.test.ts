import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { SvgRenderer } from "./svgRenderer.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = { id: "fixtures", version: "1", categories: [], icons: [] };
  return new Catalog(manifest, new Map());
}

function box(id: string, x: number, y: number): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x, y, w: 100, h: 60, label: { text: id } };
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
    const ports = [...container.querySelectorAll("[data-icad-port]")].map((el) => el.getAttribute("data-icad-port"));
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
    scene._put({ id: "f", type: "frame", semantic: "boundary", name: "Frame", order: 1, x: 0, y: 0, w: 200, h: 200 });
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
    expect(container.querySelector('[data-icad-layer="overlays"] line')).toBeNull();
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
    expect(rects.some((r) => r.getAttribute("stroke-dasharray") === "4 2")).toBe(true);
    expect(rects.some((r) => r.getAttribute("stroke-dasharray") === "1 2")).toBe(true);
  });
});
