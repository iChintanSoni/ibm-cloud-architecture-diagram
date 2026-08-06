import type { StructuredTool } from "@langchain/core/tools";

/**
 * Which of `@icad/mcp`'s real registered tools (verified against
 * `packages/mcp/src/tools/*.ts`, not the sometimes-stale guide docs — currently 30, not the 25
 * `docs/guide/05-ai-agents-mcp.md` still describes) each part of the agent gets, per
 * docs/00-decision-log.md#d33.
 *
 * Document lifecycle (`doc_create`/`doc_open`/`doc_get`) is deliberately **not** delegated to any
 * LLM here — `runDiagramTask` calls it procedurally before the orchestrator ever runs, since "new
 * vs. modify" is the caller's explicit choice (D35), not something worth an LLM guess, and
 * `doc_get` is read procedurally too (for a modification's scene context). Tried also giving
 * diagram-builder a live `doc_get` as a self-check tool (a real qwen3:8b run had silently
 * duplicated an entire topology mid-task without ever checking what it had already built) — that
 * regressed a *different* bug (the "non-string tool message content" crash `mcpSession.ts`'s
 * `extractToolResultText` already fixes for every other tool) in a way not confidently
 * root-caused before this milestone shipped, likely a concurrency/timing interaction between
 * `@langchain/mcp-adapters` and `@langchain/ollama` around this specific call. Reverted; the
 * duplication risk is now only mitigated via the system prompt (`subagents.ts`), not eliminated —
 * a documented, known limitation of a small local model on a multi-step tool-calling task, not a
 * wiring bug this milestone is on the hook to fully solve.
 *
 * `export_diagram`/`doc_save` are **also** handled procedurally by `runDiagramTask`, not given to
 * conformance-exporter — found necessary during real M30 live-model testing (qwen3:8b): the
 * orchestrator relays the exact output path to conformance-exporter via a natural-language
 * delegation instruction, and the sub-agent called `export_diagram` with an invented path
 * (`/exports/diagram.svg`) instead of the real one, failing the whole task. Matches D37's own
 * "don't trust the LLM to self-police" principle applied one step further: a mechanical step with
 * an exact, already-known correct answer (the path) shouldn't depend on an LLM reproducing a
 * string correctly across a multi-hop delegation. conformance-exporter's job is now only to get
 * lint() to zero errors; export/save happen deterministically afterward.
 */
export const DIAGRAM_BUILDER_TOOL_NAMES = [
  "catalog_search",
  "catalog_categories",
  "element_add_actor",
  "element_add_box",
  "element_add_frame",
  "element_add_group",
  "element_add_icon",
  "element_add_text",
  "element_add_zone",
  "element_delete",
  "element_move",
  "element_reparent",
  "element_rotate",
  "element_update",
  "connect",
  "connect_nearest",
  "connector_reset_routing",
  "connector_retarget",
  "group_elements",
  "ungroup_element",
  "frame_reorder",
  "scene_apply",
] as const;

export const CONFORMANCE_EXPORTER_TOOL_NAMES = [
  "lint",
  "quickfix_apply",
  "quickfix_apply_all",
] as const;

/** Filters a full tool list down to the named subset, in the order requested. Throws if a name
 * doesn't resolve — a silently-missing tool would otherwise surface as a confusing "the agent
 * refuses to do X" much later, instead of failing loudly at agent-construction time. */
export function pickTools(
  tools: readonly StructuredTool[],
  names: readonly string[],
): StructuredTool[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return names.map((name) => {
    const tool = byName.get(name);
    if (!tool) {
      throw new Error(
        `MCP tool "${name}" is not exposed by the running @icad/mcp server.`,
      );
    }
    return tool;
  });
}
