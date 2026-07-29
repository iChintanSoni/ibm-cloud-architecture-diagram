import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAliasesForRenames,
  type DiffableIcon,
  diffCatalogs,
} from "./diff.js";

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">';

/** Mirrors build.ts's real on-disk shape: an index.json + icons/<category>/<slug>.svg tree. */
function writeCatalogDir(
  dir: string,
  icons: (DiffableIcon & { glyph: string })[],
) {
  mkdirSync(dir, { recursive: true });
  for (const icon of icons) {
    const assetPath = path.join(dir, icon.asset);
    mkdirSync(path.dirname(assetPath), { recursive: true });
    writeFileSync(assetPath, `${SVG_OPEN}${icon.glyph}</svg>\n`);
  }
  const manifestIcons = icons.map(({ glyph: _glyph, ...icon }) => icon);
  writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify(
      { id: "ibm-cloud", version: "test", icons: manifestIcons },
      null,
      2,
    ),
  );
}

let oldDir: string;
let newDir: string;

beforeEach(() => {
  const root = mkdtempSync(path.join(tmpdir(), "icad-catalog-diff-"));
  oldDir = path.join(root, "old");
  newDir = path.join(root, "new");
});

describe("diffCatalogs", () => {
  it("leaves an unchanged icon out of every bucket", () => {
    const shared: DiffableIcon & { glyph: string } = {
      id: "ibm-cloud/vpc",
      name: "VPC",
      category: "network",
      asset: "icons/network/vpc.svg",
      glyph: '<path id="vpc-a" d="M1 1L2 2Z"/>',
    };
    writeCatalogDir(oldDir, [shared]);
    writeCatalogDir(newDir, [shared]);

    const result = diffCatalogs(oldDir, newDir);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.renamed).toEqual([]);
  });

  it("reports a genuinely new icon as added", () => {
    writeCatalogDir(oldDir, []);
    writeCatalogDir(newDir, [
      {
        id: "ibm-cloud/brand-new",
        name: "Brand New",
        category: "compute",
        asset: "icons/compute/brand-new.svg",
        glyph: '<path id="brand-new-a" d="M9 9L8 8Z"/>',
      },
    ]);

    const result = diffCatalogs(oldDir, newDir);
    expect(result.added.map((i) => i.id)).toEqual(["ibm-cloud/brand-new"]);
    expect(result.removed).toEqual([]);
    expect(result.renamed).toEqual([]);
  });

  it("reports an icon dropped from the new catalog as removed", () => {
    writeCatalogDir(oldDir, [
      {
        id: "ibm-cloud/gone",
        name: "Gone",
        category: "compute",
        asset: "icons/compute/gone.svg",
        glyph: '<path id="gone-a" d="M3 3L4 4Z"/>',
      },
    ]);
    writeCatalogDir(newDir, []);

    const result = diffCatalogs(oldDir, newDir);
    expect(result.removed.map((i) => i.id)).toEqual(["ibm-cloud/gone"]);
    expect(result.added).toEqual([]);
    expect(result.renamed).toEqual([]);
  });

  it("matches a renamed icon by identical glyph content, ignoring id namespacing", () => {
    writeCatalogDir(oldDir, [
      {
        id: "ibm-cloud/old-name",
        name: "Old Name",
        category: "compute",
        asset: "icons/compute/old-name.svg",
        glyph:
          '<path id="old-name-a" d="M5 5L6 6Z" fill="url(#old-name-b)"/><rect href="#old-name-b"/>',
      },
    ]);
    writeCatalogDir(newDir, [
      {
        id: "ibm-cloud/new-name",
        name: "New Name",
        category: "compute",
        asset: "icons/compute/new-name.svg",
        // Same geometry, but re-namespaced under a different slug — exactly what
        // build.ts's namespaceIds() does for the same glyph across two runs.
        glyph:
          '<path id="new-name-a" d="M5 5L6 6Z" fill="url(#new-name-b)"/><rect href="#new-name-b"/>',
      },
    ]);

    const result = diffCatalogs(oldDir, newDir);
    expect(result.renamed).toEqual([
      {
        from: expect.objectContaining({ id: "ibm-cloud/old-name" }),
        to: expect.objectContaining({ id: "ibm-cloud/new-name" }),
      },
    ]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("does not match a rename across different categories", () => {
    writeCatalogDir(oldDir, [
      {
        id: "ibm-cloud/cross-cat",
        name: "Cross Cat",
        category: "security",
        asset: "icons/security/cross-cat.svg",
        glyph: '<path id="cross-cat-a" d="M7 7L8 8Z"/>',
      },
    ]);
    writeCatalogDir(newDir, [
      {
        id: "ibm-cloud/cross-cat-new",
        name: "Cross Cat New",
        category: "network",
        asset: "icons/network/cross-cat-new.svg",
        glyph: '<path id="cross-cat-new-a" d="M7 7L8 8Z"/>',
      },
    ]);

    const result = diffCatalogs(oldDir, newDir);
    expect(result.renamed).toEqual([]);
    expect(result.added.map((i) => i.id)).toEqual(["ibm-cloud/cross-cat-new"]);
    expect(result.removed.map((i) => i.id)).toEqual(["ibm-cloud/cross-cat"]);
  });

  it("leaves an ambiguous match (two candidates, one glyph) as added+removed rather than guessing", () => {
    writeCatalogDir(oldDir, [
      {
        id: "ibm-cloud/dup-source",
        name: "Dup Source",
        category: "network",
        asset: "icons/network/dup-source.svg",
        glyph: '<path id="dup-source-a" d="M1 2L3 4Z"/>',
      },
    ]);
    writeCatalogDir(newDir, [
      {
        id: "ibm-cloud/dup-a",
        name: "Dup A",
        category: "network",
        asset: "icons/network/dup-a.svg",
        glyph: '<path id="dup-a-a" d="M1 2L3 4Z"/>',
      },
      {
        id: "ibm-cloud/dup-b",
        name: "Dup B",
        category: "network",
        asset: "icons/network/dup-b.svg",
        glyph: '<path id="dup-b-a" d="M1 2L3 4Z"/>',
      },
    ]);

    const result = diffCatalogs(oldDir, newDir);
    expect(result.renamed).toEqual([]);
    expect(result.removed.map((i) => i.id)).toEqual(["ibm-cloud/dup-source"]);
    expect(result.added.map((i) => i.id).sort()).toEqual([
      "ibm-cloud/dup-a",
      "ibm-cloud/dup-b",
    ]);
  });
});

describe("applyAliasesForRenames", () => {
  it("writes the old id into the new manifest's matched icon as an alias", () => {
    writeCatalogDir(newDir, [
      {
        id: "ibm-cloud/new-name",
        name: "New Name",
        category: "compute",
        asset: "icons/compute/new-name.svg",
        glyph: '<path id="new-name-a" d="M5 5L6 6Z"/>',
      },
    ]);
    const manifestPath = path.join(newDir, "index.json");

    const changed = applyAliasesForRenames(manifestPath, [
      {
        from: {
          id: "ibm-cloud/old-name",
          name: "Old Name",
          category: "compute",
          asset: "icons/compute/old-name.svg",
        },
        to: {
          id: "ibm-cloud/new-name",
          name: "New Name",
          category: "compute",
          asset: "icons/compute/new-name.svg",
        },
      },
    ]);

    expect(changed).toBe(1);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      icons: DiffableIcon[];
    };
    expect(manifest.icons[0]?.aliases).toEqual(["ibm-cloud/old-name"]);
  });

  it("is idempotent — re-running doesn't duplicate the alias", () => {
    writeCatalogDir(newDir, [
      {
        id: "ibm-cloud/new-name",
        name: "New Name",
        category: "compute",
        asset: "icons/compute/new-name.svg",
        glyph: '<path id="new-name-a" d="M5 5L6 6Z"/>',
      },
    ]);
    const manifestPath = path.join(newDir, "index.json");
    const pairs = [
      {
        from: {
          id: "ibm-cloud/old-name",
          name: "Old Name",
          category: "compute",
          asset: "icons/compute/old-name.svg",
        },
        to: {
          id: "ibm-cloud/new-name",
          name: "New Name",
          category: "compute",
          asset: "icons/compute/new-name.svg",
        },
      },
    ];

    applyAliasesForRenames(manifestPath, pairs);
    const secondRunChanged = applyAliasesForRenames(manifestPath, pairs);

    expect(secondRunChanged).toBe(0);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
      icons: DiffableIcon[];
    };
    expect(manifest.icons[0]?.aliases).toEqual(["ibm-cloud/old-name"]);
  });
});
