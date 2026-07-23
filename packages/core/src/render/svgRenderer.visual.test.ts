import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { Scene } from "../scene/scene.js";
import type { ConnectorElement, SceneElement } from "../scene/types.js";
import { SvgRenderer } from "./svgRenderer.js";

const manifest: CatalogManifest = {
  id: "visual-fixtures",
  version: "1",
  categories: [
    { id: "compute", name: "Compute" },
    { id: "actors", name: "Actors" }
  ],
  icons: [
    {
      id: "fixture/server",
      name: "Server",
      category: "compute",
      semantic: "node",
      container: "square",
      color: "#198038",
      asset: "server.svg"
    },
    {
      id: "fixture/user",
      name: "User",
      category: "actors",
      semantic: "actor",
      container: "rounded",
      color: "#000000",
      asset: "user.svg"
    }
  ]
};

const catalog = new Catalog(
  manifest,
  new Map([
    ["server.svg", '<path data-glyph="server" fill="#198038" d="M2 2h16v16H2z"/>'],
    ["user.svg", '<circle data-glyph="user" fill="#000000" cx="10" cy="10" r="8"/>']
  ])
);

function attributes(element: Element | null): Record<string, string> {
  if (!element) throw new Error("Missing golden-fixture element");
  return Object.fromEntries(
    Array.from(element.attributes)
      .map((attribute) => [attribute.name, attribute.value])
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

function connector(
  id: string,
  y: number,
  direction: "unidirectional" | "bidirectional",
  flowColor: "public" | "private"
): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: `from-${y}`, port: "e" },
    to: { elementId: `to-${y}`, port: "w" },
    connectorType: "connection",
    direction,
    flowColor,
    routing: "manual",
    waypoints: []
  };
}

describe("IBM published visual golden fixtures", () => {
  let container: HTMLDivElement;
  let scene: Scene;
  let renderer: SvgRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    scene = new Scene();
    renderer = new SvgRenderer(container, catalog, "light");
  });

  it("renders Node and Actor containers at 48px with white fill and a 1px outline", () => {
    scene._put({
      id: "node",
      type: "iconNode",
      semantic: "node",
      catalogRef: "fixture/server",
      x: 10,
      y: 20,
      w: 48,
      h: 48
    });
    scene._put({
      id: "actor",
      type: "actor",
      semantic: "actor",
      catalogRef: "fixture/user",
      x: 80,
      y: 20,
      w: 48,
      h: 48
    });
    renderer.render(scene);

    expect(attributes(renderer.nodeFor("node")?.querySelector(":scope > rect"))).toEqual({
      fill: "white",
      height: "48",
      stroke: "#161616",
      "stroke-width": "1",
      width: "48",
      x: "10",
      y: "20"
    });
    expect(attributes(renderer.nodeFor("node")?.querySelector(":scope > svg"))).toEqual({
      height: "20",
      viewBox: "0 0 20 20",
      width: "20",
      x: "24",
      y: "34"
    });
    expect(attributes(renderer.nodeFor("actor")?.querySelector(":scope > rect"))).toEqual({
      fill: "white",
      height: "48",
      rx: "24",
      ry: "24",
      stroke: "#161616",
      "stroke-width": "1",
      width: "48",
      x: "80",
      y: "20"
    });
  });

  it("renders solid Boxes, dashed Groups, and alternating light/white nested fills", () => {
    const elements: SceneElement[] = [
      {
        id: "outer",
        type: "box",
        semantic: "deployedOn",
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        style: { stroke: "#1192e8" }
      },
      {
        id: "middle",
        type: "box",
        semantic: "deployedOn",
        parentId: "outer",
        x: 20,
        y: 20,
        w: 340,
        h: 240,
        style: { stroke: "#1192e8" }
      },
      {
        id: "inner",
        type: "group",
        semantic: "deployedTo",
        parentId: "middle",
        x: 40,
        y: 40,
        w: 280,
        h: 180,
        style: { stroke: "#198038" }
      }
    ];
    for (const element of elements) scene._put(element);
    renderer.render(scene);

    expect(attributes(renderer.nodeFor("outer")?.querySelector("rect"))).toMatchObject({
      fill: "#e5f6ff",
      stroke: "#1192e8"
    });
    expect(attributes(renderer.nodeFor("middle")?.querySelector("rect"))).toMatchObject({
      fill: "white",
      stroke: "#1192e8"
    });
    expect(attributes(renderer.nodeFor("inner")?.querySelector("rect"))).toMatchObject({
      fill: "#defbe6",
      stroke: "#198038",
      "stroke-dasharray": "6 4"
    });
  });

  it("renders reference-backed public/private and bidirectional/unidirectional endpoints", () => {
    for (const y of [40, 120]) {
      scene._put({
        id: `from-${y}`,
        type: "box",
        semantic: "deployedOn",
        x: 0,
        y,
        w: 48,
        h: 48
      });
      scene._put({
        id: `to-${y}`,
        type: "box",
        semantic: "deployedOn",
        x: 240,
        y,
        w: 48,
        h: 48
      });
    }
    scene._put(connector("public-bidirectional", 40, "bidirectional", "public"));
    scene._put(connector("private-unidirectional", 120, "unidirectional", "private"));
    renderer.render(scene);

    expect(attributes(renderer.svg.querySelector("#icad-dot path"))).toMatchObject({
      fill: "context-stroke"
    });
    expect(attributes(renderer.svg.querySelector("#icad-arrow path"))).toMatchObject({
      fill: "context-stroke"
    });
    expect(attributes(renderer.nodeFor("public-bidirectional")?.querySelector("polyline"))).toMatchObject({
      "marker-end": "url(#icad-dot)",
      "marker-start": "url(#icad-dot)",
      stroke: "#0f62fe"
    });
    expect(attributes(renderer.nodeFor("private-unidirectional")?.querySelector("polyline"))).toMatchObject({
      "marker-end": "url(#icad-arrow)",
      "marker-start": "url(#icad-dot)",
      stroke: "#198038"
    });
  });
});
