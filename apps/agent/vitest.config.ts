import { defineConfig } from "vitest/config";

// "node", not "jsdom": this package only ever talks to @icad/mcp over a real child-process
// stdio pipe (see mcpSession.ts) — there's no DOM anywhere in this package's own code.
// *.int.test.ts (live-LLM integration tests, e.g. runDiagramTask.int.test.ts) are excluded from
// the default run — same convention langchain-ai/deepagentsjs itself uses (.test.ts vs
// .int.test.ts) — and live behind the separate `test:int` script instead, since they need a real
// Ollama server + downloaded model and can take minutes, not milliseconds.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "**/node_modules/**"],
  },
});
