import { Catalog, type CatalogManifest } from "@icad/core";

/**
 * Loads the real IBM icon catalog (docs/04-icon-catalog.md), exactly like
 * apps/web/src/catalog.ts — this webview is also a Vite build, so the same eager `import.meta.glob`
 * approach bakes the manifest + SVGs straight into the bundle. Only the relative depth differs
 * (apps/vscode/webview/src is one level deeper than apps/web/src).
 */
const manifestModules = import.meta.glob("../../../../packages/catalog/2.0.0/index.json", {
  eager: true,
  import: "default"
});
const manifest = Object.values(manifestModules)[0] as CatalogManifest;

const assetModules = import.meta.glob("../../../../packages/catalog/2.0.0/icons/**/*.svg", {
  eager: true,
  query: "?raw",
  import: "default"
}) as Record<string, string>;

// Catalog assets on disk are full, standalone SVGs (viewBox 0 0 20 20); `Catalog` expects inner
// fragments (see packages/core/src/catalog/catalog.ts), so strip the outer <svg> tag here.
function stripSvgWrapper(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

export function createIbmCloudCatalog(): Catalog {
  const assets = new Map<string, string>();
  for (const [filePath, raw] of Object.entries(assetModules)) {
    const assetPath = filePath.match(/icons\/.+$/)?.[0];
    if (assetPath) assets.set(assetPath, stripSvgWrapper(raw));
  }
  return new Catalog(manifest, assets);
}
