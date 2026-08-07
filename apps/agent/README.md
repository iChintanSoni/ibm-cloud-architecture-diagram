# @icad/agent

A LangChain JS Deep Agents runtime that drives [`@icad/mcp`](../../packages/mcp) end-to-end from
natural language, exposed over A2A.

## Docs

- [Agent runtime](./docs/agent-runtime.md) — the orchestrator, the sub-agents, the MCP subprocess
  lifecycle, and the A2A surface

Cross-cutting context: [Decision log](../../docs/decision-log.md) (D31–D37),
[Roadmap v6](../../docs/roadmap.md#v6--autonomous-agent-runtime-deep-agents--a2a),
[Architecture](../../docs/architecture.md).

## Status

Built through M33 ([Roadmap v6](../../docs/roadmap.md#v6--autonomous-agent-runtime-deep-agents--a2a)):
the Deep Agent orchestrator with its two sub-agents (diagram builder, conformance exporter),
agent-side PNG export, the A2A server surface, and a dev-harness CLI.

`McpSession` (`src/mcpSession.ts`) spawns a fresh `@icad/mcp` stdio subprocess per task
([D34](../../docs/decision-log.md#d34--one-ephemeral-mcp-subprocess-per-task-single-task-at-a-time--locked-v6))
and exposes both LangChain-compatible tools and a direct `callTool` escape hatch (used by this
package's own tests and any non-agent plumbing).

**Deferred:** concurrent multi-task A2A sessions, cross-session agent memory, and real A2A-client
delegation ([D32](../../docs/decision-log.md#d32--a2a-server-is-primary-a2a-client-is-plumbing-only-localhost-only-no-auth--locked-v6)/D34/D36).
The A2A server is localhost-only with no auth.

## Development

```bash
pnpm --filter @icad/mcp build   # McpSession spawns the compiled dist/index.js
pnpm --filter @icad/agent build
pnpm --filter @icad/agent test
```
