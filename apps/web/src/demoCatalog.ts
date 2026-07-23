import { Catalog, type CatalogManifest } from "@icad/core";

/**
 * Placeholder icon catalog for local development.
 *
 * This stands in for the real, versioned IBM icon catalog that
 * `packages/catalog-build` will generate from the official IBM stencils
 * (docs/04-icon-catalog.md, roadmap M2). The shapes below are generic
 * placeholders only — not IBM artwork — so the editor, renderer, and
 * `.icad` pipeline can be exercised end-to-end before that pipeline exists.
 */
const manifest: CatalogManifest = {
  id: "demo-placeholder",
  version: "0.0.0-dev",
  categories: [
    { id: "compute", name: "Compute" },
    { id: "network", name: "Network" },
    { id: "storage", name: "Storage" },
    { id: "security", name: "Security" }
  ],
  icons: [
    {
      id: "demo/compute",
      name: "Compute instance",
      category: "compute",
      semantic: "node",
      container: "square",
      color: "#0f62fe",
      asset: "compute",
      keywords: ["vsi", "server", "instance"],
      tier: "ibm-cloud"
    },
    {
      id: "demo/vpc",
      name: "Virtual Private Cloud",
      category: "network",
      semantic: "node",
      container: "square",
      color: "#4589ff",
      asset: "vpc",
      keywords: ["vpc", "network"],
      tier: "ibm-cloud"
    },
    {
      id: "demo/storage",
      name: "Object storage",
      category: "storage",
      semantic: "node",
      container: "square",
      color: "#8a3ffc",
      asset: "storage",
      keywords: ["storage", "bucket"],
      tier: "ibm-cloud"
    },
    {
      id: "demo/security-group",
      name: "Security group",
      category: "security",
      semantic: "node",
      container: "square",
      color: "#da1e28",
      asset: "security",
      keywords: ["security", "firewall"],
      tier: "ibm-cloud"
    }
  ]
};

const assets = new Map<string, string>([
  ["compute", '<circle cx="10" cy="10" r="8" fill="#0f62fe" />'],
  ["vpc", '<rect x="2" y="2" width="16" height="16" rx="2" fill="none" stroke="#4589ff" stroke-width="2" />'],
  ["storage", '<path d="M2 6 L18 6 L18 16 L2 16 Z M2 6 A8 3 0 0 0 18 6" fill="none" stroke="#8a3ffc" stroke-width="1.5" />'],
  ["security", '<path d="M10 1 L18 4 V10 C18 15 14 18 10 19 C6 18 2 15 2 10 V4 Z" fill="#da1e28" />']
]);

export function createDemoCatalog(): Catalog {
  return new Catalog(manifest, assets);
}
