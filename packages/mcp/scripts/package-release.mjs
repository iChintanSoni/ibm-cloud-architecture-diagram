import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Assembles the standalone "icad-mcp" release tarball via `pnpm deploy` — not a hand-rolled
// bundler. An earlier esbuild attempt (single self-contained JS file) hit three separate jsdom
// bundling failures in a row (a dynamic `require()` esbuild can't statically resolve, an empty
// `import.meta` in cjs output, and a `__dirname`-relative stylesheet asset load that has no
// equivalent once jsdom's own files aren't on disk anymore) — jsdom is not meant to be bundled.
// `pnpm deploy --prod --legacy` sidesteps all of that: it materializes this package with a real,
// normal node_modules (workspace deps resolved to real copies, not `workspace:*`), so module
// resolution works exactly like local dev. `--legacy` is required because this workspace doesn't
// set `inject-workspace-packages=true`.
//
// The one thing `pnpm deploy` doesn't know about: packages/catalog has no package.json, so it
// isn't a tracked dependency — src/catalog.ts reads it via a hardcoded `../../catalog/2.0.0`
// path relative to its own compiled location (see that file's doc comment). This script
// replicates that same sibling relationship (mcp/ + catalog/) so the existing lookup resolves
// unmodified. Confirmed end-to-end by actually running the deployed server standalone and
// sending it a real MCP `initialize` request, not just by the deploy command succeeding.
const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/package-release.mjs <version> [outDir]");
  process.exit(1);
}
const outDir = process.argv[3] ?? tmpdir();

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const pkgRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(pkgRoot, "../..");
const catalogSrc = path.join(repoRoot, "packages/catalog/2.0.0");

const staging = mkdtempSync(path.join(tmpdir(), "icad-mcp-release-"));
const deployDir = path.join(staging, "mcp");

execFileSync(
  "pnpm",
  ["--filter", "@icad/mcp", "deploy", "--prod", "--legacy", deployDir],
  { cwd: repoRoot, stdio: "inherit" },
);

const pkgJsonPath = path.join(deployDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
pkg.version = version;
delete pkg.devDependencies;
pkg.scripts = { start: "node dist/index.js" };
writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");

cpSync(catalogSrc, path.join(staging, "catalog/2.0.0"), { recursive: true });

writeFileSync(
  path.join(staging, "README.md"),
  `# icad-mcp v${version}\n\n` +
    "Standalone preview build of the ICAD MCP server. Run: `node mcp/dist/index.js`.\n" +
    "Keep `mcp/` and `catalog/` together — see mcp/README.md for full usage and MCP client " +
    "config.\n",
);

const outFile = path.join(outDir, `icad-mcp-v${version}.tar.gz`);
execFileSync("tar", ["-czf", outFile, "-C", staging, "."]);
console.log(outFile);
