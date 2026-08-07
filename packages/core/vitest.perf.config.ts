import { defineConfig } from "vitest/config";

/**
 * Runs only src/perf/benchmark.test.ts, alone, in a single fork — no file parallelism, no
 * sharing a machine with any other suite. Its budgets are wall-clock and only meaningful measured
 * this way (I18, docs/improvement-plan.md#i18--isolate-the-perf-benchmark-from-parallel-load).
 * Invoked by the `test:perf` script, kept out of the default `test` run (vitest.config.ts).
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/perf/benchmark.test.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
