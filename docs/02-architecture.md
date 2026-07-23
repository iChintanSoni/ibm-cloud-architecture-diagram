# Architecture

This document describes the system structure: the framework-agnostic core, the shells that mount
it, the rendering model, and how data and commands flow.

## Guiding principles

- **Core owns truth.** All scene state, mutations, undo, export, and linting live in a pure-TS
  core with no UI framework ([D2](00-decision-log.md#d2--framework-agnostic-typescript-core--thin-shells--locked)). Shells are thin.
- **Everything is a command.** Every mutation goes through a command so undo/redo, autosave, and
  the future MCP server all share one entry point.
- **SVG is the render target and the export target.** One rendering path ([D3](00-decision-log.md#d3--svg-dom-rendering--locked)) means what you
  see is what you export.
- **Semantics first.** Elements carry IBM meaning (`deployedOn`/`deployedTo`, node, actor), not
  just geometry. The linter and the agent API depend on this.

## Monorepo layout

A pnpm + TypeScript monorepo. The core has **no dependency** on any shell.

```
ibm-cloud-diagram/
├── packages/
│   ├── core/                 # framework-agnostic engine (the product)
│   │   ├── src/
│   │   │   ├── scene/        # document model, elements, layers, frames
│   │   │   ├── commands/     # command bus + all mutations (undo/redo)
│   │   │   ├── render/       # SVG DOM renderer (scene → SVG nodes)
│   │   │   ├── interaction/  # hit-testing, selection, tools, snapping
│   │   │   ├── connectors/   # ports, orthogonal routing, IBM connector types
│   │   │   ├── linter/       # spec rules + quick-fixes
│   │   │   ├── io/           # .icad read/write, SVG/PNG export, migrations
│   │   │   ├── catalog/      # runtime API over the bundled icon catalog
│   │   │   └── api/          # public imperative API (used by shells + MCP)
│   ├── catalog/              # generated IBM icon catalog (from build pipeline)
│   ├── catalog-build/        # build-time IBM stencil → catalog converter
│   ├── ui-web/               # Carbon + IBM Plex app chrome (React) for the web shell
│   └── mcp/                  # (v2) MCP server wrapping packages/core api
├── apps/
│   ├── web/                  # v1 web shell (Vite): mounts core + ui-web
│   ├── vscode/               # (v2) VS Code custom editor for .icad
│   └── desktop/              # (v3) Tauri shell
├── docs/
└── README.md
```

> Only `apps/web`, `packages/core`, `packages/catalog(-build)`, and `packages/ui-web` are in the
> **v1 MVP** ([D20](00-decision-log.md#d20--mvp--editor-first-web-shell--locked)). `packages/mcp` and the other apps are stubs until v2/v3.

## The core

### Scene model
An in-memory document: an ordered element list plus indexes. Elements are discriminated unions:

- `IconNode` — an IBM catalog icon (node/device). Square container per spec.
- `Box` — a `deployedOn` container (solid border).
- `Group` — a `deployedTo` container (dashed border).
- `Zone` — region/location boundary.
- `Actor` — role/user (rounded).
- `Connector` — a routed edge with an IBM connector type, endpoints bound to ports.
- `Text` / `Label`, `Frame` (sectioning + presentation).

Every element has a stable `id`, geometry, style, a `semantic` field (the IBM meaning), and
optional `catalogRef` (for icons). Containers track membership so moving a box moves its contents.

### Command bus & history
Mutations are commands (`AddElement`, `MoveElements`, `Connect`, `SetSemantic`, `ApplyQuickFix`,
…). The bus applies a command, pushes an inverse onto the undo stack, and emits a change event.
Autosave and the MCP server both submit commands — never mutate the scene directly. This is what
makes the engine cleanly headless for [Agent Integration](08-agent-integration.md).

### Rendering (SVG DOM)
The renderer reconciles the scene into SVG nodes (a lightweight keyed diff, no React in the core).
A single `<svg>` viewport with pan/zoom via transform; a static layer for elements and an overlay
layer for selection/handles/routing previews. Because the render target *is* SVG, export is the
same tree serialized ([File Format](03-file-format.md)).

### Interaction & tools
Pointer/keyboard events resolve to the active tool (select, box, group, zone, icon-place,
connector, text, frame). Hit-testing uses the DOM plus geometry math. Snapping: grid, element
edges/centers, and connector ports.

### Connectors
Ports are anchor points on shapes. The router produces orthogonal paths that avoid obstacles and
respect the west→east convention; users can drop manual waypoints. Connector *type* carries IBM
nomenclature (line/arrow/dotted-end variants). See [Spec Conformance](05-ibm-spec-conformance.md).

### Public API (`core/api`)
A stable imperative surface the shells and the MCP server both use:

```ts
const editor = createEditor({ container, catalog, theme });
editor.loadIcad(json); editor.toIcad();
editor.commands.dispatch(cmd); editor.history.undo();
editor.catalog.search("vpc"); editor.addIcon("ibm-cloud/vpc", { at });
editor.connect(portA, portB, { type: "actor-to-node" });
editor.lint();                 // → diagnostics + quick-fixes
editor.export({ format: "svg", embedSource: true });
editor.on("change", handler);
```

## Shells

Shells provide chrome and host integration only; they call the core API.

- **`apps/web` (v1):** Vite app. Carbon + IBM Plex UI (`packages/ui-web`) around the core canvas.
  Persistence via File System Access API + fallback ([D9](00-decision-log.md#d9--file-system-access-api--fallback--locked)); autosave/recovery via OPFS ([D10](00-decision-log.md#d10--autosave-draft--crash-recovery--locked)).
- **`apps/vscode` (v2):** custom editor registered for `.icad`; core runs in the webview, the
  extension host handles file I/O.
- **`apps/desktop` (v3):** Tauri window; native file associations for `.icad`.

## Data flow (open → edit → save)

```mermaid
flowchart LR
  file[.icad file] -->|io.read + migrate| scene[Scene model]
  scene --> render[SVG renderer] --> canvas[Canvas]
  canvas -->|pointer/keys| tool[Active tool] -->|command| bus[Command bus]
  bus --> scene
  bus --> autosave[(OPFS draft)]
  scene -->|io.write| file
  scene -->|export| svg[SVG/PNG]
```

## Tech stack

- **Language:** TypeScript (strict). **Core:** no framework, no DOM-framework deps.
- **Rendering:** hand-written SVG DOM reconciler in the core.
- **Shell UI:** React + Carbon Design System + IBM Plex ([D18](00-decision-log.md#d18--carbon-design-system--ibm-plex-for-app-chrome--locked)).
- **Build:** pnpm workspaces, Vite (web), tsup/rollup (packages).
- **Test:** Vitest (unit/core), Playwright (web E2E), axe/Equal Access checks in CI.
