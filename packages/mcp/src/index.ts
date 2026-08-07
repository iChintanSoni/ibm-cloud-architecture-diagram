import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  // ICAD_MCP_WORKSPACE_ROOT confines doc_open/doc_save/export_diagram to a directory (I13,
  // docs/improvement-plan.md#i13--mcp-filesystem-confinement) — unset falls back to the process's
  // own cwd, matching this tool's prior (unconfined-by-anything-but-cwd) behavior for anyone
  // already launching it from the directory they mean to work in. `exactOptionalPropertyTypes`
  // rejects an explicit `workspaceRoot: undefined` key, so the key is omitted outright when unset
  // rather than passed through as-is.
  const workspaceRoot = process.env.ICAD_MCP_WORKSPACE_ROOT;
  const server = await createMcpServer(
    workspaceRoot !== undefined ? { workspaceRoot } : {},
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("icad-mcp fatal error:", err);
  process.exit(1);
});
