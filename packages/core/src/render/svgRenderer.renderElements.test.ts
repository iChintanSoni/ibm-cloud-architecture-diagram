import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { Scene } from "../scene/scene.js";
import type { BoxElement, ConnectorElement } from "../scene/types.js";
import { SvgRenderer } from "./svgRenderer.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = { id: "fixtures", version: "1", categories: [], icons: [] };
  return new Catalog(manifest, new Map());
}

function box(id: string, x: number, y: number): BoxElement {
  return { id, type: "box", semantic: "deployedOn", x, y, w: 100, h: 60, label: { text: id } };
}

function connector(id: string, fromId: string, toId: string, opts: Partial<ConnectorElement> = {}): ConnectorElement {
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
    routing: "auto",
    waypoints: [],
    ...opts
  };
}

function connectorPoints(container: HTMLElement, id: string): string | null {
  return container.querySelector(`[data-icad-id="${id}"] polyline`)?.getAttribute("points") ?? null;
}

describe("SvgRenderer.renderElements (scoped repaint, M16.1)", () => {
  let container: HTMLDivElement;
  let scene: Scene;
  let renderer: SvgRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    scene = new Scene();
    renderer = new SvgRenderer(container, testCatalog(), "light");
  });

  it("repaints a moved element at its new position", () => {
    scene._put(box("a", 0, 0));
    renderer.render(scene);

    scene._put({ ...scene.get("a")!, x: 40, y: 15 } as BoxElement, "update");
    renderer.renderElements(["a"]);

    const rect = container.querySelector('[data-icad-id="a"] rect')!;
    expect(rect.getAttribute("x")).toBe("40");
    expect(rect.getAttribute("y")).toBe("15");
  });

  it("also repaints an auto-routed connector attached to a moved element, even though its own id wasn't passed", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 300, 0));
    scene._put(connector("c1", "a", "b"));
    renderer.render(scene);
    const before = connectorPoints(container, "c1");

    scene._put({ ...scene.get("b")!, y: 200 } as BoxElement, "update");
    renderer.renderElements(["b"]); // "c1" deliberately not included — must be inferred

    expect(connectorPoints(container, "c1")).not.toBe(before);
  });

  it("also repaints a manually-routed connector attached to a moved element (endpoints stay live, only inner waypoints freeze)", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 300, 0));
    scene._put(connector("c1", "a", "b", { routing: "manual", waypoints: [{ x: 150, y: 42 }] }));
    renderer.render(scene);
    const before = connectorPoints(container, "c1");

    scene._put({ ...scene.get("b")!, y: 200 } as BoxElement, "update");
    renderer.renderElements(["b"]);

    expect(connectorPoints(container, "c1")).not.toBe(before);
  });

  it("leaves an untouched sibling's rendered position alone", () => {
    scene._put(box("a", 0, 0));
    scene._put(box("b", 300, 0));
    renderer.render(scene);

    scene._put({ ...scene.get("a")!, x: 999 } as BoxElement, "update");
    renderer.renderElements(["a"]);

    const rectB = container.querySelector('[data-icad-id="b"] rect')!;
    expect(rectB.getAttribute("x")).toBe("300");
  });

  it("does not make a brand-new element visible — add/remove reconciliation is render()'s job, not renderElements()'s", () => {
    scene._put(box("a", 0, 0));
    renderer.render(scene);

    scene._put(box("new", 10, 10), "add");
    renderer.renderElements(["new"]);

    expect(container.querySelector('[data-icad-id="new"]')).toBeNull();
  });
});
