import { describe, expect, it } from "vitest";
import type { CatalogManifest } from "./types.js";
import { Catalog } from "./catalog.js";

function manifest(): CatalogManifest {
  return {
    id: "test-catalog",
    version: "1.0.0",
    categories: [{ id: "network", name: "Network" }],
    icons: [
      {
        id: "ibm-cloud/vpc",
        name: "Virtual Private Cloud",
        category: "network",
        semantic: "node",
        container: "square",
        asset: "vpc",
        keywords: ["vpc", "virtual private cloud"],
        aliases: ["ibm-cloud/gen2-vpc"],
        tier: "ibm-cloud",
      },
    ],
  };
}

describe("Catalog", () => {
  const catalog = new Catalog(manifest(), new Map([["vpc", "<rect />"]]));

  it("resolves by id", () => {
    expect(catalog.resolve("ibm-cloud/vpc")?.name).toBe(
      "Virtual Private Cloud",
    );
  });

  it("resolves by alias", () => {
    expect(catalog.resolve("ibm-cloud/gen2-vpc")?.id).toBe("ibm-cloud/vpc");
  });

  it("returns undefined for an unknown id", () => {
    expect(catalog.resolve("does/not-exist")).toBeUndefined();
  });

  it("searches by name and keyword, case-insensitively", () => {
    expect(catalog.search("VIRTUAL private")).toHaveLength(1);
    expect(catalog.search("vpc")).toHaveLength(1);
    expect(catalog.search("nope")).toHaveLength(0);
  });

  it("filters by category", () => {
    expect(catalog.byCategory("network")).toHaveLength(1);
    expect(catalog.byCategory("compute")).toHaveLength(0);
  });

  it("looks up the SVG asset via the resolved icon", () => {
    expect(catalog.svg("ibm-cloud/vpc")).toBe("<rect />");
    expect(catalog.svg("ibm-cloud/gen2-vpc")).toBe("<rect />");
  });
});
