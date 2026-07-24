# Getting started

This walks through installing ICAD from source and creating your first diagram in the web
editor. There's no hosted instance yet — every surface (web, VS Code, desktop, the MCP agent
server) runs from a local clone of this repository.

## Prerequisites

- **Node.js ≥ 20**
- **pnpm ≥ 9**

## Install and run

```bash
git clone <this repo>
cd ibm-cloud-diagram
pnpm install
pnpm --filter @icad/core build   # build the engine once
pnpm --filter @icad/web dev      # start the web editor
```

Open **http://localhost:5173**. That's the whole setup — everything else (the IBM icon catalog,
fonts, the linter) is bundled, so the app runs fully offline after `pnpm install`.

## Your first diagram

On first launch (or whenever `File → New` is used and the canvas is empty) ICAD opens the **New
diagram** dialog:

![New diagram dialog](images/new-diagram-dialog.png)

Pick a level and click **Create diagram**:

- **Blank** — an empty canvas with the library ready.
- **System context** — actors, external systems, and a solution boundary. Good for a first-pass,
  audience-facing view.
- **High-level / logical** — key IBM Cloud services and their main west→east flow. Good default
  starting point for most diagrams.
- **Detailed / deployment** — region, VPC, subnet, security-group, and workload structure.

Templates aren't blank scaffolding — they're pre-built, spec-conformant diagrams (correct
containment, correct connector types, zero linter warnings) that you edit into your own diagram
rather than build up from nothing. Here's the High-level template right after creation:

![Populated canvas showing a Customer actor connected through an API Gateway, an Application box inside an Application tier group, inside a VPC box, inside an IBM Cloud boundary, to Object storage](images/hero-canvas-overview.png)

From here:

- Click any element to select it and edit it in the **Properties** panel on the right.
- Drag new icons in from the **Library** panel on the left (see
  [The web editor](02-web-editor.md#placing-icons) — placement is click-to-place, not
  drag-and-drop).
- **Ctrl/Cmd+S** saves a `.icad` file to disk; **Ctrl/Cmd+K** opens the command palette if you'd
  rather run any action by name.

For everything the editor can do — element types, connectors, the linter, find, themes, export —
see **[The web editor](02-web-editor.md)**.

## Other ways to run ICAD

- **VS Code extension** — edit `.icad` files inside VS Code. Currently a dev-only build (no
  Marketplace listing yet). See [The VS Code extension](03-vscode-extension.md).
- **Desktop app** — a native Tauri shell with real file associations and OS dialogs. Currently
  build-from-source only (no signed installer yet). See [The desktop app](04-desktop-app.md).
- **AI agents / MCP** — point an MCP-capable agent at `packages/mcp` to author diagrams
  programmatically. See [AI agents & MCP](05-ai-agents-mcp.md).

## Limitations

- No hosted/deployed instance — every surface runs from a local clone today.
- First launch (with no autosaved draft) always opens the New Diagram dialog; there's no way to
  land directly on a blank canvas without it.
