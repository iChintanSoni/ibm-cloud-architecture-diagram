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

  /** Strips the catalog's own namespace prefix off an id before it's used for free-text search.
   * Every icon (and every legacy alias — old ids, which carry the same prefix) shares that
   * prefix (e.g. `ibm-cloud/`), so leaving it in the search haystack makes a query matching the
   * catalog's own id — like "cloud" — substring-match nearly every icon in the catalog,
   * regardless of relevance. */
  private stripNamespace(id: string): string {
    const prefix = `${this.manifest.id}/`;
    return id.startsWith(prefix)
      ? id.slice(prefix.length).replace(/-/g, " ")
      : id;
  }

  /**
   * Lower is more relevant. The icon's own name/id-slug is the primary signal — an exact or
   * prefix match there ranks above anything else, since keywords today are just that same name
   * tokenized into individual words by the catalog-build pipeline (no independent synonyms yet),
   * so a bare keyword-only match just means "one word of a longer, more generic name matched."
   * `undefined` means no match at all.
   *   0 — name or id-slug equals the query exactly
   *   1 — name or id-slug starts with the query
   *   2 — a keyword equals the query exactly, or the id-slug equals it word-for-word
   *   3 — name or id-slug contains the query anywhere
   *   4 — a keyword contains the query anywhere
   *   5 — a legacy alias (old id, kept searchable after a catalog-refresh rename) contains it
   */
  private matchScore(icon: IconMeta, q: string): number | undefined {
    const name = icon.name.toLowerCase();
    const slug = this.stripNamespace(icon.id).toLowerCase();
    const keywords = (icon.keywords ?? []).map((k) => k.toLowerCase());
    const aliases = (icon.aliases ?? []).map((a) =>
      this.stripNamespace(a).toLowerCase(),
    );

    if (name === q || slug === q) return 0;
    if (name.startsWith(q) || slug.startsWith(q)) return 1;
    if (keywords.includes(q)) return 2;
    if (name.includes(q) || slug.includes(q)) return 3;
    if (keywords.some((k) => k.includes(q))) return 4;
    if (aliases.some((a) => a.includes(q))) return 5;
    return undefined;
  }

  search(query: string): IconMeta[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.manifest.icons
      .map((icon) => ({ icon, score: this.matchScore(icon, q) }))
      .filter(
        (scored): scored is { icon: IconMeta; score: number } =>
          scored.score !== undefined,
      )
      .sort((a, b) => a.score - b.score)
      .map((scored) => scored.icon);
  }

  svg(id: string): string | undefined {
    const meta = this.resolve(id);
    if (!meta) return undefined;
    return this.assets.get(meta.asset);
  }
}
