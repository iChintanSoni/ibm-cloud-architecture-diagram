import { readFile, stat } from "node:fs/promises";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpSession } from "./mcpSession.js";
import { resolveChatModel } from "./model.js";
import { createDiagramOrchestrator } from "./orchestrator.js";
import { convertSvgToPng } from "./pngExport.js";

/** The 4 IBM diagram levels `doc_create` accepts for a *new* diagram. Deliberately narrower than
 * the MCP tool's full `diagramTemplateIdSchema` (which also includes the 4 built-in IKS/ROKS
 * reference-architecture template ids, D30) — those are worked examples to start from, not
 * something "generate a diagram from this requirement" naturally produces. */
export type DiagramLevel =
  "blank" | "system-context" | "high-level" | "detailed";

export interface RunDiagramTaskInput {
  /** The natural-language requirement (new diagram) or edit instruction (existing diagram). */
  requirement: string;
  /** Diagram level for a *new* diagram. Ignored when `existingIcadPath` is given. Default "blank". */
  level?: DiagramLevel;
  /** Path to an existing .icad to modify (docs/00-decision-log.md#d35). Omit to create a new one. */
  existingIcadPath?: string;
  outputIcadPath: string;
  outputSvgPath: string;
  /** Rendered agent-side from the exported SVG once conformance is verified
   * (docs/00-decision-log.md#d35) — omit to skip PNG entirely and only produce .icad/.svg. */
  outputPngPath?: string;
  /** Defaults to `resolveChatModel()` (docs/00-decision-log.md#d36). */
  model?: BaseLanguageModel;
  /** LangGraph recursion limit for the orchestrator run. A real multi-tier diagram needs many
   * sequential tool calls across two sub-agent delegations; the LangGraph default (25) is too
   * low for that. */
  recursionLimit?: number;
  /** Aborts the in-flight orchestrator run (e.g. from an A2A `cancelTask` call, M32) — cheap to
   * support given the fresh-subprocess-per-task model (docs/00-decision-log.md#d34): an abort
   * rejects `agent.invoke()`, and the `finally` block below still tears the MCP subprocess down
   * either way. */
  signal?: AbortSignal;
  /** Defaults to `createDiagramOrchestrator`. Injectable so the gate/export logic below it can be
   * exercised in a test against a real spawned MCP subprocess without a real LLM — the same
   * pattern `IcadAgentExecutor`'s injectable `runTask` already uses. */
  orchestratorFactory?: typeof createDiagramOrchestrator;
}

export interface DiagnosticSummary {
  id: string;
  ruleId: string;
  severity: "error" | "warn" | "info";
  message: string;
}

/** Per-phase wall-clock timing (M30.4) — added after live testing showed a full run can take
 * anywhere from ~3 to ~20+ minutes on a local model with no way to tell *where* the time actually
 * went from the outside. Every phase that ran is present; a run that fails early only has the
 * phases it reached. Milliseconds, via `performance.now()`. */
export interface RunDiagramTaskTiming {
  /** McpSession.start(): spawning + connecting to the @icad/mcp subprocess. */
  sessionStartMs: number;
  /** doc_create/doc_open, plus doc_get for a modification's scene context. */
  docSetupMs: number;
  /** The Deep Agent orchestrator run — almost always the dominant phase. */
  orchestratorMs: number;
  /** The independent lint() call enforcing the hard export gate (D37). */
  gateCheckMs: number;
  /** export_diagram + doc_save + confirming both files landed on disk. */
  exportSaveMs?: number;
  /** Agent-side SVG→PNG conversion (D35), only present when `outputPngPath` was given. */
  pngMs?: number;
  /** Sum of every phase that ran — not wall-clock-from-process-start, so it excludes whatever the
   * caller did before calling `runDiagramTask` at all. */
  totalMs: number;
}

export type RunDiagramTaskResult =
  | {
      success: true;
      icadPath: string;
      svgPath: string;
      pngPath?: string;
      transcript: BaseMessage[];
      timing: RunDiagramTaskTiming;
    }
  | {
      success: false;
      reason: string;
      diagnostics?: DiagnosticSummary[];
      transcript: BaseMessage[];
      timing: RunDiagramTaskTiming;
    };

function structuredContentOf(result: CallToolResult): Record<string, unknown> {
  if (!result.structuredContent) {
    throw new Error(
      `MCP tool call returned no structuredContent (isError: ${String(result.isError)}).`,
    );
  }
  return result.structuredContent as Record<string, unknown>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs one diagram-generation-or-modification task end to end: opens/creates the document
 * procedurally (D35 — "new vs. modify" is the caller's explicit choice, not an LLM guess), runs
 * the Deep Agent orchestrator (diagram-builder → conformance-exporter, D33), verifies conformance
 * with its own independent lint() call (the hard export gate, D37 — never merely trusted to what
 * the LLM sub-agents report about their own work), then exports and saves procedurally with the
 * real output paths — also not delegated to the LLM, since a sub-agent asked to relay an exact
 * path through natural language isn't reliably trustworthy either (see `tools.ts`'s comment on
 * `CONFORMANCE_EXPORTER_TOOL_NAMES`).
 */
export async function runDiagramTask(
  input: RunDiagramTaskInput,
): Promise<RunDiagramTaskResult> {
  const t0 = performance.now();
  const session = await McpSession.start();
  const tSessionStart = performance.now();
  try {
    if (input.existingIcadPath) {
      await session.callTool("doc_open", {
        path: input.existingIcadPath,
        force: true,
      });
    } else {
      await session.callTool("doc_create", {
        level: input.level ?? "blank",
        force: true,
        seedExampleContent: false,
      });
    }

    let userMessage = input.requirement;
    if (input.existingIcadPath) {
      const doc = structuredContentOf(await session.callToolRaw("doc_get", {}));
      userMessage =
        `Modify the currently-open diagram as follows: ${input.requirement}\n\n` +
        `Current scene (.icad JSON):\n${JSON.stringify(doc.document)}`;
    }
    const tDocSetup = performance.now();

    const tools = await session.tools();
    const model = input.model ?? resolveChatModel();
    const buildOrchestrator =
      input.orchestratorFactory ?? createDiagramOrchestrator;
    const { agent, skillFiles } = await buildOrchestrator({
      model,
      tools,
    });

    const run = await agent.invoke(
      {
        messages: [{ role: "user", content: userMessage }],
        files: skillFiles,
      },
      {
        recursionLimit: input.recursionLimit ?? 100,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    const transcript: BaseMessage[] = run.messages ?? [];
    const tOrchestrator = performance.now();

    // D37, enforced deterministically: never trust the sub-agents' own claim of "done." Checks
    // both lint (zero errors) and real content (element count > 0) — found live that an empty
    // document trivially passes lint (nothing to flag), so a run where diagram-builder silently
    // built nothing at all was reporting `success: true` with zero elements before this check
    // existed. See the M30 dogfooding findings in docs/09-roadmap.md.
    const [lintResult, docResult] = await Promise.all([
      session.callToolRaw("lint", {}),
      session.callToolRaw("doc_get", {}),
    ]);
    const lint = structuredContentOf(lintResult) as unknown as {
      diagnostics: DiagnosticSummary[];
    };
    const doc = structuredContentOf(docResult) as unknown as {
      document: { elements: unknown[] };
    };
    const tGateCheck = performance.now();
    const timingSoFar = {
      sessionStartMs: tSessionStart - t0,
      docSetupMs: tDocSetup - tSessionStart,
      orchestratorMs: tOrchestrator - tDocSetup,
      gateCheckMs: tGateCheck - tOrchestrator,
    };

    const errors = lint.diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      return {
        success: false,
        reason: `${errors.length} error-severity diagnostic(s) remain after the agent run.`,
        diagnostics: errors,
        transcript,
        timing: { ...timingSoFar, totalMs: tGateCheck - t0 },
      };
    }
    if (doc.document.elements.length === 0) {
      return {
        success: false,
        reason:
          "Lint is clean, but the document has zero elements — the agent produced no content.",
        transcript,
        timing: { ...timingSoFar, totalMs: tGateCheck - t0 },
      };
    }

    // Export + save happen here, procedurally, with the real paths — not delegated to the LLM.
    // Found necessary during real M30 live-model testing: a sub-agent asked to relay an exact
    // path through a natural-language delegation instruction invented one instead
    // (`/exports/diagram.svg`) rather than reproducing the real one it had been given.
    await session.callTool("export_diagram", {
      format: "svg",
      path: input.outputSvgPath,
      embedSource: true,
    });
    await session.callTool("doc_save", { path: input.outputIcadPath });

    const [svgExists, icadExists] = await Promise.all([
      fileExists(input.outputSvgPath),
      fileExists(input.outputIcadPath),
    ]);
    const tExportSave = performance.now();
    if (!svgExists || !icadExists) {
      return {
        success: false,
        reason:
          "Lint is clean, but export_diagram/doc_save did not produce both expected output " +
          `files (svg: ${svgExists}, icad: ${icadExists}).`,
        transcript,
        timing: {
          ...timingSoFar,
          exportSaveMs: tExportSave - tGateCheck,
          totalMs: tExportSave - t0,
        },
      };
    }

    let pngMs: number | undefined;
    if (input.outputPngPath) {
      const svg = await readFile(input.outputSvgPath, "utf-8");
      await convertSvgToPng(svg, input.outputPngPath);
      pngMs = performance.now() - tExportSave;
    }
    const tEnd = performance.now();

    return {
      success: true,
      icadPath: input.outputIcadPath,
      svgPath: input.outputSvgPath,
      ...(input.outputPngPath ? { pngPath: input.outputPngPath } : {}),
      transcript,
      timing: {
        ...timingSoFar,
        exportSaveMs: tExportSave - tGateCheck,
        ...(pngMs !== undefined ? { pngMs } : {}),
        totalMs: tEnd - t0,
      },
    };
  } finally {
    await session.close();
  }
}
