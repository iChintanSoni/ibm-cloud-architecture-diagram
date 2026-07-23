import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // e2e/ holds Playwright specs (playwright.config.ts) — they use a different test runner
    // and globals, so keep them out of Vitest's default include glob.
    include: ["src/**/*.test.{ts,tsx}"]
  },
  resolve: {
    alias: [
      // @ibm/plex's compiled CSS uses webpack's `~pkg/path` convention in
      // font url()s; Vite doesn't resolve that prefix on its own.
      { find: /^~/, replacement: "" }
    ]
  }
});
