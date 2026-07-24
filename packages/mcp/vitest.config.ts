import { defineConfig } from "vitest/config";

// "node", not "jsdom": this package's own jsdom bootstrap (src/headlessEditor.ts) is exactly the
// thing under test. A jsdom test environment would supply an ambient `document` before that
// bootstrap ever ran, masking bugs in it instead of exercising the real standalone-process path.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
