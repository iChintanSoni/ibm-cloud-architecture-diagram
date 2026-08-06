import type { StructuredTool } from "@langchain/core/tools";
import type { SubAgent } from "deepagents";
import {
  CONFORMANCE_EXPORTER_TOOL_NAMES,
  DIAGRAM_BUILDER_TOOL_NAMES,
  pickTools,
} from "./tools.js";
import { loadSkillFiles, skillSourcePath, type SkillFile } from "./skills.js";

export interface SubAgentBundle {
  subAgent: SubAgent;
  /** Extra `files` entries (the loaded SKILL.md content) to merge into the orchestrator's
   * initial invoke state, so this sub-agent's `skills` source path resolves to real content on
   * the shared ephemeral StateBackend (docs/00-decision-log.md#d36). */
  skillFiles: Record<string, SkillFile>;
}

const DIAGRAM_BUILDER_PROMPT = `You are the diagram-builder sub-agent for ICAD, an IBM Cloud \
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

Do not run lint, apply quick-fixes, or export — that is the conformance-exporter sub-agent's job,
not yours. When you've finished building or modifying the elements the task asked for, report
back a short summary of what you added or changed.`;

const CONFORMANCE_EXPORTER_PROMPT = `You are the conformance-exporter sub-agent for ICAD, an IBM \
Cloud architecture diagram tool. The diagram-builder sub-agent has just finished building or \
modifying a diagram; your job is to make it conformant, guided by the ibm-diagram-export and \
ibm-diagram-spec skills — read them before you start.

The diagram is NOT a file on disk and there is nothing to search for. It already exists as the
currently-open document inside the ICAD MCP server's own state. lint(), quickfix_apply(), and
quickfix_apply_all() all take no path argument — call them directly, with no arguments, exactly as
documented. Do not use glob/ls/read_file/grep (those search this conversation's own unrelated
scratch filesystem, not the diagram) or ask the user where the file is — there is no file yet at
this point, and none of your tools need one.

Loop: call lint(), then quickfix_apply_all() (or targeted quickfix_apply for specific
diagnostics), then lint() again — repeat until no further quick-fix resolves anything. Diagnostics
that still have no quick-fix and are error-severity should be reported, not left silently unfixed.

You do not export or save — the caller does that itself once you're done, using the real output
paths directly (not relayed through you). Report back a short summary of what you fixed and any
error-severity diagnostics that remain — the caller runs its own final check and will not trust a
diagram you report as clean without verifying it independently, so be honest about what's still
broken rather than optimistic.`;

export async function buildDiagramBuilderSubAgent(
  tools: readonly StructuredTool[],
): Promise<SubAgentBundle> {
  const skillFiles = await loadSkillFiles("diagram-builder", [
    "ibm-diagram-authoring",
    "ibm-diagram-spec",
  ]);
  return {
    subAgent: {
      name: "diagram-builder",
      description:
        "Builds or modifies an IBM Cloud architecture diagram's elements and connectors from a " +
        "natural-language requirement or edit instruction. Delegate to this first.",
      systemPrompt: DIAGRAM_BUILDER_PROMPT,
      tools: pickTools(tools, DIAGRAM_BUILDER_TOOL_NAMES),
      skills: [skillSourcePath("diagram-builder")],
    },
    skillFiles,
  };
}

export async function buildConformanceExporterSubAgent(
  tools: readonly StructuredTool[],
): Promise<SubAgentBundle> {
  const skillFiles = await loadSkillFiles("conformance-exporter", [
    "ibm-diagram-export",
    "ibm-diagram-spec",
  ]);
  return {
    subAgent: {
      name: "conformance-exporter",
      description:
        "Validates a diagram against the IBM conformance linter, applies quick-fixes, and " +
        "exports it. Delegate to this after diagram-builder has finished.",
      systemPrompt: CONFORMANCE_EXPORTER_PROMPT,
      tools: pickTools(tools, CONFORMANCE_EXPORTER_TOOL_NAMES),
      skills: [skillSourcePath("conformance-exporter")],
    },
    skillFiles,
  };
}
