import { createRequire } from "node:module";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";

const SERVER_NAME = "icad";

/** Resolves to @icad/mcp's compiled stdio entrypoint (its package.json `main`), via real Node
 * module resolution rather than a hardcoded relative path across the monorepo — works whether
 * the workspace dependency is a pnpm symlink (dev) or a real copy (a deployed/materialized
 * package, per the release tarball's `pnpm deploy` layout). */
function resolveMcpServerEntrypoint(): string {
  return createRequire(import.meta.url).resolve("@icad/mcp");
}

/**
 * One `@icad/mcp` stdio subprocess for the lifetime of a single agent task
 * (docs/00-decision-log.md#d34): started fresh by `start()`, torn down by `close()` once the
 * task completes. Never pooled or reused across tasks — see D34's rationale (the MCP server
 * holds exactly one open document for its whole process lifetime, and a long-running session
 * can end up running stale, pre-rebuild code).
 */
export class McpSession {
  private constructor(private readonly client: MultiServerMCPClient) {}

  static async start(): Promise<McpSession> {
    const client = new MultiServerMCPClient({
      mcpServers: {
        [SERVER_NAME]: {
          transport: "stdio",
          command: process.execPath,
          args: [resolveMcpServerEntrypoint()],
          // No auto-restart: a dead subprocess means this task fails, not a silent respawn onto
          // a document state the caller no longer recognizes.
          restart: { enabled: false },
        },
      },
    });
    // Force the connection now rather than lazily on first getTools(), so a spawn/handshake
    // failure surfaces here, not inside whatever the first real tool call happens to be.
    await client.getTools();
    return new McpSession(client);
  }

  /** LangChain-compatible tools, for the Deep Agent orchestrator/sub-agents to call directly. */
  async tools(): Promise<StructuredToolInterface[]> {
    return this.client.getTools();
  }

  /** Direct, non-agent tool invocation — for tests and any plumbing that doesn't need an LLM. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const tools = await this.client.getTools();
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(
        `MCP tool "${name}" is not exposed by the running @icad/mcp server.`,
      );
    }
    return tool.invoke(args);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
