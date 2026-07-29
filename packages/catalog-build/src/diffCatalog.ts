import path from "node:path";
import { applyAliasesForRenames, diffCatalogs } from "./diff.js";

function describe(icon: { id: string; name: string }): string {
  return `${icon.id} (${icon.name})`;
}

function main() {
  const [oldDirArg, newDirArg, ...flags] = process.argv.slice(2);
  if (!oldDirArg || !newDirArg) {
    console.error(
      "Usage: diff-catalog <oldCatalogDir> <newCatalogDir> [--apply-aliases]",
    );
    process.exitCode = 1;
    return;
  }

  const oldDir = path.resolve(oldDirArg);
  const newDir = path.resolve(newDirArg);
  const result = diffCatalogs(oldDir, newDir);

  console.log(`Comparing ${oldDir}\n            -> ${newDir}\n`);

  console.log(`Renamed (exact glyph match), ${result.renamed.length}:`);
  for (const { from, to } of result.renamed) {
    console.log(`  ${describe(from)} -> ${describe(to)}`);
  }

  console.log(`\nAdded, ${result.added.length}:`);
  for (const icon of result.added) console.log(`  ${describe(icon)}`);

  console.log(`\nRemoved, ${result.removed.length}:`);
  for (const icon of result.removed) console.log(`  ${describe(icon)}`);
  if (result.removed.length > 0) {
    console.log(
      "  (a removal with no confident rename match — review manually before adopting;\n" +
        "   a genuine removal will silently placeholder-fallback for any file that references it,\n" +
        "   see docs/04-icon-catalog.md and the catalog-version-mismatch/non-catalog-icon lint rules)",
    );
  }

  if (flags.includes("--apply-aliases")) {
    const newManifestPath = path.join(newDir, "index.json");
    const changed = applyAliasesForRenames(newManifestPath, result.renamed);
    console.log(
      `\nWrote ${changed} alias entr${changed === 1 ? "y" : "ies"} into ${newManifestPath}`,
    );
  }
}

main();
