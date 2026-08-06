import { defineConfig } from "vitest/config";

// Live-LLM integration tests: a real Ollama server, a real spawned @icad/mcp subprocess, a real
// multi-step agentic run. Minutes, not milliseconds — kept out of the default `test` script
// (vitest.config.ts) so normal development stays fast and doesn't require Ollama to be running.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
