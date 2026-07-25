import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optimize } from "svgo";
import { CATEGORY_BY_FOLDER, GROUPS_CATEGORY, SKIPPED_FOLDERS, SKIPPED_SUBPATHS } from "./categories.js";
import { extractDrawioLibraryIcons } from "./extractDrawioLibrary.js";
import { normalizeIcon } from "./extract.js";
import { slugify } from "./slug.js";

const UPSTREAM_REPO = "https://github.com/IBM-Cloud/architecture-icons.git";
// Pinned per D11 (docs/00-decision-log.md) for reproducible builds — bump deliberately,
// with IBM Design sign-off, per docs/04-icon-catalog.md "Versioning strategy".
const UPSTREAM_REF = "32d9c311b0dadb95f0fe4fa88b27f3af41c1dbc5";
const CATALOG_VERSION = "2.0.0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const CACHE_DIR = path.join(PACKAGE_ROOT, ".cache", "architecture-icons");
const CATALOG_ROOT = path.resolve(PACKAGE_ROOT, "..", "catalog", CATALOG_VERSION);

interface IconMeta {
  id: string;
  name: string;
  category: string;
  semantic: "node" | "actor";
  container: "square" | "rounded";
  color?: string;
  asset: string;
  keywords?: string[];
  tier: "ibm-cloud";
}

function ensureUpstreamCheckout(): string {
  if (!existsSync(path.join(CACHE_DIR, ".git"))) {
    mkdirSync(CACHE_DIR, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: CACHE_DIR });
    execFileSync("git", ["remote", "add", "origin", UPSTREAM_REPO], { cwd: CACHE_DIR });
  }
  console.log(`Fetching ${UPSTREAM_REPO}@${UPSTREAM_REF}...`);
  execFileSync("git", ["fetch", "--quiet", "--depth", "1", "origin", UPSTREAM_REF], {
    cwd: CACHE_DIR,
    stdio: "inherit"
  });
  execFileSync("git", ["checkout", "--quiet", "FETCH_HEAD"], { cwd: CACHE_DIR, stdio: "inherit" });
  return path.join(CACHE_DIR, "svg");
}

function listSvgFiles(dir: string, relativeTo: string, out: { abs: string; rel: string }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSvgFiles(abs, relativeTo, out);
    } else if (entry.name.toLowerCase().endsWith(".svg")) {
      out.push({ abs, rel: path.relative(relativeTo, abs) });
    }
  }
  return out;
}

const SVG_OPEN_TAG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20">';

function wrapForSvgo(fragment: string): string {
  return `${SVG_OPEN_TAG}${fragment}</svg>`;
}

// A few source icons use <clipPath>/<defs> with local #id references (e.g. VPC,
// Dedicated Host). SVGO's cleanupIds minifies those to short ids like "a" independently
// per file; if two such icons land on the same diagram, colliding ids would make one
// icon's clip-path resolve to the other's. Namespace every id by the icon's own slug
// after optimizing so ids stay unique across the whole bundled catalog.
function namespaceIds(svg: string, slug: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${slug}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${slug}-${id})`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_match, attr: string, id: string) => `${attr}="#${slug}-${id}"`);
}

function optimizeFragment(fragment: string, slug: string): string {
  const result = optimize(wrapForSvgo(fragment), {
    plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }]
  });
  const stripped = result.data.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
  return namespaceIds(stripped, slug);
}

function main() {
  const svgRoot = ensureUpstreamCheckout();

  if (existsSync(CATALOG_ROOT)) rmSync(CATALOG_ROOT, { recursive: true });
  mkdirSync(path.join(CATALOG_ROOT, "icons"), { recursive: true });

  const topFolders = readdirSync(svgRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  const icons: IconMeta[] = [];
  const seenSlugs = new Map<string, string>();
  let skippedNoBg = 0;
  let skippedDuped = 0;

  for (const folder of topFolders) {
    const category = CATEGORY_BY_FOLDER[folder.name];
    if (!category) {
      if (!SKIPPED_FOLDERS.has(folder.name)) {
        console.warn(`Unrecognized upstream folder "${folder.name}" — skipping. Update categories.ts if this is new.`);
      }
      continue;
    }

    const folderPath = path.join(svgRoot, folder.name);
    const files = listSvgFiles(folderPath, folderPath).sort((a, b) => a.rel.localeCompare(b.rel));

    for (const file of files) {
      const skipSubpath = SKIPPED_SUBPATHS.some((sub) => path.join(folder.name, file.rel).startsWith(sub));
      if (skipSubpath) continue;

      const baseName = path.basename(file.rel, ".svg");
      // Upstream mixes "Title Case With Spaces.svg" and "kebab--case.svg" filenames;
      // turn dash separators into spaces without guessing at acronym casing.
      const displayName = baseName.replace(/--+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
      const slug = slugify(baseName);
      if (!slug) continue;

      if (seenSlugs.has(slug)) {
        skippedDuped++;
        continue;
      }

      const xml = readFileSync(file.abs, "utf8");
      const normalized = normalizeIcon(xml);
      if (!normalized) {
        skippedNoBg++;
        continue;
      }
      seenSlugs.set(slug, file.abs);

      const optimized = optimizeFragment(normalized.fragment, slug);
      const assetRelPath = path.posix.join("icons", category.id, `${slug}.svg`);
      const outPath = path.join(CATALOG_ROOT, assetRelPath);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${SVG_OPEN_TAG}${optimized}</svg>\n`);

      const keywords = [...new Set(baseName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1))];

      icons.push({
        id: `ibm-cloud/${slug}`,
        name: displayName,
        category: category.id,
        semantic: normalized.rounded ? "actor" : "node",
        container: normalized.rounded ? "rounded" : "square",
        asset: assetRelPath,
        tier: "ibm-cloud",
        ...(normalized.color ? { color: normalized.color } : {}),
        ...(keywords.length ? { keywords } : {})
      });
    }
  }

  // Second extraction source (D23, docs/00-decision-log.md): icons embedded in the "IBM Not
  // Released In Drawio" stencil library, which has no `svg/<folder>` counterpart. Shares
  // `seenSlugs` with the pass above so a Groups-category glyph never shadows/duplicates an
  // already-emitted icon of the same slug.
  const drawioLibraryPath = path.join(CACHE_DIR, "drawio", "stencils", "2.0", "not_released_in_drawio.xml");
  let skippedGroupsDuped = 0;
  if (existsSync(drawioLibraryPath)) {
    for (const { title, normalized } of extractDrawioLibraryIcons(drawioLibraryPath)) {
      const slug = slugify(title);
      if (!slug || seenSlugs.has(slug)) {
        skippedGroupsDuped++;
        continue;
      }
      seenSlugs.set(slug, drawioLibraryPath);

      const optimized = optimizeFragment(normalized.fragment, slug);
      const assetRelPath = path.posix.join("icons", GROUPS_CATEGORY.id, `${slug}.svg`);
      const outPath = path.join(CATALOG_ROOT, assetRelPath);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${SVG_OPEN_TAG}${optimized}</svg>\n`);

      const keywords = [...new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1))];

      icons.push({
        id: `ibm-cloud/${slug}`,
        name: title,
        category: GROUPS_CATEGORY.id,
        semantic: normalized.rounded ? "actor" : "node",
        container: normalized.rounded ? "rounded" : "square",
        asset: assetRelPath,
        tier: "ibm-cloud",
        ...(normalized.color ? { color: normalized.color } : {}),
        ...(keywords.length ? { keywords } : {})
      });
    }
  } else {
    console.warn(
      `"not_released_in_drawio.xml" not found at ${drawioLibraryPath} — skipping Groups category extraction (D23).`
    );
  }

  const categories = Object.values(CATEGORY_BY_FOLDER)
    .filter((cat, i, arr) => arr.findIndex((c) => c.id === cat.id) === i)
    .filter((cat) => icons.some((icon) => icon.category === cat.id));
  if (icons.some((icon) => icon.category === GROUPS_CATEGORY.id)) {
    categories.push(GROUPS_CATEGORY);
  }

  const manifest = {
    id: "ibm-cloud",
    version: CATALOG_VERSION,
    upstream: { repo: "IBM-Cloud/architecture-icons", ref: UPSTREAM_REF },
    categories,
    icons: icons.sort((a, b) => a.id.localeCompare(b.id))
  };

  writeFileSync(path.join(CATALOG_ROOT, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Verify: schema-shape sanity + no duplicate ids + every icon has a name.
  const ids = new Set<string>();
  for (const icon of manifest.icons) {
    if (ids.has(icon.id)) throw new Error(`Duplicate icon id emitted: ${icon.id}`);
    ids.add(icon.id);
    if (!icon.name.trim()) throw new Error(`Icon ${icon.id} has no accessible name`);
    if (!existsSync(path.join(CATALOG_ROOT, icon.asset))) {
      throw new Error(`Icon ${icon.id} references missing asset ${icon.asset}`);
    }
  }

  console.log(`Wrote ${manifest.icons.length} icons across ${categories.length} categories to ${CATALOG_ROOT}`);
  console.log(
    `Skipped: ${skippedNoBg} without a detectable background tile, ${skippedDuped} duplicate slugs, ` +
      `${skippedGroupsDuped} Groups-category duplicate slugs.`
  );
}

main();
