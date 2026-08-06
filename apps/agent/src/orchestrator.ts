import { createDeepAgent } from "deepagents";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import {
  buildConformanceExporterSubAgent,
  buildDiagramBuilderSubAgent,
} from "./subagents.js";
import type { SkillFile } from "./skills.js";

export interface OrchestratorOptions {
  model: BaseLanguageModel;
  /** Every MCP tool available on the current session — filtered down per sub-agent internally
   * (docs/00-decision-log.md#d33); the orchestrator itself gets none, see the system prompt. */
  tools: readonly StructuredTool[];
}

export interface OrchestratorBundle {
  agent: ReturnType<typeof createDeepAgent>;
  /** Skill file content for every sub-agent's declared `skills` source path. Must be merged into
   * the initial `.invoke()` state's `files` — the default ephemeral StateBackend
   * (docs/00-decision-log.md#d36) has nothing on real disk to load skills from. */
  skillFiles: Record<string, SkillFile>;
}

const SYSTEM_PROMPT = `You are the orchestrator for ICAD, an IBM Cloud architecture diagram \
agent. A document is already open in the underlying tool (either freshly created, or an existing \
one you may be asked to modify — the user message tells you which, and includes the current \
scene as JSON if this is a modification).

Delegate in order, using the task tool:
1. diagram-builder — give it the user's requirement or edit instruction verbatim, plus the \
current scene JSON if this is a modification. It builds or modifies the diagram's elements and \
connectors.
2. conformance-exporter — only after diagram-builder's task tool call has returned its result to \
you. It makes the diagram lint-clean.

These two steps are sequential and depend on each other — conformance-exporter validates what \
diagram-builder just built, so it cannot run first or at the same time. Call the task tool for \
diagram-builder ALONE, in a message with no other tool call, and wait for its result before your \
next message calls the task tool for conformance-exporter. Do NOT call both task tools in the same \
message — that is a real mistake, not a valid way to save time, since conformance-exporter would \
then be validating a diagram that does not exist yet.

You have no diagram-authoring tools yourself — your job is planning and delegation only, in that \
order, exactly once each. Exporting and saving happen afterward, outside of this conversation, \
using the real output paths directly — you never need to know or relay them. When \
conformance-exporter reports back, summarize what was built and whether any diagnostics remain; \
do not declare the task done yourself, the caller verifies that independently.`;

/** Builds the Deep Agent orchestrator + its two sub-agents (docs/11-agent-runtime.md). Async
 * because building each sub-agent reads its real SKILL.md files off disk (skills.ts). */
export async function createDiagramOrchestrator(
  options: OrchestratorOptions,
): Promise<OrchestratorBundle> {
  const [diagramBuilder, conformanceExporter] = await Promise.all([
    buildDiagramBuilderSubAgent(options.tools),
    buildConformanceExporterSubAgent(options.tools),
  ]);

  const agent = createDeepAgent({
    model: options.model,
    subagents: [diagramBuilder.subAgent, conformanceExporter.subAgent],
    systemPrompt: SYSTEM_PROMPT,
  });

  return {
    agent,
    skillFiles: {
      ...diagramBuilder.skillFiles,
      ...conformanceExporter.skillFiles,
    },
  };
}
