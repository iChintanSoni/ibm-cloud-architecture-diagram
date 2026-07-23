export type IconTier = "ibm-core" | "ibm-cloud" | "domains" | "third-party";

export interface IconMeta {
  id: string;
  name: string;
  category: string;
  semantic: "node" | "actor";
  container: "square" | "rounded";
  color?: string;
  /** Path/key used to look up the icon's SVG fragment in the assets map. */
  asset: string;
  keywords?: string[];
  aliases?: string[];
  tier?: IconTier;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

export interface CatalogManifest {
  id: string;
  version: string;
  categories: CatalogCategory[];
  icons: IconMeta[];
}
