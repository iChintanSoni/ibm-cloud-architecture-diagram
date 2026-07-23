import { Catalog, type CatalogManifest } from "@icad/core";
import type { BoxElement, ConnectorElement, FrameElement, IconNodeElement } from "@icad/core";
import { describe, expect, it } from "vitest";
import { findMatches } from "./findModel.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "test-catalog",
    version: "0.0.1",
    categories: [{ id: "network", name: "Network" }],
    icons: [
      {
        id: "test/vpc",
        name: "Virtual Private Cloud",
        category: "network",
        semantic: "node",
        container: "square",
        asset: "vpc",
        keywords: ["vpc"],
        tier: "ibm-cloud"
      }
    ]
  };
  return new Catalog(manifest, new Map([["vpc", "<rect />"]]));
}

const icon: IconNodeElement = {
  id: "icon-1",
  type: "iconNode",
  semantic: "node",
  catalogRef: "test/vpc",
  x: 0,
  y: 0,
  w: 48,
  h: 48
};

const box: BoxElement = {
  id: "box-1",
  type: "box",
  semantic: "deployedOn",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  label: { text: "Payments platform" }
};

const frame: FrameElement = {
  id: "frame-1",
  type: "frame",
  semantic: "boundary",
  name: "Checkout flow",
  order: 1,
  x: 0,
  y: 0,
  w: 800,
  h: 500
};

const connector: ConnectorElement = {
  id: "conn-1",
  type: "connector",
  semantic: "node",
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  from: { elementId: box.id, port: "e" },
  to: { elementId: icon.id, port: "w" },
  connectorType: "association",
  routing: "auto",
  label: { text: "Payments platform gateway" }
};

describe("findMatches", () => {
  it("returns no matches for an empty query", () => {
    expect(findMatches([icon, box, frame], testCatalog(), "")).toEqual([]);
  });

  it("matches an element's own label", () => {
    const matches = findMatches([icon, box, frame], testCatalog(), "payments");
    expect(matches.map((m) => m.id)).toEqual(["box-1"]);
    expect(matches[0]).toMatchObject({ kind: "element", type: "box" });
  });

  it("matches by resolved catalog icon name, not just the raw ref", () => {
    const matches = findMatches([icon, box, frame], testCatalog(), "virtual private cloud");
    expect(matches.map((m) => m.id)).toEqual(["icon-1"]);
  });

  it("matches frame names and tags them with kind 'frame'", () => {
    const matches = findMatches([icon, box, frame], testCatalog(), "checkout");
    expect(matches).toEqual([{ id: "frame-1", label: "Checkout flow", type: "frame", kind: "frame" }]);
  });

  it("excludes connectors even when their label text matches", () => {
    const matches = findMatches([box, connector], testCatalog(), "payments");
    expect(matches.map((m) => m.id)).toEqual(["box-1"]);
  });

  it("is case-insensitive", () => {
    expect(findMatches([frame], testCatalog(), "CHECKOUT").map((m) => m.id)).toEqual(["frame-1"]);
  });
});
