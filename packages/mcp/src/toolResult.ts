import { ToolError } from "./state.js";

/** A successful result with both a structured payload (for the outputSchema) and a short
 * human-readable summary (for clients/models that only read `content`). */
export function ok<T extends Record<string, unknown>>(
  structured: T,
  summary: string,
) {
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: structured,
  };
}

/** A successful result with no structured payload — no `outputSchema` on tools that use this. */
export function okText(summary: string) {
  return { content: [{ type: "text" as const, text: summary }] };
}

/** Formats a caught error as an MCP tool error result — `isError: true` skips `outputSchema`
 * validation entirely, so no `structuredContent` is needed or expected here. */
export function fail(err: unknown) {
  const message =
    err instanceof ToolError || err instanceof Error
      ? err.message
      : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
