import { defineConfig } from "vitest/config";

// "node", not "jsdom": this package only ever talks to @icad/mcp over a real child-process
// stdio pipe (see mcpSession.ts) — there's no DOM anywhere in this package's own code.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
