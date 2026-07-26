import type { CatalogManifest, IconMeta } from "./types.js";

/**
 * Runtime view over a bundled icon catalog (see docs/04-icon-catalog.md).
 * The manifest and assets are injected rather than imported directly, so
 * `core` has no build-time dependency on `packages/catalog` — a shell
 * decides which catalog version to load.
 *
 * Each asset is an SVG *fragment* (inner shape markup, no outer <svg>),
 * normalized to a 24x24 viewBox by the catalog-build pipeline (GLYPH_VIEWBOX
 * in packages/catalog-build/src/extract.ts, GLYPH_VIEWBOX_SIZE in
 * packages/core/src/render/svgRenderer.ts — all three must agree).
 */
export class Catalog {
  constructor(
    private manifest: CatalogManifest,
    private assets: Map<string, string>,
  ) {}

  get id(): string {
    return this.manifest.id;
  }

  get version(): string {
    return this.manifest.version;
  }

  categories() {
    return this.manifest.categories;
  }

  byCategory(categoryId: string): IconMeta[] {
    return this.manifest.icons.filter((icon) => icon.category === categoryId);
  }

  resolve(id: string): IconMeta | undefined {
    const direct = this.manifest.icons.find((icon) => icon.id === id);
    if (direct) return direct;
    return this.manifest.icons.find((icon) => icon.aliases?.includes(id));
  }

  search(query: string): IconMeta[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.manifest.icons.filter((icon) => {
      const haystack = [
        icon.id,
        icon.name,
        ...(icon.keywords ?? []),
        ...(icon.aliases ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  svg(id: string): string | undefined {
    const meta = this.resolve(id);
    if (!meta) return undefined;
    return this.assets.get(meta.asset);
  }
}
