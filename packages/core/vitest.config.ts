import { defineConfig } from "vitest/config";

/**
 * Excludes src/perf/benchmark.test.ts from the default `test` run (see vitest.perf.config.ts) —
 * it asserts wall-clock budgets, which are only meaningful run alone. Under `pnpm -r test`,
 * six package suites run concurrently and starve it, so it fails on `loadMs` at every size
 * regardless of the code under test (I18, docs/improvement-plan.md#i18--isolate-the-perf-benchmark-from-parallel-load)
 * — a broken signal is worse than no signal, since it teaches everyone to ignore the one test
 * guarding against an O(n²) regression creeping back into a hot path.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/perf/benchmark.test.ts"],
  },
});
