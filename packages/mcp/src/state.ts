import type { Catalog, Diagnostic, Editor } from "@icad/core";
import { createHeadlessEditor } from "./headlessEditor.js";

/** Thrown by tool handlers for expected, agent-readable failures (vs. a genuine bug). */
export class ToolError extends Error {}

/**
 * Per-server state: one `Editor` for the process's whole life (one process = one open document,
 * per D4 — docs/00-decision-log.md#d4--local-first-single-user-files--locked). A factory, not a
 * module-level singleton, so each `createMcpServer()` call (production: once; tests: once per
 * test, via `InMemoryTransport`) gets its own isolated `Editor` and no state leaks across tests.
 */
export interface ServerState {
  readonly editor: Editor;
  /** False until `doc_create`/`doc_open` succeeds — gates every authoring/conformance/export/save
   * tool, mirroring the human product's own forced "New Diagram chooser on first launch" (M7.3)
   * rather than silently letting an agent author into a scene it never asked to start. */
  hasExplicitDocument: boolean;
  lastPath: string | undefined;
  /** Set by every scene mutation, cleared by save/create/open — guards `doc_create`/`doc_open`
   * from silently discarding unsaved work. */
  dirty: boolean;
  /** Diagnostics from the most recent `lint()`/`complianceSummary()` call, keyed by `Diagnostic.id`
   * — `quickfix_apply` looks up the live object here rather than accepting one over the wire,
   * since `Diagnostic.quickFix` is a `Command` (closures) that can't survive JSON-RPC. */
  lastDiagnostics: Map<string, Diagnostic>;
}

export function createServerState(catalog: Catalog): ServerState {
  const editor = createHeadlessEditor(catalog);
  const state: ServerState = {
    editor,
    hasExplicitDocument: false,
    lastPath: undefined,
    dirty: false,
    lastDiagnostics: new Map()
  };
  editor.on(() => {
    state.dirty = true;
  });
  return state;
}

export function requireOpenDocument(state: ServerState): void {
  if (!state.hasExplicitDocument) {
    throw new ToolError("No document open — call doc_create or doc_open first.");
  }
}

export function guardReplace(state: ServerState, force: boolean | undefined): void {
  if (state.hasExplicitDocument && state.dirty && !force) {
    throw new ToolError(
      "The current document has unsaved changes — call doc_save first, or pass force: true to discard them."
    );
  }
}

/** Wire-safe projection of a `Diagnostic` — drops the live `quickFix` Command (see schemas.ts). */
function toWireDiagnostic(diagnostic: Diagnostic) {
  return {
    id: diagnostic.id,
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
    category: diagnostic.category,
    message: diagnostic.message,
    ...(diagnostic.elementId !== undefined ? { elementId: diagnostic.elementId } : {}),
    ...(diagnostic.quickFixLabel !== undefined ? { quickFixLabel: diagnostic.quickFixLabel } : {}),
    hasQuickFix: diagnostic.quickFix !== undefined
  };
}

/** Refreshes `lastDiagnostics` from a fresh lint pass and returns the wire-safe projection —
 * used by every tool that surfaces diagnostics to an agent. */
export function recordDiagnostics(state: ServerState, diagnostics: Diagnostic[]) {
  state.lastDiagnostics = new Map(diagnostics.map((d) => [d.id, d]));
  return diagnostics.map(toWireDiagnostic);
}
