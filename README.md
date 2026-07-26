# ICAD — IBM Cloud Architecture Diagrams

A purpose-built editor for **IBM Cloud architecture diagrams** — "Excalidraw, but for IBM Cloud,
and spec-aware." It renders crisp, IBM-Design-faithful diagrams, understands IBM element semantics
natively (`deployedOn` / `deployedTo`, nodes, actors, zones), saves to a first-class **`.icad`**
file, and can be driven by AI agents through an MCP server and Agent Skills.

> **Positioning:** official IBM-internal tool. Uses the sanctioned
> [IBM Cloud architecture icons](https://github.com/IBM-Cloud/architecture-icons); releases are
> gated by IBM Design sign-off.

![The web editor showing a populated diagram: a Customer actor connected through an API Gateway to an Application inside an Application tier group, inside a VPC box, inside an IBM Cloud boundary, flowing to Object storage](docs/guide/images/hero-canvas-overview.png)

## Maturity

The core engine, IBM icon catalog, linter, templates, file format, and MCP agent toolset are all
built and in daily-use shape in the web app. The VS Code extension and desktop app are functional
— same engine, same UI — but not yet packaged for distribution: VS Code runs from source via the
Extension Development Host (no Marketplace listing yet), and desktop builds are self-signed, local
builds (no installer yet). See each surface's guide for exactly what's there today and what isn't:
[web editor](docs/guide/02-web-editor.md#limitations),
[VS Code](docs/guide/03-vscode-extension.md#limitations),
[desktop](docs/guide/04-desktop-app.md#limitations),
[MCP/agents](docs/guide/05-ai-agents-mcp.md#limitations).

---

## Why this exists

The sanctioned path today is **draw.io + the IBM Cloud stencil library**. It works, but nothing
enforces the IBM conventions, draw.io has no IBM semantics to validate or autocomplete against,
there's no first-class file identity, and there's no clean way for an agent to author a diagram.
ICAD fixes all four. See [Vision & Scope](docs/01-vision-and-scope.md).

## What makes it different

- **Spec-aware, not generic.** Shapes carry IBM meaning; an advisory **linter** with quick-fixes
  keeps diagrams on-spec. → [Spec Conformance](docs/05-ibm-spec-conformance.md)
- **Crisp & on-brand.** Exact IBM icons (a solid category-color 48×48 tile with a 24×24 white
  glyph, matching IBM's own construction), orthogonal connectors, Carbon + IBM Plex chrome — no
  hand-drawn look. → [The web editor](docs/guide/02-web-editor.md)
- **Files-first & git-friendly.** Local-first single-file JSON `.icad`; SVGs embed a re-editable
  copy. → [File Format](docs/03-file-format.md)
- **Machine-authorable.** One headless engine drives both the human editor and an MCP server, so
  agents and people edit the same diagrams. → [AI agents & MCP](docs/guide/05-ai-agents-mcp.md)
- **Accessible by requirement.** IBM Equal Access / WCAG 2.1 AA, including a keyboard-operable,
  screen-reader-navigable canvas. → [Accessibility](docs/07-accessibility.md)

## Features

- **Semantic elements & containers** — Box (`deployedOn`), Group (`deployedTo`), Zone/Boundary,
  Actor, Icon, Text, Frame, with move-with/cascade-delete containment and 11 IBM connector types.
- **242 bundled IBM icons** across 11 categories — searchable, offline, no network dependency.
- **Advisory linter** — 16 rules, one-click quick-fixes, a configurable export gate.
- **Four starting templates** — Blank, System context, High-level, Detailed — all pre-built and
  spec-conformant.
- **Find on canvas**, a full command palette, and Auto/Light/Dark themes.
- **`.icad` file format** — versioned JSON, autosave + crash recovery, SVG (re-editable) and PNG
  export.
- **Full keyboard operability** and WCAG 2.1 AA accessibility on the canvas itself, not just the
  chrome.
- **Four surfaces** — [web app](docs/guide/02-web-editor.md), [VS Code extension](docs/guide/03-vscode-extension.md),
  [desktop app](docs/guide/04-desktop-app.md), and an [MCP server + Agent Skills](docs/guide/05-ai-agents-mcp.md)
  for AI-agent authoring.

**Known limitations today:** no drag-to-move/resize/rotate on the canvas (typed Properties fields
instead), no marquee selection or align/distribute/z-order, no clipboard copy, no manual connector
waypoint editing. VS Code and desktop are dev/source builds, not packaged installers. MCP export is
SVG-only. Full detail in each guide doc's own Limitations section, linked above.

## Documentation

**Start here — the user guide** ([`docs/guide/`](docs/guide/)):

| Doc | What's inside |
|---|---|
| [Getting started](docs/guide/01-getting-started.md) | Install, run, create your first diagram |
| [The web editor](docs/guide/02-web-editor.md) | Every element, interaction, panel, and menu |
| [The VS Code extension](docs/guide/03-vscode-extension.md) | What it is, how to run it, what differs from web |
| [The desktop app](docs/guide/04-desktop-app.md) | What's native, how to build it, what's missing |
| [AI agents & MCP](docs/guide/05-ai-agents-mcp.md) | The 25-tool MCP server, Agent Skills, a worked example |
| [File format & export](docs/guide/06-file-format-and-export.md) | `.icad` shape, SVG/PNG export |

**Project internals** — design records for anyone working on ICAD itself, not using it:
[Decision Log](docs/00-decision-log.md) ·
[Vision & Scope](docs/01-vision-and-scope.md) ·
[Architecture](docs/02-architecture.md) ·
[Icon Catalog pipeline](docs/04-icon-catalog.md) ·
[Accessibility plan](docs/07-accessibility.md) ·
[Agent integration spec](docs/08-agent-integration.md) ·
[Canvas parity plan](docs/10-canvas-parity-plan.md)

## Architecture at a glance

```
packages/core        framework-agnostic TS engine (scene, commands, SVG render, linter, io, catalog, api)
packages/catalog     generated IBM icon catalog (manifest + optimized SVGs)
packages/catalog-build  build-time IBM stencil → catalog converter
packages/ui-web      Carbon + IBM Plex app chrome (React)
packages/mcp         MCP server + Agent Skills wrapping core/api
apps/web             web shell (Vite)
apps/vscode          VS Code custom editor for .icad (source build; no Marketplace listing yet)
apps/desktop         Tauri desktop shell (source build; no signed installer yet)
```

The core has **no UI-framework dependency**; every mutation is a **command** (so undo, autosave,
and the MCP server share one path); rendering and export both target **SVG**. Details in
[Architecture](docs/02-architecture.md).

## The `.icad` file

A single human-readable JSON file. Icons are referenced by catalog ID (not embedded), so files are
tiny and diff cleanly in git. Full schema in [File format & export](docs/guide/06-file-format-and-export.md)
(design rationale in [docs/03-file-format.md](docs/03-file-format.md)).

## Tech stack

TypeScript (strict) · custom SVG DOM renderer · React + Carbon Design System + IBM Plex (shells) ·
pnpm workspaces · Vite · Vitest / Playwright / IBM Equal Access checks. Node ≥ 20, pnpm ≥ 9.

## Getting started

```bash
pnpm install
pnpm --filter @icad/core build              # build the engine
pnpm --filter @icad/web dev                 # run the web editor (http://localhost:5173)
```

The web app renders the real, bundled IBM icon catalog (`packages/catalog`, generated by
[`packages/catalog-build`](docs/04-icon-catalog.md) from a pinned
[IBM-Cloud/architecture-icons](https://github.com/IBM-Cloud/architecture-icons) commit) — 242
icons across 11 categories. Full walkthrough in [Getting started](docs/guide/01-getting-started.md).

Other surfaces:

```bash
pnpm --filter icad-vscode build             # then launch "Run ICAD Extension" in VS Code
pnpm --filter @icad/desktop dev             # native desktop shell (dev mode)
pnpm --filter @icad/mcp build               # MCP server for AI-agent authoring
```

See [The VS Code extension](docs/guide/03-vscode-extension.md), [The desktop app](docs/guide/04-desktop-app.md),
and [AI agents & MCP](docs/guide/05-ai-agents-mcp.md) for how to actually run each.

## References

- [IBM Cloud — Creating an architecture diagram](https://cloud.ibm.com/docs/architecture-framework?topic=architecture-framework-architecture-diagram)
- [IBM-Cloud/architecture-icons](https://github.com/IBM-Cloud/architecture-icons)
- [IBM Design Language](https://www.ibm.com/design/language/) · [Carbon Design System](https://carbondesignsystem.com/) · [IBM Equal Access Toolkit](https://www.ibm.com/able/toolkit/)
