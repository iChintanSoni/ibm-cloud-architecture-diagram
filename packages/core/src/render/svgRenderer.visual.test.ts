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
    },
    {
      id: "fixture/vpc",
      name: "VPC",
      category: "compute",
      semantic: "node",
      container: "square",
      color: "#1192e8",
      asset: "vpc.svg"
    }
  ]
};

const catalog = new Catalog(
  manifest,
  new Map([
    ["server.svg", '<path data-glyph="server" fill="#198038" d="M2 2h16v16H2z"/>'],
    ["user.svg", '<circle data-glyph="user" fill="#000000" cx="10" cy="10" r="8"/>'],
    // A real post-D25 catalog asset: extract.ts no longer recolors, so every catalog SVG's
    // glyph fill is white regardless of the icon's own category color.
    ["vpc.svg", '<path data-glyph="vpc" fill="#FFFFFF" d="M2 2h16v16H2z"/>']
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

  it("renders Node and Actor as a solid category-color tile with a 24px glyph, no outline (D25)", () => {
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
      fill: "#198038",
      height: "48",
      stroke: "none",
      "stroke-width": "1",
      width: "48",
      x: "10",
      y: "20"
    });
    expect(attributes(renderer.nodeFor("node")?.querySelector(":scope > svg"))).toEqual({
      height: "24",
      viewBox: "0 0 24 24",
      width: "24",
      x: "22",
      y: "32"
    });
    expect(attributes(renderer.nodeFor("actor")?.querySelector(":scope > rect"))).toEqual({
      fill: "#000000",
      height: "48",
      rx: "24",
      ry: "24",
      stroke: "none",
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

  it("renders a colored sidebar tab on every container type, matching each container's own accent (C7)", () => {
    scene._put({
      id: "box",
      type: "box",
      semantic: "deployedOn",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      style: { stroke: "#1192e8" }
    });
    scene._put({
      id: "group",
      type: "group",
      semantic: "deployedTo",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      style: { stroke: "#198038" }
    });
    scene._put({
      id: "zone",
      type: "zone",
      semantic: "boundary",
      zoneKind: "az",
      x: 0,
      y: 0,
      w: 200,
      h: 100
    });
    scene._put({
      id: "frame",
      type: "frame",
      semantic: "boundary",
      name: "Section",
      order: 1,
      x: 0,
      y: 0,
      w: 200,
      h: 100
    });
    renderer.render(scene);

    const boxRects = renderer.nodeFor("box")?.querySelectorAll(":scope > rect");
    expect(boxRects).toHaveLength(2);
    expect(attributes(boxRects![1] as Element)).toMatchObject({
      x: "0",
      y: "0",
      width: "4",
      height: "32",
      fill: "#1192e8"
    });

    const groupRects = renderer.nodeFor("group")?.querySelectorAll(":scope > rect");
    expect(groupRects).toHaveLength(2);
    expect(attributes(groupRects![1] as Element)).toMatchObject({ width: "4", fill: "#198038" });

    const zoneRects = renderer.nodeFor("zone")?.querySelectorAll(":scope > rect");
    expect(zoneRects).toHaveLength(2);
    expect(attributes(zoneRects![0] as Element)).toMatchObject({ "stroke-dasharray": "2 2" });
    expect(attributes(zoneRects![1] as Element)).toMatchObject({ width: "4", fill: "#8d8d8d" });

    // Frame is an ICAD-only presentation affordance with no IBM semantic — no tab.
    expect(renderer.nodeFor("frame")?.querySelectorAll(":scope > rect")).toHaveLength(1);
  });

  it("recolors a container's corner glyph to its own accent, since no tile sits behind it (D25)", () => {
    scene._put({
      id: "vpc-box",
      type: "box",
      semantic: "deployedOn",
      catalogRef: "fixture/vpc",
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      style: { stroke: "#1192e8" }
    });
    renderer.render(scene);

    const glyph = renderer.nodeFor("vpc-box")?.querySelector(":scope > svg path");
    expect(glyph?.getAttribute("fill")).toBe("#1192e8");
  });

  it("renders a Group's own label beside its corner icon, not below the boundary", () => {
    scene._put({
      id: "group-with-icon",
      type: "group",
      semantic: "deployedTo",
      catalogRef: "fixture/server",
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      label: { text: "Kubernetes" },
      style: { stroke: "#198038" }
    });
    scene._put({
      id: "group-no-icon",
      type: "group",
      semantic: "deployedTo",
      x: 0,
      y: 300,
      w: 300,
      h: 200,
      label: { text: "No Icon" },
      style: { stroke: "#198038" }
    });
    renderer.render(scene);

    const withIconLabel = renderer.nodeFor("group-with-icon")?.querySelector("text");
    // Icon sits at (12, 12) sized 20x20; label starts 8px past its right edge, baseline
    // roughly centered against it — well above the boundary's bottom edge (y=200).
    expect(attributes(withIconLabel)).toMatchObject({ x: "40", y: "27", fill: "#161616" });
    expect(withIconLabel?.textContent).toBe("Kubernetes");

    const noIconLabel = renderer.nodeFor("group-no-icon")?.querySelector("text");
    // No icon to sit beside: label starts where the icon would have been, same baseline.
    expect(attributes(noIconLabel)).toMatchObject({ x: "12", y: "327", fill: "#161616" });
  });

  it("renders a Box's and a Zone's own label beside their corner icon too, not just Group's (C7)", () => {
    // Regression test: this positioning was originally built for Group only — Box and Zone fell
    // through to the generic bottom-center labelText() instead, confirmed wrong against IBM's own
    // iks_sr_mz_vpc reference (every container's title sits top-left beside its icon there,
    // including Region/IBM Cloud/Subnet, all Box, and Zone 1, a Zone).
    scene._put({
      id: "region",
      type: "box",
      semantic: "deployedOn",
      catalogRef: "fixture/server",
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      label: { text: "Region" },
      style: { stroke: "#878d96" }
    });
    scene._put({
      id: "zone-1",
      type: "zone",
      semantic: "boundary",
      zoneKind: "az",
      catalogRef: "fixture/server",
      x: 0,
      y: 300,
      w: 300,
      h: 200,
      label: { text: "Zone 1" }
    });
    renderer.render(scene);

    const boxLabel = renderer.nodeFor("region")?.querySelector("text");
    expect(attributes(boxLabel)).toMatchObject({ x: "40", y: "27", fill: "#161616" });
    expect(boxLabel?.textContent).toBe("Region");

    const zoneLabel = renderer.nodeFor("zone-1")?.querySelector("text");
    expect(attributes(zoneLabel)).toMatchObject({ x: "40", y: "327", fill: "#161616" });
    expect(zoneLabel?.textContent).toBe("Zone 1");
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
      stroke: "#4376BB"
    });
    expect(attributes(renderer.nodeFor("private-unidirectional")?.querySelector("polyline"))).toMatchObject({
      "marker-end": "url(#icad-arrow)",
      "marker-start": "url(#icad-dot)",
      stroke: "#198038"
    });
  });

  it("renders physical connections with hollow box end-caps on both ends", () => {
    scene._put({ id: "phys-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "phys-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    scene._put({
      id: "phys",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "phys-from", port: "e" },
      to: { elementId: "phys-to", port: "w" },
      connectorType: "physical-connection",
      routing: "manual",
      waypoints: []
    });
    renderer.render(scene);

    expect(attributes(renderer.svg.querySelector("#icad-box path"))).toMatchObject({
      stroke: "context-stroke",
      fill: "none"
    });
    expect(attributes(renderer.nodeFor("phys")?.querySelector("polyline"))).toMatchObject({
      "marker-start": "url(#icad-box)",
      "marker-end": "url(#icad-box)"
    });
  });

  it("uses IBM's open-V relationship arrowhead, distinct from implementation/extends's closed hollow triangle", () => {
    scene._put({ id: "rel-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "rel-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    const base = {
      type: "connector" as const,
      semantic: "node" as const,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "rel-from", port: "e" as const },
      to: { elementId: "rel-to", port: "w" as const },
      routing: "manual" as const,
      waypoints: []
    };
    scene._put({ ...base, id: "assoc", connectorType: "association" });
    scene._put({ ...base, id: "impl", connectorType: "implementation" });
    renderer.render(scene);

    expect(attributes(renderer.svg.querySelector("#icad-arrow-open path"))).toMatchObject({
      stroke: "context-stroke",
      fill: "none"
    });
    expect(attributes(renderer.nodeFor("assoc")?.querySelector("polyline"))).toMatchObject({
      "marker-end": "url(#icad-arrow-open)"
    });
    expect(attributes(renderer.nodeFor("impl")?.querySelector("polyline"))).toMatchObject({
      "marker-end": "url(#icad-arrow-hollow)"
    });
  });

  it("defaults connector stroke-width to 2 and gives logical-connection an even dash (not dash-dot)", () => {
    scene._put({ id: "log-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "log-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    scene._put({
      id: "log",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "log-from", port: "e" },
      to: { elementId: "log-to", port: "w" },
      connectorType: "logical-connection",
      routing: "manual",
      waypoints: []
    });
    renderer.render(scene);

    expect(attributes(renderer.nodeFor("log")?.querySelector("polyline"))).toMatchObject({
      "stroke-width": "2",
      "stroke-dasharray": "4 3"
    });
  });

  it("renders the IBM tunnel band in fixed colors, not the connector's own stroke (D-level fidelity fix)", () => {
    scene._put({ id: "tun-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "tun-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    scene._put({ id: "dtun-from", type: "box", semantic: "deployedOn", x: 0, y: 80, w: 48, h: 48 });
    scene._put({ id: "dtun-to", type: "box", semantic: "deployedOn", x: 240, y: 80, w: 48, h: 48 });
    scene._put({
      id: "tunnel",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "tun-from", port: "e" },
      to: { elementId: "tun-to", port: "w" },
      connectorType: "tunneling-connection",
      flowColor: "public",
      routing: "manual",
      waypoints: []
    });
    scene._put({
      id: "double-tunnel",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 80,
      w: 0,
      h: 80,
      from: { elementId: "dtun-from", port: "e" },
      to: { elementId: "dtun-to", port: "w" },
      connectorType: "traffic-through-double-tunnel",
      routing: "manual",
      waypoints: []
    });
    renderer.render(scene);

    const tunnelBands = renderer.nodeFor("tunnel")?.querySelectorAll("polyline");
    expect(tunnelBands).toHaveLength(2); // band + main line
    expect(attributes(tunnelBands![0] as Element)).toMatchObject({ stroke: "#FFD7D9" });

    const doubleBands = renderer.nodeFor("double-tunnel")?.querySelectorAll("polyline");
    expect(doubleBands).toHaveLength(3); // outer band + inner band + main line
    expect(attributes(doubleBands![0] as Element)).toMatchObject({ stroke: "#f1c21b" });
    expect(attributes(doubleBands![1] as Element)).toMatchObject({ stroke: "#FFD7D9" });
  });

  it("renders a circled sequence badge at the connector's midpoint, distinct from its text label", () => {
    scene._put({ id: "seq-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "seq-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    scene._put({
      id: "seq",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "seq-from", port: "e" },
      to: { elementId: "seq-to", port: "w" },
      connectorType: "association",
      label: { text: "calls" },
      sequence: "2a",
      routing: "manual",
      waypoints: [
        { x: 48, y: 24 },
        { x: 240, y: 24 }
      ]
    });
    renderer.render(scene);

    const badgeCircle = renderer.nodeFor("seq")?.querySelector("circle");
    expect(attributes(badgeCircle)).toMatchObject({ cx: "144", cy: "24", r: "9" });
    const texts = [...(renderer.nodeFor("seq")?.querySelectorAll("text") ?? [])].map((t) => t.textContent);
    expect(texts).toEqual(["calls", "2a"]);
  });

  it("omits the sequence badge entirely when unset", () => {
    scene._put({ id: "noseq-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "noseq-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    scene._put({
      id: "noseq",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "noseq-from", port: "e" },
      to: { elementId: "noseq-to", port: "w" },
      connectorType: "association",
      routing: "manual",
      waypoints: []
    });
    renderer.render(scene);

    expect(renderer.nodeFor("noseq")?.querySelector("circle")).toBeNull();
  });

  it("renders a structured protocol annotation formatted per IBM's worked example, below the line", () => {
    scene._put({ id: "ann-from", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 48, h: 48 });
    scene._put({ id: "ann-to", type: "box", semantic: "deployedOn", x: 240, y: 0, w: 48, h: 48 });
    scene._put({
      id: "ann",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "ann-from", port: "e" },
      to: { elementId: "ann-to", port: "w" },
      connectorType: "connection",
      annotation: { name: "HTTPS", security: "TLS1.3", port: "443" },
      routing: "manual",
      waypoints: [
        { x: 48, y: 24 },
        { x: 240, y: 24 }
      ]
    });
    renderer.render(scene);

    const texts = [...(renderer.nodeFor("ann")?.querySelectorAll("text") ?? [])];
    expect(texts).toHaveLength(1);
    expect(texts[0]?.textContent).toBe("HTTPS TLS1.3:443");
    expect(attributes(texts[0])).toMatchObject({ x: "144", y: "44", "text-anchor": "middle" });
  });

  function domOrder(): (string | null)[] {
    const layer = renderer.svg.querySelector('[data-icad-layer="elements"]')!;
    return [...layer.children].map((child) => child.getAttribute("data-icad-id"));
  }

  it("reorders existing DOM nodes when z-order changes, not just repainting them in place (C10)", () => {
    scene._put({ id: "a", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40, z: 1 });
    scene._put({ id: "b", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40, z: 2 });
    scene._put({ id: "c", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40, z: 3 });
    renderer.render(scene);
    expect(domOrder()).toEqual(["a", "b", "c"]);

    // "a" jumps to the front — the DOM order must follow, not just its own repainted content.
    scene._put({ ...(scene.get("a") as SceneElement), z: 5 }, "update");
    renderer.render(scene);
    expect(domOrder()).toEqual(["b", "c", "a"]);
  });

  it("skips the reorder walk when the id sequence is unchanged, but still applies on add/remove", () => {
    scene._put({ id: "a", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40 });
    scene._put({ id: "b", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40 });
    renderer.render(scene);
    const bNodeBefore = renderer.nodeFor("b");

    // An unrelated property edit, same id set/order: re-rendering must not disturb DOM identity.
    scene._put({ ...(scene.get("a") as SceneElement), label: { text: "renamed" } }, "update");
    renderer.render(scene);
    expect(renderer.nodeFor("b")).toBe(bNodeBefore);
    expect(domOrder()).toEqual(["a", "b"]);

    // A genuinely new element (default z) still lands in the right place via the same mechanism.
    scene._put({ id: "c", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40, z: -1 });
    renderer.render(scene);
    expect(domOrder()).toEqual(["c", "a", "b"]);
  });

  it("renderElements re-renders only the given ids from current scene state, leaving others untouched", () => {
    scene._put({ id: "a", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40, label: { text: "A" } });
    scene._put({ id: "b", type: "box", semantic: "deployedOn", x: 0, y: 0, w: 40, h: 40, label: { text: "B" } });
    renderer.render(scene);
    const bNodeBefore = renderer.nodeFor("b");

    // Mutate the scene directly (bypassing commands, as a live-preview caller would) and ask for
    // a targeted re-render — no full render() call in between.
    scene._put({ ...(scene.get("a") as SceneElement), w: 90 }, "update");
    renderer.renderElements(["a"]);

    expect(attributes(renderer.nodeFor("a")?.querySelector(":scope > rect"))).toMatchObject({ width: "90" });
    expect(renderer.nodeFor("b")).toBe(bNodeBefore); // untouched: same DOM node, never re-rendered
  });
});
