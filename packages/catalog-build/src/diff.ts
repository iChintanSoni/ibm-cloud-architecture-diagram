import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Just the manifest fields the diff needs — a subset of core's real `IconMeta`. */
export interface DiffableIcon {
  id: string;
  name: string;
  category: string;
  asset: string;
  aliases?: string[];
}

interface DiffableManifest {
  icons: DiffableIcon[];
}

export interface RenamedPair {
  from: DiffableIcon;
  to: DiffableIcon;
}

export interface CatalogDiffResult {
  added: DiffableIcon[];
  removed: DiffableIcon[];
  renamed: RenamedPair[];
}

function readManifest(dir: string): DiffableManifest {
  return JSON.parse(
    readFileSync(path.join(dir, "index.json"), "utf-8"),
  ) as DiffableManifest;
}

/**
 * Same glyph, different id — collapse away exactly the per-icon namespacing `build.ts`'s
 * `namespaceIds()` applies (`id="slug-x"`, `url(#slug-x)`, `href="#slug-x"`), so two otherwise
 * identical glyphs hash the same regardless of which slug they were namespaced under.
 */
function canonicalizeGlyph(svg: string): string {
  return svg
    .replace(/\bid="[^"]*"/g, 'id="ID"')
    .replace(/url\(#[^)]*\)/g, "url(#ID)")
    .replace(/(xlink:href|href)="#[^"]*"/g, '$1="#ID"');
}

function glyphHash(dir: string, icon: DiffableIcon): string {
  const raw = readFileSync(path.join(dir, icon.asset), "utf-8");
  return createHash("sha256").update(canonicalizeGlyph(raw)).digest("hex");
}

/**
 * Compares two on-disk catalog directories (each a `packages/catalog/<version>/`, i.e. an
 * `index.json` + `icons/**` produced by `build.ts`) and reports added/removed/renamed icons.
 *
 * Rename detection is deliberately conservative: an icon only counts as renamed when its glyph
 * content, with per-icon id-namespacing normalized away, is byte-identical to exactly one
 * candidate in the same category on the other side. A real visual tweak alongside a rename won't
 * be caught here — it shows up as one removal + one addition instead, left for a human to judge
 * rather than guessed at via name similarity.
 */
export function diffCatalogs(
  oldDir: string,
  newDir: string,
): CatalogDiffResult {
  const oldManifest = readManifest(oldDir);
  const newManifest = readManifest(newDir);

  const newIds = new Set(newManifest.icons.map((icon) => icon.id));
  const oldIds = new Set(oldManifest.icons.map((icon) => icon.id));

  const removedCandidates = oldManifest.icons.filter(
    (icon) => !newIds.has(icon.id),
  );
  const addedCandidates = newManifest.icons.filter(
    (icon) => !oldIds.has(icon.id),
  );

  const addedByHash = new Map<string, DiffableIcon[]>();
  for (const icon of addedCandidates) {
    const key = `${icon.category}:${glyphHash(newDir, icon)}`;
    addedByHash.set(key, [...(addedByHash.get(key) ?? []), icon]);
  }

  const renamed: RenamedPair[] = [];
  const matchedAddedIds = new Set<string>();
  for (const removedIcon of removedCandidates) {
    const key = `${removedIcon.category}:${glyphHash(oldDir, removedIcon)}`;
    const candidates = (addedByHash.get(key) ?? []).filter(
      (candidate) => !matchedAddedIds.has(candidate.id),
    );
    if (candidates.length === 1) {
      const to = candidates[0]!;
      renamed.push({ from: removedIcon, to });
      matchedAddedIds.add(to.id);
    }
  }

  const renamedFromIds = new Set(renamed.map((pair) => pair.from.id));
  const renamedToIds = new Set(renamed.map((pair) => pair.to.id));

  return {
    added: addedCandidates.filter((icon) => !renamedToIds.has(icon.id)),
    removed: removedCandidates.filter((icon) => !renamedFromIds.has(icon.id)),
    renamed,
  };
}

/**
 * Writes each renamed pair's old id into the new manifest's `aliases` array, so a `.icad` file
 * authored against the old catalog version keeps resolving via `Catalog.resolve()`'s existing
 * aliases fallback (packages/core/src/catalog/catalog.ts) — no `.icad` migration involved (D29,
 * docs/decision-log.md). Returns the number of icons actually updated.
 */
export function applyAliasesForRenames(
  newManifestPath: string,
  renamed: RenamedPair[],
): number {
  if (renamed.length === 0) return 0;
  const manifest = JSON.parse(readFileSync(newManifestPath, "utf-8")) as {
    icons: DiffableIcon[];
  };
  let changed = 0;
  for (const { from, to } of renamed) {
    const icon = manifest.icons.find((candidate) => candidate.id === to.id);
    if (!icon) continue;
    const aliases = icon.aliases ?? [];
    if (!aliases.includes(from.id)) {
      icon.aliases = [...aliases, from.id];
      changed += 1;
    }
  }
  if (changed > 0) {
    writeFileSync(newManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return changed;
}
