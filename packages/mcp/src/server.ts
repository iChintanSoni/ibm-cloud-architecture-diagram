import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadIbmCloudCatalog } from "./catalog.js";
import { createServerState } from "./state.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerDocumentTools } from "./tools/document.js";
import { registerAuthoringTools } from "./tools/authoring.js";
import { registerConformanceTools } from "./tools/conformance.js";

/**
 * Builds a fresh MCP server with its own headless `Editor` (one document per server instance, per
 * D4 — docs/decision-log.md#d4--local-first-single-user-files--locked). A factory, not a
 * module-level singleton, so tests can create isolated server+editor pairs via `InMemoryTransport`
 * without leaking state between them.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "icad", version: "0.0.0" });
  const state = createServerState(loadIbmCloudCatalog());

  registerCatalogTools(server, state);
  registerDocumentTools(server, state);
  registerAuthoringTools(server, state);
  registerConformanceTools(server, state);

  return server;
}
