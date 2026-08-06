# @icad/agent

The autonomous agent runtime described in
[docs/11-agent-runtime.md](../../docs/11-agent-runtime.md): a LangChain JS Deep Agents runtime
that drives [`@icad/mcp`](../../packages/mcp) end-to-end from natural language, exposed over A2A.

## Status

Early scaffold ([Roadmap v6](../../docs/09-roadmap.md#v6--autonomous-agent-runtime-deep-agents--a2a),
M29 in progress). `McpSession` (`src/mcpSession.ts`) spawns a fresh `@icad/mcp` stdio subprocess
per task and exposes both LangChain-compatible tools (for the eventual Deep Agent orchestrator)
and a direct `callTool` escape hatch (used by this package's own tests, and any non-agent
plumbing). No LLM, sub-agents, or A2A surface yet — see the roadmap link above for what's next.

## Development

```bash
pnpm --filter @icad/mcp build   # McpSession spawns the compiled dist/index.js
pnpm --filter @icad/agent build
pnpm --filter @icad/agent test
```
