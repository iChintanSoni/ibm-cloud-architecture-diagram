import type { Catalog, CatalogCategory, IconMeta } from "@icad/core";

export interface IconGroup {
  category: CatalogCategory;
  icons: IconMeta[];
}

export function groupLibraryIcons(
  catalog: Catalog,
  query: string,
): IconGroup[] {
  const normalized = query.trim();
  const matches = normalized
    ? catalog.search(normalized)
    : catalog
        .categories()
        .flatMap((category) => catalog.byCategory(category.id));
  const ids = new Set(matches.map((icon) => icon.id));

  return catalog.categories().flatMap((category) => {
    const icons = catalog
      .byCategory(category.id)
      .filter((icon) => ids.has(icon.id));
    return icons.length > 0 ? [{ category, icons }] : [];
  });
}
