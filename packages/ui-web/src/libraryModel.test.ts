import { describe, expect, it } from "vitest";
import { Catalog, type CatalogManifest } from "@icad/core";
import { groupLibraryIcons } from "./libraryModel.js";
import { confirmedContainerPresets, containerKindLabel } from "./presets.js";

const manifest: CatalogManifest = {
  id: "test",
  version: "1",
  categories: [
    { id: "compute", name: "Compute" },
    { id: "network", name: "Network" }
  ],
  icons: [
    {
      id: "test/server",
      name: "Virtual server",
      category: "compute",
      semantic: "node",
      container: "square",
      asset: "server.svg",
      keywords: ["instance"]
    },
    {
      id: "test/vpc",
      name: "VPC",
      category: "network",
      semantic: "node",
      container: "square",
      asset: "vpc.svg"
    }
  ]
};

const catalog = new Catalog(manifest, new Map());

describe("library model", () => {
  it("groups the full catalog in manifest category order", () => {
    expect(groupLibraryIcons(catalog, "").map((group) => group.category.id)).toEqual([
      "compute",
      "network"
    ]);
  });

  it("searches names and keywords and omits empty groups", () => {
    const groups = groupLibraryIcons(catalog, "instance");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.icons.map((icon) => icon.id)).toEqual(["test/server"]);
  });

  it("ships only the four presets confirmed by IBM worked examples", () => {
    expect(confirmedContainerPresets.map((preset) => preset.id)).toEqual([
      "ibm-cloud",
      "public-network",
      "open-shift",
      "availability-zone"
    ]);
  });

  it("exposes the internal zone primitive as Boundary in the public library", () => {
    expect(containerKindLabel("box")).toBe("Box");
    expect(containerKindLabel("group")).toBe("Group");
    expect(containerKindLabel("zone")).toBe("Boundary");
    expect(containerKindLabel("frame")).toBe("Frame");
  });
});
