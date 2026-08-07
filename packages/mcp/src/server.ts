import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadIbmCloudCatalog } from "./catalog.js";
import { createServerState } from "./state.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerDocumentTools } from "./tools/document.js";
import { registerAuthoringTools } from "./tools/authoring.js";
import { registerConformanceTools } from "./tools/conformance.js";
import { resolveWorkspaceRoot } from "./workspace.js";

export interface CreateMcpServerOptions {
  /** Confines every filesystem-touching tool to this directory (I13,
   * docs/improvement-plan.md#i13--mcp-filesystem-confinement). Defaults to `process.cwd()` — the
   * production entrypoint (`index.ts`) reads `ICAD_MCP_WORKSPACE_ROOT` and passes it here; tests
   * pass a fresh temp directory so path confinement is exercised for real, not mocked around. */
  workspaceRoot?: string;
}

/**
 * Builds a fresh MCP server with its own headless `Editor` (one document per server instance, per
 * D4 — docs/decision-log.md#d4--local-first-single-user-files--locked). A factory, not a
 * module-level singleton, so tests can create isolated server+editor pairs via `InMemoryTransport`
 * without leaking state between them.
 */
export async function createMcpServer(
  options: CreateMcpServerOptions = {},
): Promise<McpServer> {
  const server = new McpServer({ name: "icad", version: "0.0.0" });
  const workspaceRoot = await resolveWorkspaceRoot(options.workspaceRoot);
  const state = createServerState(loadIbmCloudCatalog(), workspaceRoot);

  registerCatalogTools(server, state);
  registerDocumentTools(server, state);
  registerAuthoringTools(server, state);
  registerConformanceTools(server, state);

  return server;
}
