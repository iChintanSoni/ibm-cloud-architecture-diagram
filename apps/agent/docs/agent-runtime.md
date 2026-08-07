# Agent Runtime (Deep Agents + A2A)

> **v6 feature — not yet built.** Design locked via [D31](../../../docs/decision-log.md#d31--new-agent-package-hosts-the-deep-agent-runtime-kept-separate-from-the-mcp-server--locked-v6)–[D37](../../../docs/decision-log.md#d37--hard-export-gate-auto-fix-everything-fixable-then-block-on-remaining-errors--locked-v6);
> [Roadmap v6](../../../docs/roadmap.md#v6--autonomous-agent-runtime-deep-agents--a2a) has the milestone
> breakdown this document assumes.

`apps/agent` is the concrete "Solution Architecture Agent" [Agent Integration](../../../packages/mcp/docs/agent-integration.md)
already sketched: a standalone process that takes a natural-language requirement (or a
natural-language edit instruction plus an existing `.icad`), drives `packages/mcp`'s 46-tool
authoring surface end-to-end, and hands back a diagram — with no human in the tool loop. Read
[Agent Integration](../../../packages/mcp/docs/agent-integration.md) first for the MCP server and Agent Skills this builds
on; this document covers only the runtime layered on top of them.

## Why this is a separate layer, not more MCP tools or a bigger skill

[M9.2](../../../docs/roadmap.md#m92--agent-skills) shipped the three `SKILL.md` packages an agent framework
_could_ use, but flagged its own gap explicitly: hardening generation quality "needs an actual
agent loop driving the MCP server end-to-end and judging output quality — a live-agent evaluation
pass," tracked as a precondition for the v2 exit criteria. Every dogfooding session since (M22–M25)
exercised `packages/mcp` through Claude Code itself acting as the agent — useful for finding real
bugs, but not this product's own answer to "how does an autonomous agent build one of these
without a coding assistant already open." `apps/agent` is that answer.

## Architecture

```mermaid
flowchart LR
  Caller["A2A caller\n(dev-harness CLI, or\nany other A2A client)"]
  subgraph Agent["apps/agent"]
    A2A["A2A server\n(@a2a-js/sdk)"]
    Orchestrator["Deep Agent\norchestrator"]
    Builder["diagram-builder\nsub-agent"]
    Exporter["conformance-exporter\nsub-agent"]
    PNG["SVG→PNG\nconversion"]
  end
  MCP["packages/mcp\n(fresh stdio subprocess\nper task)"]
  Core["packages/core\n(headless Editor)"]

  Caller <--> |A2A: GenerateArchitectureDiagram /\nModifyArchitectureDiagram| A2A
  A2A --> Orchestrator
  Orchestrator --> Builder
  Orchestrator --> Exporter
  Builder --> |catalog_search, element_add_*,\nconnect[_nearest], scene_apply| MCP
  Exporter --> |lint, quickfix_apply_all,\nexport_diagram, doc_save| MCP
  Exporter --> PNG
  MCP --> Core
```

## Request lifecycle (one task)

1. An A2A caller sends a `GenerateArchitectureDiagram` or `ModifyArchitectureDiagram` message.
   `ModifyArchitectureDiagram`'s input carries an explicit `.icad` file path
   ([D35](../../../docs/decision-log.md#d35--existing-diagrams-are-referenced-by-file-path-png-is-produced-agent-side--locked-v6)).
2. `apps/agent`'s `AgentExecutor.execute()` spawns a fresh `packages/mcp` stdio subprocess for this
   task alone ([D34](../../../docs/decision-log.md#d34--one-ephemeral-mcp-subprocess-per-task-single-task-at-a-time--locked-v6))
   and connects to it via `@langchain/mcp-adapters`.
3. `doc_open(path)` if a path was given, else `doc_create({ level })`. For a modification, also
   `doc_get()` so the orchestrator has the current scene as context.
4. The orchestrator plans (Deep Agents' planning/todo tool) and delegates to **diagram-builder**
   ([D33](../../../docs/decision-log.md#d33--orchestrator-plus-two-sub-agents-diagram-builder-and-conformance-exporter--locked-v6)),
   which loads `ibm-diagram-authoring` + `ibm-diagram-spec` and drives
   `catalog_search`/`element_add_*`/`connect`/`connect_nearest`/`scene_apply` — never inventing a
   `catalogRef`, building outside-in with correct `parentId` containment, per the existing skill.
5. The orchestrator hands off to **conformance-exporter**, which loads `ibm-diagram-export` +
   `ibm-diagram-spec` and runs the hard export gate
   ([D37](../../../docs/decision-log.md#d37--hard-export-gate-auto-fix-everything-fixable-then-block-on-remaining-errors--locked-v6)):
   `lint()` → `quickfix_apply_all()` → re-`lint()`, looping until no further quick-fix resolves
   anything. Any remaining `error`-severity diagnostic aborts the task (published as a `failed` or
   `input-required` status carrying the diagnostics) rather than exporting a broken diagram.
6. On a clean lint pass: `export_diagram({ format: "svg" })`, then an agent-side SVG→PNG conversion
   step ([D35](../../../docs/decision-log.md#d35--existing-diagrams-are-referenced-by-file-path-png-is-produced-agent-side--locked-v6)),
   then `doc_save()`.
7. `apps/agent` tears the MCP subprocess down and publishes the final artifacts (`.icad` path,
   `.svg`, `.png`) via `AgentEvent.artifactUpdate`, streaming status updates throughout rather than
   only a final result.

## Sub-agents

| Sub-agent                | Skill(s) loaded                             | MCP tools driven                                                               | Responsible for                                                            |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **diagram-builder**      | `ibm-diagram-authoring`, `ibm-diagram-spec` | `catalog_search`, `element_add_*`, `connect`, `connect_nearest`, `scene_apply` | Turning the requirement (or edit instruction) into elements and connectors |
| **conformance-exporter** | `ibm-diagram-export`, `ibm-diagram-spec`    | `lint`, `quickfix_apply`, `quickfix_apply_all`, `export_diagram`, `doc_save`   | Reaching zero-error conformance, exporting, saving                         |

Splitting here — rather than one prompt or a finer-grained split — mirrors the build-vs-validate
boundary the three skills already assume ([D33](../../../docs/decision-log.md#d33--orchestrator-plus-two-sub-agents-diagram-builder-and-conformance-exporter--locked-v6)),
and keeps each sub-agent's own context small: the entire premise of Deep Agents' sub-agent
pattern.

## A2A surface

Built on [`@a2a-js/sdk`](https://github.com/a2aproject/a2a-js) (Apache-2.0):

- **`AgentCard`** declares two skills — `GenerateArchitectureDiagram` and
  `ModifyArchitectureDiagram` — with `capabilities.streaming: true`.
- **`DefaultRequestHandler` + `InMemoryTaskStore`** — sufficient given
  [D34](../../../docs/decision-log.md#d34--one-ephemeral-mcp-subprocess-per-task-single-task-at-a-time--locked-v6)'s
  single-task-at-a-time model; nothing here needs to survive a process restart.
- **Transport:** the SDK's Express `jsonRpcHandler` + `agentCardHandler`, `userBuilder:
UserBuilder.noAuthentication` — localhost-only, no auth
  ([D32](../../../docs/decision-log.md#d32--a2a-server-is-primary-a2a-client-is-plumbing-only-localhost-only-no-auth--locked-v6)),
  on `localhost:41241` (the SDK's own sample convention) by default.
- **`AgentExecutor`** — one implementation whose `execute()` drives the orchestrator described
  above, publishing `task` → `statusUpdate` (submitted → working, with sub-agent progress folded
  into status metadata) → `artifactUpdate` → a final `statusUpdate` event. `cancelTask()` kills the
  task's MCP subprocess early — cheap to support given the fresh-subprocess-per-task model, and
  directly modeled on the SDK's own `cancellable-agent` sample.
- **Client capability:** wired via the SDK's `ClientFactory`, unused beyond the dev-harness CLI
  ([M33](../../../docs/roadmap.md#m33--a2a-dev-harness-cli-plumbing-only-a2a-client-dogfooding)) — no real
  delegation to another agent ships in v6
  ([D32](../../../docs/decision-log.md#d32--a2a-server-is-primary-a2a-client-is-plumbing-only-localhost-only-no-auth--locked-v6)).

## Memory & LLM configuration

Deep Agents' filesystem-backed memory is scoped to a single task and discarded when it completes —
no cross-session memory in v6
([D36](../../../docs/decision-log.md#d36--agent-memory-is-ephemeral-per-task-the-llm-provider-is-configurable--locked-v6)).
The chat model is selected through LangChain's generic chat-model interface plus runtime config
(provider/model/API key) rather than hardcoded to one vendor; exact config schema (env vars vs. a
config file) is decided at [M30](../../../docs/roadmap.md#m30--deep-agent-orchestrator--sub-agents) kickoff.

## Conformance & the export gate

Unlike the human editor's own _configurable_ export-gate policy, agent output always uses the
strictest setting: zero `error`-severity diagnostics required before a task can report success
([D37](../../../docs/decision-log.md#d37--hard-export-gate-auto-fix-everything-fixable-then-block-on-remaining-errors--locked-v6)).
There's no human in the loop to eyeball a "mostly clean" diagram, so a diagram that can't be made
fully conformant returns a clear failure with diagnostics instead of a silently-degraded export.

## Limitations (v6)

- **No cross-session memory.** The agent has no memory of a user's conventions, prior corrections,
  or past diagrams once a task completes.
- **Single task at a time.** No concurrent A2A callers; a second request while one is in flight
  either queues or is rejected (exact behavior decided at M32 kickoff).
- **Localhost only, no auth.** Not safe to expose beyond the local machine as shipped.
- **A2A client capability is unused plumbing.** No real delegation to another agent yet.
- **PNG is produced by `apps/agent`, not `packages/mcp`.** `packages/mcp`'s own `export_diagram`
  tool remains SVG-only, unchanged by this initiative.
- **No human-facing chat UI.** The A2A dev-harness CLI is for local testing only, not a product
  surface — a real chat/UI front end is explicitly out of scope for v6.

## Roadmap

See [Roadmap → v6](../../../docs/roadmap.md#v6--autonomous-agent-runtime-deep-agents--a2a) for the M29–M33
milestone breakdown, sequenced one at a time per the project's usual cadence.
