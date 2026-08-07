# @icad/mcp — ICAD MCP server

An [MCP](https://modelcontextprotocol.io) server that wraps the ICAD engine as a full diagram
authoring toolset for AI agents: catalog search, document I/O, element authoring, and
conformance/export — every mutating tool is a real editor command, so anything an agent builds is
undoable, validated against the linter, and opens as a normal `.icad` file a person can then edit
by hand in the [web](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram),
[VS Code](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram), or desktop editor.

> **Preview build.** This tarball is an unsigned, standalone packaging of the server — not yet
> gated by IBM Design sign-off. See the [project
> README](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram#readme) for the current
> maturity status.

## Running it

This directory is self-contained — the icon catalog it needs lives alongside it at `../catalog`,
so keep this extracted layout intact (don't move `mcp/` away from its sibling `catalog/`):

```
icad-mcp-vX.Y.Z/
  mcp/            <- this directory
  catalog/        <- bundled IBM icon catalog data
```

Point your MCP client at it directly with Node. `ICAD_MCP_WORKSPACE_ROOT` confines
`doc_open`/`doc_save`/`export_diagram` to a directory (I13,
[Improvement plan](../../docs/improvement-plan.md#i13--mcp-filesystem-confinement)) — set it to
the directory you want the agent authoring diagrams in; unset falls back to the server process's
own working directory:

```json
{
  "mcpServers": {
    "icad": {
      "command": "node",
      "args": ["/absolute/path/to/icad-mcp-vX.Y.Z/mcp/dist/index.js"],
      "env": { "ICAD_MCP_WORKSPACE_ROOT": "/absolute/path/to/your/diagrams" }
    }
  }
}
```

stdio is the only transport (no HTTP/SSE); no API keys or network access are required — it's fully
local and offline, reading and writing `.icad` files on disk within the confined workspace root.
See the
[AI agents & MCP guide](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram/blob/main/packages/mcp/docs/ai-agents-mcp.md)
for the full tool list and Agent Skills under `skills/`.

## Docs

| Doc                                                   | What's inside                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| [AI agents & MCP](./docs/ai-agents-mcp.md)            | The full tool list, the Agent Skills, and a worked end-to-end example          |
| [Agent integration spec](./docs/agent-integration.md) | How the MCP surface maps onto core's command API, and why it's shaped that way |

Cross-cutting context: [Architecture](../../docs/architecture.md),
[Decision log](../../docs/decision-log.md) (D15/D16),
[Improvement plan](../../docs/improvement-plan.md).

## Limitations

- PNG export isn't supported — only SVG (needs a real browser canvas, not available headlessly).
- One document per server process, for its whole life.
- No handoff to a running human editor instance.
- No tool returns a rendering, so an agent can't see what it drew — see
  [I15](../../docs/improvement-plan.md#i15--agent-visual-feedback-mcp).
