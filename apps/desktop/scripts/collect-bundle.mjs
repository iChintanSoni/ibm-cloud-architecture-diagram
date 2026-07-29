import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Finds the bundle `tauri build` just produced and copies it to <outDir> under a stable,
// download-page-friendly name: icad-desktop-vX.Y.Z-<platformArch>.<ext>. Tauri's own output
// filename embeds productName/version/arch in a format that varies slightly by OS
// (e.g. "ICAD_0.1.0_aarch64.dmg"), so this locates it by directory + extension rather than
// hardcoding the name.
//
// Only the macOS/dmg case has actually been run (see docs/guide/04-desktop-app.md's M21 update);
// the windows/msi and linux/appimage entries below follow Tauri's documented, consistent
// `target/release/bundle/<format>/` layout but are unverified until a real CI run exercises them
// — that's covered by M21.5's end-to-end tag-push verification, not by this script alone.
const targets = {
  "darwin-arm64": { dir: "dmg", ext: ".dmg", label: "macos-arm64" },
  "win32-x64": { dir: "msi", ext: ".msi", label: "windows-x64" },
  "linux-x64": { dir: "appimage", ext: ".AppImage", label: "linux-x64" },
};

const version = process.argv[2];
const outDir = process.argv[3];
if (!version || !outDir) {
  console.error("Usage: node scripts/collect-bundle.mjs <version> <outDir>");
  process.exit(1);
}

const key = `${process.platform}-${process.arch}`;
const target = targets[key];
if (!target) {
  console.error(
    `No known bundle target for ${key}. Known: ${Object.keys(targets).join(", ")}`,
  );
  process.exit(1);
}

const bundleDir = path.join(
  fileURLToPath(new URL("..", import.meta.url)),
  "src-tauri/target/release/bundle",
  target.dir,
);
const match = readdirSync(bundleDir).find((f) => f.endsWith(target.ext));
if (!match) {
  console.error(`No ${target.ext} file found in ${bundleDir}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const destName = `icad-desktop-v${version}-${target.label}${target.ext}`;
const dest = path.join(outDir, destName);
copyFileSync(path.join(bundleDir, match), dest);
console.log(dest);
