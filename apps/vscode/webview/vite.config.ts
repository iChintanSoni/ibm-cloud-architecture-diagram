import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// This config is invoked via `vite build --config webview/vite.config.ts` from apps/vscode's cwd,
// so `root` must be resolved relative to *this file*, not the process cwd, or index.html won't be
// found when the build script runs from a different working directory.
const webviewDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: webviewDir,
  plugins: [react()],
  resolve: {
    alias: [
      // @ibm/plex's compiled CSS uses webpack's `~pkg/path` convention in font url()s; Vite
      // doesn't resolve that prefix on its own (same fix as apps/web/vite.config.ts).
      { find: /^~/, replacement: "" },
    ],
  },
  base: "./", // webview assets load from a vscode-webview-resource: origin, not site root
  build: {
    outDir: fileURLToPath(new URL("../dist/webview", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Fixed, non-hashed names: webviewHtml.ts references these directly rather than reading
        // a build manifest at runtime (there's exactly one webview bundle, not many routes).
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((name) => name.endsWith(".css"))
            ? "assets/index.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
