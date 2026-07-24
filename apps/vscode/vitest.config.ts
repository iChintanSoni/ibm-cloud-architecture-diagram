import { defineConfig } from "vitest/config";

// "node", not "jsdom": the extension host is a plain Node process (no browser/webview DOM at
// all) — see packages/mcp/vitest.config.ts for the same reasoning. The webview side (webview/src)
// isn't unit-tested here; it reuses @icad/ui-web components already covered by that package's own
// jsdom test suite, and this shell's webview App.tsx is a thin port of apps/web's, which has its
// own jsdom + Playwright coverage.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
