import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { Scene } from "../scene/scene.js";
import { SvgRenderer } from "./svgRenderer.js";

/**
 * M14.7 (docs/10-canvas-parity-plan.md): IBM's own diagrams as the visual regression suite.
 *
 * This does NOT parse the vendored `.drawio` templates — D7 (docs/00-decision-log.md) locks
 * "no `.drawio` import" precisely because a full mxGraph mapping surface is large and fragile,
 * and that reasoning applies just as much to a test-only importer as a product feature. Instead,
 * this hand-reproduces the structure of the `iks_sr_mz_vpc` reference diagram (the same one
 * visually inspected throughout the M14 audit: Client → Public Network/IBM Cloud → Region →
 * OpenShift → Zone → Subnet → NLB/ALB/Worker Nodes) using ICAD's own authoring API against the
 * real bundled catalog — not synthetic fixture icons — so the assertions below exercise the real
 * rendering pipeline this audit fixed: icon tiles (D25), container tabs on every level (C7), and
 * connector fidelity (C2–C5).
 */

// process.cwd()-relative rather than import.meta.url-relative: under this package's jsdom test
// environment, import.meta.url does not reliably resolve to a real file:// URL, but vitest always
// runs with this package's root (packages/core) as its working directory.
//
// Version isn't hardcoded — packages/catalog/current.json is the single source of truth a
// catalog re-pin flips (docs/04-icon-catalog.md "Versioning strategy", roadmap M13).
const CATALOG_ROOT = path.resolve(process.cwd(), "../catalog");
const { version: CURRENT_CATALOG_VERSION } = JSON.parse(
  readFileSync(path.join(CATALOG_ROOT, "current.json"), "utf-8"),
) as { version: string };
const CATALOG_DIR = path.join(CATALOG_ROOT, CURRENT_CATALOG_VERSION);

function loadRealCatalog(): Catalog {
  const manifest = JSON.parse(
    readFileSync(path.join(CATALOG_DIR, "index.json"), "utf-8"),
  ) as CatalogManifest;
  const assets = new Map<string, string>();
  for (const icon of manifest.icons) {
    const raw = readFileSync(path.join(CATALOG_DIR, icon.asset), "utf-8");
    assets.set(
      icon.asset,
      raw.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""),
    );
  }
  return new Catalog(manifest, assets);
}

function attributes(
  element: Element | null | undefined,
): Record<string, string> {
  if (!element) throw new Error("Missing golden-fixture element");
  return Object.fromEntries(
    Array.from(element.attributes).map((a) => [a.name, a.value]),
  );
}

describe("golden fixture: iks_sr_mz_vpc reference structure", () => {
  let catalog: Catalog;
  let scene: Scene;
  let renderer: SvgRenderer;

  beforeAll(() => {
    catalog = loadRealCatalog();
  });

  // Built explicitly at the top of each `it` (not vitest's beforeEach) since the catalog isn't
  // ready until beforeAll runs.
  function buildScene(): void {
    scene = new Scene();
    const renderContainer = document.createElement("div");
    renderer = new SvgRenderer(renderContainer, catalog, "light");

    scene._put({
      id: "ibm-cloud",
      type: "box",
      semantic: "deployedOn",
      x: 0,
      y: 0,
      w: 900,
      h: 500,
      label: { text: "IBM Cloud" },
      style: { stroke: "#1192e8" },
      catalogRef: "ibm-cloud/ibm-cloud",
    });
    scene._put({
      id: "region",
      type: "box",
      semantic: "deployedOn",
      parentId: "ibm-cloud",
      x: 40,
      y: 60,
      w: 800,
      h: 400,
      label: { text: "Region" },
      style: { stroke: "#878d96" },
      catalogRef: "ibm-cloud/location",
    });
    scene._put({
      id: "openshift",
      type: "group",
      semantic: "deployedTo",
      parentId: "region",
      x: 80,
      y: 100,
      w: 720,
      h: 320,
      label: { text: "OpenShift" },
      style: { stroke: "#198038" },
      catalogRef: "ibm-cloud/open-shift",
    });
    scene._put({
      id: "zone-1",
      type: "zone",
      semantic: "boundary",
      zoneKind: "az",
      parentId: "openshift",
      x: 120,
      y: 140,
      w: 640,
      h: 240,
      label: { text: "Zone 1" },
    });
    scene._put({
      id: "subnet-1",
      type: "box",
      semantic: "deployedOn",
      parentId: "zone-1",
      x: 160,
      y: 180,
      w: 560,
      h: 160,
      label: { text: "Subnet 1" },
      style: { stroke: "#1192e8" },
    });

    scene._put({
      id: "client",
      type: "actor",
      semantic: "actor",
      x: -140,
      y: 220,
      w: 48,
      h: 48,
      label: { text: "Client" },
      catalogRef: "ibm-cloud/user",
    });
    scene._put({
      id: "nlb",
      type: "iconNode",
      semantic: "node",
      parentId: "subnet-1",
      x: 200,
      y: 220,
      w: 48,
      h: 48,
      label: { text: "NLB" },
      catalogRef: "ibm-cloud/network-load-balancer",
    });
    scene._put({
      id: "alb",
      type: "iconNode",
      semantic: "node",
      parentId: "subnet-1",
      x: 320,
      y: 220,
      w: 48,
      h: 48,
      label: { text: "ALB" },
      catalogRef: "ibm-cloud/load-balancer-application",
    });
    scene._put({
      id: "worker-1",
      type: "iconNode",
      semantic: "node",
      parentId: "subnet-1",
      x: 440,
      y: 190,
      w: 48,
      h: 48,
      label: { text: "Worker Node 1" },
      catalogRef: "ibm-cloud/virtual-server",
    });
    scene._put({
      id: "worker-2",
      type: "iconNode",
      semantic: "node",
      parentId: "subnet-1",
      x: 440,
      y: 260,
      w: 48,
      h: 48,
      label: { text: "Worker Node 2" },
      catalogRef: "ibm-cloud/virtual-server",
    });

    scene._put({
      id: "client-to-nlb",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "client", port: "e" },
      to: { elementId: "nlb", port: "w" },
      connectorType: "connection",
      flowColor: "public",
      direction: "unidirectional",
      routing: "manual",
      waypoints: [
        { x: -92, y: 244 },
        { x: 200, y: 244 },
      ],
    });
    scene._put({
      id: "nlb-to-alb",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "nlb", port: "e" },
      to: { elementId: "alb", port: "w" },
      connectorType: "connection",
      flowColor: "private",
      direction: "unidirectional",
      routing: "manual",
      waypoints: [
        { x: 248, y: 244 },
        { x: 320, y: 244 },
      ],
    });
    scene._put({
      id: "alb-to-worker-1",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "alb", port: "e" },
      to: { elementId: "worker-1", port: "w" },
      connectorType: "connection",
      flowColor: "private",
      direction: "unidirectional",
      routing: "manual",
      waypoints: [
        { x: 368, y: 244 },
        { x: 440, y: 214 },
      ],
    });
    scene._put({
      id: "alb-to-worker-2",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "alb", port: "e" },
      to: { elementId: "worker-2", port: "w" },
      connectorType: "connection",
      flowColor: "private",
      direction: "unidirectional",
      routing: "manual",
      waypoints: [
        { x: 368, y: 244 },
        { x: 440, y: 284 },
      ],
    });

    renderer.render(scene);
  }

  it("renders the Client actor as a solid black circle with a white glyph, no outline (D25)", () => {
    buildScene();
    const rect = renderer.nodeFor("client")?.querySelector(":scope > rect");
    expect(attributes(rect)).toMatchObject({
      fill: "#000000",
      stroke: "none",
      rx: "24",
      ry: "24",
    });
  });

  it("renders every nesting level's own colored sidebar tab, at every depth (C7)", () => {
    buildScene();
    const expectTab = (id: string, color: string) => {
      const rects = renderer.nodeFor(id)?.querySelectorAll(":scope > rect");
      expect(rects, `expected a sidebar tab on "${id}"`).toHaveLength(2);
      expect(attributes(rects![1] as Element)).toMatchObject({
        width: "4",
        fill: color,
      });
    };
    expectTab("ibm-cloud", "#1192e8");
    expectTab("region", "#878d96");
    expectTab("openshift", "#198038");
    expectTab("zone-1", "#8d8d8d"); // no style override -> theme default zone color
    expectTab("subnet-1", "#1192e8");
  });

  it("renders every container's corner glyph recolored to its own accent, since no tile sits behind it (D25)", () => {
    buildScene();
    for (const [id, color] of [
      ["ibm-cloud", "#1192e8"],
      ["region", "#878d96"],
      ["openshift", "#198038"],
    ] as const) {
      const glyphPath = renderer
        .nodeFor(id)
        ?.querySelector(":scope > svg path, :scope > svg g");
      expect(glyphPath, `expected a corner glyph on "${id}"`).toBeTruthy();
      // The glyph fragment's own fills were rewritten from white to the container's accent —
      // assert at least one drawable descendant carries that color.
      const recolored = renderer
        .nodeFor(id)
        ?.querySelector(`[fill="${color}"]`);
      expect(
        recolored,
        `expected "${id}"'s corner glyph recolored to ${color}`,
      ).toBeTruthy();
    }
  });

  it("renders every catalog icon as a solid category-color tile with a white glyph, no outline (D25)", () => {
    buildScene();
    const expectTile = (id: string, color: string) => {
      const rect = renderer.nodeFor(id)?.querySelector(":scope > rect");
      expect(attributes(rect)).toMatchObject({ fill: color, stroke: "none" });
      const glyphSvg = renderer.nodeFor(id)?.querySelector(":scope > svg");
      expect(attributes(glyphSvg)).toMatchObject({
        width: "24",
        height: "24",
        viewBox: "0 0 24 24",
      });
    };
    expectTile("nlb", "#1192E8");
    expectTile("alb", "#1192E8");
    expectTile("worker-1", "#198038");
    expectTile("worker-2", "#198038");
  });

  it("renders public/private connection flow colors and IBM's 2px stroke width (C2–C5)", () => {
    buildScene();
    const line = (id: string) =>
      renderer.nodeFor(id)?.querySelector("polyline");
    expect(attributes(line("client-to-nlb"))).toMatchObject({
      stroke: "#4376BB",
      "stroke-width": "2",
    });
    expect(attributes(line("nlb-to-alb"))).toMatchObject({
      stroke: "#198038",
      "stroke-width": "2",
    });
    expect(attributes(line("alb-to-worker-1"))).toMatchObject({
      stroke: "#198038",
      "stroke-width": "2",
    });
    expect(attributes(line("alb-to-worker-2"))).toMatchObject({
      stroke: "#198038",
      "stroke-width": "2",
    });
  });
});
