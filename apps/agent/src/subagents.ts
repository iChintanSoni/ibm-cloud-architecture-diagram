import { createDeepAgent } from "deepagents";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import {
  CONFORMANCE_EXPORTER_TOOL_NAMES,
  DIAGRAM_BUILDER_TOOL_NAMES,
  pickTools,
} from "./tools.js";
import { loadSkillFiles, skillSourcePath, type SkillFile } from "./skills.js";

export interface AgentBundle {
  agent: ReturnType<typeof createDeepAgent>;
  /** `files` entries (the loaded SKILL.md content) to merge into this agent's initial `.invoke()`
   * state, so its declared `skills` source path resolves to real content on the default ephemeral
   * StateBackend (docs/00-decision-log.md#d36). */
  skillFiles: Record<string, SkillFile>;
}

export interface AgentBuilderOptions {
  model: BaseLanguageModel;
  /** Every MCP tool available on the current session — filtered down to this agent's own subset
   * internally (docs/00-decision-log.md#d33). */
  tools: readonly StructuredTool[];
}

const DIAGRAM_BUILDER_PROMPT = `You are the diagram-builder agent for ICAD, an IBM Cloud \
architecture diagram tool. You build or modify one diagram's elements and connectors by calling \
the ICAD MCP authoring tools you've been given, guided by the ibm-diagram-authoring and \
ibm-diagram-spec skills — read them before you start.

A document is already open (either a fresh one, or an existing one you may be asked to modify —
check your task instructions for the current scene, if any). Resolve every icon via
catalog_search; never invent a catalogRef. Model deployedOn/deployedTo containment correctly,
build outside-in, lay out west→east, and use the right IBM connector type.

For the initial build of a section, prefer one scene_apply call over many individual
element_add_*/connect* calls — batch every container, icon, actor, and connector for that section
into a single scene_apply({ ops: [...] }) call instead of one tool call per element. It commits as
one undo step and is far fewer round-trips than building the same topology one element at a time.
Reach for individual element_add_*/connect*/connect_nearest calls for later single-element
touch-ups, not the initial build. See the ibm-diagram-authoring skill's worked example.

Build the requested topology exactly once. Before adding any element, briefly recall what you've
already added earlier in this same conversation — do not guess or restart from scratch. Adding a
second copy of something you already built is a real mistake, not a safe default.

You must actually call scene_apply/element_add_*/connect* tools before reporting completion —
reporting that you built something without having called any authoring tool at all is a failure,
not a valid outcome. If you are ever unsure how to proceed, make your best attempt using the
skills you were given rather than stopping early.

Do not run lint, apply quick-fixes, or export — the caller handles conformance and export outside
this conversation. When you've finished building or modifying the elements the task asked for,
report back a short summary of what you added or changed and then stop.`;

const CONFORMANCE_EXPORTER_PROMPT = `You are the conformance-exporter agent for ICAD, an IBM \
Cloud architecture diagram tool. A diagram has just been built or modified, and an automatic \
quick-fix pass has already run and resolved everything it could — your task message tells you \
exactly which error-severity diagnostics remain and still need real judgment. Guided by the \
ibm-diagram-export and ibm-diagram-spec skills — read them before you start.

The diagram is NOT a file on disk and there is nothing to search for. It already exists as the
currently-open document inside the ICAD MCP server's own state. lint(), quickfix_apply(), and
quickfix_apply_all() all take no path argument — call them directly, with no arguments, exactly as
documented. Do not use glob/ls/read_file/grep (those search this conversation's own unrelated
scratch filesystem, not the diagram) or ask the user where the file is — there is no file yet at
this point, and none of your tools need one.

Resolve the remaining diagnostics using targeted quickfix_apply where available, or by fixing the
underlying issue directly through the tools you have; call lint() again after each attempt to
confirm. You do not export or save — the caller does that itself once you're done, using the real
output paths directly (not relayed through you). Report back a short summary of what you fixed and
any error-severity diagnostics that still remain — the caller runs its own final check and will
not trust a diagram you report as clean without verifying it independently, so be honest about
what's still broken rather than optimistic.`;

/** Builds diagram-builder as a standalone Deep Agent (not a sub-agent behind a `task`-tool
 * delegation layer) — invoked directly by `runDiagramTask`. Async because it reads its real
 * SKILL.md files off disk (skills.ts). */
export async function buildDiagramBuilderAgent(
  options: AgentBuilderOptions,
): Promise<AgentBundle> {
  const skillFiles = await loadSkillFiles("diagram-builder", [
    "ibm-diagram-authoring",
    "ibm-diagram-spec",
  ]);
  const agent = createDeepAgent({
    model: options.model,
    tools: pickTools(options.tools, DIAGRAM_BUILDER_TOOL_NAMES),
    systemPrompt: DIAGRAM_BUILDER_PROMPT,
    skills: [skillSourcePath("diagram-builder")],
  });
  return { agent, skillFiles };
}

/** Builds conformance-exporter as a standalone Deep Agent, invoked directly by `runDiagramTask`
 * — and only when procedural quick-fixing alone didn't reach zero errors (docs/00-decision-log.md#d33's
 * amendment for M30.3): the two agents are no longer delegated between by an orchestrator LLM,
 * since the choice of whether conformance-exporter runs at all is now fully deterministic. */
export async function buildConformanceExporterAgent(
  options: AgentBuilderOptions,
): Promise<AgentBundle> {
  const skillFiles = await loadSkillFiles("conformance-exporter", [
    "ibm-diagram-export",
    "ibm-diagram-spec",
  ]);
  const agent = createDeepAgent({
    model: options.model,
    tools: pickTools(options.tools, CONFORMANCE_EXPORTER_TOOL_NAMES),
    systemPrompt: CONFORMANCE_EXPORTER_PROMPT,
    skills: [skillSourcePath("conformance-exporter")],
  });
  return { agent, skillFiles };
}
