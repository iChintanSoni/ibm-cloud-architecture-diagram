import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ExportBlockedError } from "@icad/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  recordDiagnostics,
  requireOpenDocument,
  ToolError,
  type ServerState,
} from "../state.js";
import { complianceSummarySchema } from "../schemas.js";
import { fail, ok, okText } from "../toolResult.js";

function resolvePath(input: string): string {
  return path.resolve(process.cwd(), input);
}

export function registerConformanceTools(
  server: McpServer,
  state: ServerState,
): void {
  server.registerTool(
    "lint",
    {
      title: "Validate the current document",
      description:
        "Runs the IBM conformance linter (docs/05-ibm-spec-conformance.md) over the current document and " +
        "returns every diagnostic. Use quickfix_apply/quickfix_apply_all to resolve ones with a fix available.",
      outputSchema: complianceSummarySchema.shape,
    },
    () => {
      try {
        requireOpenDocument(state);
        const summary = state.editor.complianceSummary();
        const diagnostics = recordDiagnostics(state, summary.diagnostics);
        return ok(
          { diagnostics, counts: summary.counts, blocked: summary.blocked },
          `${diagnostics.length} diagnostic(s) — ${summary.counts.error} error(s), ${summary.counts.warn} warning(s), ${summary.counts.info} info.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "quickfix_apply",
    {
      title: "Apply one quick-fix",
      description:
        "Applies the quick-fix for one diagnostic, by id, from the most recent lint() call. Call lint() again " +
        "afterward — ids from before this call are no longer valid.",
      inputSchema: {
        diagnosticId: z
          .string()
          .describe("A Diagnostic.id from the most recent lint() result"),
      },
    },
    ({ diagnosticId }) => {
      try {
        requireOpenDocument(state);
        const diagnostic = state.lastDiagnostics.get(diagnosticId);
        if (!diagnostic) {
          throw new ToolError(
            `Unknown or stale diagnostic id "${diagnosticId}" — call lint() again.`,
          );
        }
        const applied = state.editor.applyQuickFix(diagnostic);
        if (!applied)
          throw new ToolError(`Diagnostic "${diagnosticId}" has no quick-fix.`);
        state.lastDiagnostics = new Map();
        return okText(
          `Applied the quick-fix for "${diagnosticId}". Call lint() again for the updated picture.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "quickfix_apply_all",
    {
      title: "Apply every available quick-fix",
      description:
        "Applies every diagnostic's quick-fix as one undo step, optionally scoped to one rule.",
      inputSchema: {
        ruleId: z
          .string()
          .optional()
          .describe("Limit to one rule id; omit to fix everything fixable"),
      },
      outputSchema: { fixedCount: z.number() },
    },
    ({ ruleId }) => {
      try {
        requireOpenDocument(state);
        const fixedCount = state.editor.applyQuickFixes(ruleId);
        state.lastDiagnostics = new Map();
        return ok({ fixedCount }, `Applied ${fixedCount} quick-fix(es).`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "export_diagram",
    {
      title: "Export the current document as SVG",
      description:
        "Exports the current document as a canonical, re-editable SVG (the .icad source is embedded per " +
        'docs/03-file-format.md unless embedSource is false). Blocked if the export gate is "block" and ' +
        "error-severity diagnostics remain — resolve them via quickfix_apply* first. PNG export isn't " +
        "supported by this server yet (requires a real browser canvas).",
      inputSchema: {
        format: z.literal("svg"),
        embedSource: z.boolean().optional(),
        path: z
          .string()
          .optional()
          .describe(
            "Write the SVG to this path instead of returning it inline",
          ),
      },
      outputSchema: { path: z.string().optional(), bytesLength: z.number() },
    },
    async ({ embedSource, path: outPath }) => {
      try {
        requireOpenDocument(state);
        const svg = state.editor.export({
          format: "svg",
          ...(embedSource !== undefined ? { embedSource } : {}),
        }) as string;
        if (outPath) {
          const resolved = resolvePath(outPath);
          await writeFile(resolved, svg, "utf-8");
          return ok(
            { path: resolved, bytesLength: svg.length },
            `Wrote ${svg.length} bytes to "${resolved}".`,
          );
        }
        return {
          content: [{ type: "text" as const, text: svg }],
          structuredContent: { bytesLength: svg.length },
        };
      } catch (err) {
        if (err instanceof ExportBlockedError) {
          const summary = err.diagnostics
            .filter((d) => d.severity === "error")
            .map((d) => `- ${d.ruleId}: ${d.message}`)
            .join("\n");
          return fail(
            new Error(`Export blocked by conformance errors:\n${summary}`),
          );
        }
        return fail(err);
      }
    },
  );
}
