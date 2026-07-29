import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Stamps the release version into tauri.conf.json right before `tauri build` runs in CI —
// ephemeral, never committed back to git. tauri.conf.json's own "version" (currently hardcoded
// 0.1.0) only matters for what gets baked into the built installer's metadata.
const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/apply-version.mjs <version>");
  process.exit(1);
}

const confPath = path.join(
  fileURLToPath(new URL("..", import.meta.url)),
  "src-tauri/tauri.conf.json",
);
const conf = JSON.parse(readFileSync(confPath, "utf-8"));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");
console.log(`${confPath} -> version ${version}`);
