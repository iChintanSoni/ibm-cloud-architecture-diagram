import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Catalog, type CatalogManifest } from "@icad/core";

/**
 * Node-native equivalent of `apps/web/src/catalog.ts`'s `createIbmCloudCatalog()` — that one uses
 * Vite's `import.meta.glob`, a browser-bundler feature not available in this plain Node process.
 * Reads directly from the sibling `packages/catalog` data directory (packages/catalog-build/docs/icon-catalog.md) —
 * that directory has no `package.json` of its own, so this only works from inside a full clone of
 * this monorepo. That's an accepted constraint for now (matches D4's local-first, single-user
 * scope), not a silent assumption.
 *
 * The version isn't hardcoded — `packages/catalog/current.json` is the single source of truth a
 * catalog re-pin flips (packages/catalog-build/docs/icon-catalog.md "Versioning strategy", roadmap M13).
 */
const CATALOG_ROOT = fileURLToPath(new URL("../../catalog", import.meta.url));
const { version: CURRENT_VERSION } = JSON.parse(
  readFileSync(path.join(CATALOG_ROOT, "current.json"), "utf-8"),
) as { version: string };
const CATALOG_DIR = path.join(CATALOG_ROOT, CURRENT_VERSION);

// Catalog assets on disk are full, standalone SVGs (viewBox 0 0 24 24); `Catalog` expects inner
// fragments (see packages/core/src/catalog/catalog.ts), so strip the outer <svg> tag at load time.
function stripSvgWrapper(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

export function loadIbmCloudCatalog(): Catalog {
  const manifest = JSON.parse(
    readFileSync(path.join(CATALOG_DIR, "index.json"), "utf-8"),
  ) as CatalogManifest;
  const assets = new Map<string, string>();
  for (const icon of manifest.icons) {
    const raw = readFileSync(path.join(CATALOG_DIR, icon.asset), "utf-8");
    assets.set(icon.asset, stripSvgWrapper(raw));
  }
  return new Catalog(manifest, assets);
}
