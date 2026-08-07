import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser accessibility + keyboard E2E checks (packages/core/docs/accessibility.md#testing--ci):
 * jsdom (packages/ui-web/src/a11y.test.tsx) can't evaluate layout-dependent rules like
 * color-contrast, and can't drive real Tab-key focus traversal at all. These run against an
 * actual Chromium instance instead.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
