import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import { runDiagramTask } from "./runDiagramTask.js";
import type { AgentBundle } from "./subagents.js";

// Real MCP session (a real spawned @icad/mcp subprocess) + fake agents standing in for the LLM —
// exercises runDiagramTask's own gate/quick-fix/export logic for real, without needing a live
// model. `diagramBuilderFactory`/`conformanceExporterFactory` are the injection points (mirror
// IcadAgentExecutor's `runTask` injection).
//
// This specifically regression-tests two real bugs found via live testing
// (docs/09-roadmap.md's M30 dogfooding findings):
//   - An empty document trivially passes lint() (nothing to flag), so a run where the agent
//     silently did nothing was reporting `success: true` with zero elements before the
//     "document has content" check existed (finding #6).
//   - M30.3's procedural quick-fix pass should make conformance-exporter's LLM invocation
//     conditional — never called at all when the automatic pass alone reaches zero errors.

function fakeModel(): BaseLanguageModel {
  return {} as BaseLanguageModel;
}

function agentThatBuildsNothing(): Promise<AgentBundle> {
  return Promise.resolve({
    agent: {
      invoke: async () => ({ messages: [] }),
    } as unknown as AgentBundle["agent"],
    skillFiles: {},
  });
}

function agentThatAddsOneBox(options: {
  tools: readonly StructuredTool[];
}): Promise<AgentBundle> {
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
    } as unknown as AgentBundle["agent"],
    skillFiles: {},
  });
}

function agentThatThrowsIfCalled(): Promise<AgentBundle> {
  return Promise.resolve({
    agent: {
      invoke: async () => {
        throw new Error("conformance-exporter should not have been invoked");
      },
    } as unknown as AgentBundle["agent"],
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

  it("fails when diagram-builder produces zero elements, even though lint is trivially clean", async () => {
    const result = await runDiagramTask({
      requirement: "irrelevant — the fake agent ignores it",
      level: "blank",
      outputIcadPath: icadPath,
      outputSvgPath: svgPath,
      model: fakeModel(),
      diagramBuilderFactory: agentThatBuildsNothing,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toContain("zero elements");
  });

  it("succeeds and never invokes conformance-exporter when the procedural quick-fix pass alone reaches zero errors (M30.3)", async () => {
    const result = await runDiagramTask({
      requirement: "irrelevant — the fake agent ignores it",
      level: "blank",
      outputIcadPath: icadPath,
      outputSvgPath: svgPath,
      model: fakeModel(),
      diagramBuilderFactory: agentThatAddsOneBox,
      conformanceExporterFactory: agentThatThrowsIfCalled,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.icadPath).toBe(icadPath);
    expect(result.svgPath).toBe(svgPath);
    expect(result.timing.totalMs).toBeGreaterThan(0);
    expect(result.timing.conformanceExporterMs).toBeUndefined();
  });
});
