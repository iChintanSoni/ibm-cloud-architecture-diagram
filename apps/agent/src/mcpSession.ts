import { createRequire } from "node:module";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { tool, type StructuredTool } from "@langchain/core/tools";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const SERVER_NAME = "icad";

/** Resolves to @icad/mcp's compiled stdio entrypoint (its package.json `main`), via real Node
 * module resolution rather than a hardcoded relative path across the monorepo — works whether
 * the workspace dependency is a pnpm symlink (dev) or a real copy (a deployed/materialized
 * package, per the release tarball's `pnpm deploy` layout). */
function resolveMcpServerEntrypoint(): string {
  return createRequire(import.meta.url).resolve("@icad/mcp");
}

/** Every `@icad/mcp` tool's `ok()` helper (packages/mcp/src/toolResult.ts) returns a text summary
 * *and* `structuredContent` for tools with structured output. `@langchain/mcp-adapters` folds
 * both into one non-string content object (`{type, text, structuredContent}`) when there's
 * exactly one text block — found live (M30, real qwen3:8b run) that `@langchain/ollama`'s
 * ChatOllama rejects that shape outright as ToolMessage content ("Non string tool message content
 * is not supported"). Extracts just the human-readable text, which is all the LLM ever needed —
 * structured data stays available separately via {@link McpSession.callToolRaw}. */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => extractToolResultText(block))
      .filter((text) => text.length > 0)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: unknown }).text);
  }
  return JSON.stringify(content);
}

/** Wraps a tool so a failed underlying MCP call becomes a normal (string) tool result the LLM can
 * see and react to, instead of an exception that crashes the whole agent run. Found live (M30): a
 * real qwen3:8b run called `connect_nearest` with a label instead of a generated element id, and
 * the resulting MCP validation error propagated as an uncaught exception all the way through
 * LangGraph's ToolNode, killing the whole task rather than giving the model a chance to notice
 * its own mistake and retry with the right id. Only applied within {@link McpSession.tools} (what
 * an agent actually calls) — {@link McpSession.callTool}/{@link McpSession.callToolRaw} still
 * throw for real, since procedural callers (`runDiagramTask`, tests) should see genuine failures
 * directly, not a silently-degraded string.
 *
 * `verboseParsingErrors: true` was added after a *second* live finding: `@langchain/core`'s own
 * schema-validation failure message is `"Received tool input did not match expected schema"` —
 * with zero detail about which field or why — unless this flag is set, in which case it appends
 * the real Zod error. A real run burned ~35 minutes alternating between wrong `scene_apply`
 * connector-op shapes with no way to tell what was actually wrong from the error alone; this is
 * likely the dominant cause of findings #4/#9's "the model can't recover" pattern, not a hard
 * ceiling on model capability. */
function withErrorRecovery(original: StructuredTool): StructuredTool {
  // Cast at the boundary: `original.schema` is a real Zod schema, but the specific Zod instance
  // `@langchain/mcp-adapters` builds it with doesn't structurally unify with `tool()`'s own Zod
  // typing under this project's `exactOptionalPropertyTypes` — a type-level friction between two
  // packages' bundled Zod versions, not a runtime issue (the schema itself works fine either way).
  const wrapped = tool(
    async (args: Record<string, unknown>) => {
      try {
        return (await original.invoke(args)) as string;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error calling ${original.name}: ${message}`;
      }
    },
    {
      name: original.name,
      description: original.description,
      schema: original.schema,
      verboseParsingErrors: true,
    },
  );
  return wrapped as unknown as StructuredTool;
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
      afterToolCall: (toolCallResult) => {
        const [content] = toolCallResult.result;
        return { result: extractToolResultText(content) };
      },
    });
    // Force the connection now rather than lazily on first getTools(), so a spawn/handshake
    // failure surfaces here, not inside whatever the first real tool call happens to be.
    await client.getTools();
    return new McpSession(client);
  }

  /** LangChain-compatible tools, for the Deep Agent orchestrator/sub-agents to call directly —
   * error-recovering (see {@link withErrorRecovery}), so a bad tool call degrades to a visible
   * error message the model can react to rather than crashing the whole run. */
  async tools(): Promise<StructuredTool[]> {
    const tools = await this.client.getTools();
    return tools.map((candidate) => withErrorRecovery(candidate));
  }

  /** Direct, non-agent tool invocation — for tests and any plumbing that doesn't need an LLM.
   * Returns whatever shape `@langchain/mcp-adapters`' tool wrapper produces (a plain string, or
   * an artifact-tuple-derived object when the tool has structured output) — good enough when the
   * caller only cares that the call succeeded. For anything that needs to *read* the real
   * structured result (e.g. lint diagnostics), use {@link callToolRaw} instead. */
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

  /** Direct call against the real MCP `Client`, bypassing `@langchain/mcp-adapters`' tool-result
   * conversion — guarantees a real `CallToolResult` with `.structuredContent` present exactly as
   * the server declared it (validated against its own `outputSchema`), rather than whatever
   * shape the LangChain artifact-tuple wrapper happens to produce for a given tool. */
  async callToolRaw(
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const client = await this.rawClient();
    return client.callTool({
      name,
      arguments: args,
    }) as Promise<CallToolResult>;
  }

  private async rawClient(): Promise<Client> {
    const client = await this.client.getClient(SERVER_NAME);
    if (!client) {
      throw new Error(`No connected MCP client for server "${SERVER_NAME}".`);
    }
    return client;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
