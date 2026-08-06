import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import { runDiagramTask } from "./runDiagramTask.js";
import type { OrchestratorBundle } from "./orchestrator.js";

// Real MCP session (a real spawned @icad/mcp subprocess) + a fake orchestrator standing in for
// the LLM — exercises runDiagramTask's own gate/export logic for real, without needing a live
// model. `orchestratorFactory` is the injection point (mirrors IcadAgentExecutor's `runTask`).
//
// This specifically regression-tests a real bug found via live testing (docs/09-roadmap.md's
// M30 dogfooding findings): an empty document trivially passes lint() (nothing to flag), so a run
// where the orchestrator silently did nothing was reporting `success: true` with zero elements
// before the "document has content" check existed.

function fakeModel(): BaseLanguageModel {
  return {} as BaseLanguageModel;
}

/** An orchestrator whose "agent" never calls any tool at all — the scenario that slipped through
 * before the content-check fix. */
function orchestratorThatBuildsNothing(): Promise<OrchestratorBundle> {
  return Promise.resolve({
    agent: {
      invoke: async () => ({ messages: [] }),
    } as unknown as OrchestratorBundle["agent"],
    skillFiles: {},
  });
}

/** An orchestrator whose "agent" directly calls the real `element_add_box` tool it was handed
 * (bypassing any LLM decision-making) — simulates a real, successful build. */
function orchestratorThatAddsOneBox(options: {
  tools: readonly StructuredTool[];
}): Promise<OrchestratorBundle> {
  return Promise.resolve({
    agent: {
      invoke: async () => {
        const addBox = options.tools.find((t) => t.name === "element_add_box");
        if (!addBox) throw new Error("element_add_box not in the tool list");
        await addBox.invoke({
          at: { x: 0, y: 0 },
          w: 200,
          h: 120,
          label: "Test Box",
        });
        return { messages: [] };
      },
    } as unknown as OrchestratorBundle["agent"],
    skillFiles: {},
  });
}

describe("runDiagramTask's deterministic gate (docs/00-decision-log.md#d37)", () => {
  const icadPath = path.join(
    tmpdir(),
    `icad-agent-gate-test-${process.pid}.icad`,
  );
  const svgPath = path.join(
    tmpdir(),
    `icad-agent-gate-test-${process.pid}.svg`,
  );

  afterEach(async () => {
    await rm(icadPath, { force: true });
    await rm(svgPath, { force: true });
  });

  it("fails when the orchestrator produces zero elements, even though lint is trivially clean", async () => {
    const result = await runDiagramTask({
      requirement: "irrelevant — the fake orchestrator ignores it",
      level: "blank",
      outputIcadPath: icadPath,
      outputSvgPath: svgPath,
      model: fakeModel(),
      orchestratorFactory: orchestratorThatBuildsNothing,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("zero elements");
  });

  it("succeeds when the orchestrator actually builds something", async () => {
    const result = await runDiagramTask({
      requirement: "irrelevant — the fake orchestrator ignores it",
      level: "blank",
      outputIcadPath: icadPath,
      outputSvgPath: svgPath,
      model: fakeModel(),
      orchestratorFactory: orchestratorThatAddsOneBox,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.icadPath).toBe(icadPath);
    expect(result.svgPath).toBe(svgPath);
    expect(result.timing.totalMs).toBeGreaterThan(0);
  });
});
