# ICAD — IBM Cloud Architecture Diagrams

Edit `.icad` IBM Cloud architecture diagrams next to your code. This extension registers a custom
editor for `.icad` files, reusing the same engine and UI as the [ICAD web
app](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram) — same canvas, same
Library/Properties/Layers/Validation panels, same keyboard model.

> **Preview build.** This is an unsigned, community-packaged `.vsix` — not a Marketplace listing,
> and not yet gated by IBM Design sign-off. See the [project
> README](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram#readme) for the current
> maturity status.

## What you get

- A custom editor for `.icad` files, opened automatically on double-click or "Open With".
- The full element set: boxes, groups, zones, actors, icon nodes, text, and connectors, with the
  real bundled IBM Cloud icon catalog.
- An advisory linter for IBM diagramming conventions, with quick-fixes.
- SVG export.
- Undo/redo, Open/Save/Save As, and crash recovery all wired into VS Code's own native
  mechanisms (undo stack, file commands, hot-exit) rather than a separate in-app system.
- Theme follows your active VS Code color theme automatically.

## Installing this build

Download the `.vsix` from the project's [GitHub
Releases](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram/releases) page, then in
VS Code: Extensions view → `...` menu → **Install from VSIX...**, and pick the downloaded file.

## Known limitations

- Export only offers **SVG** today (no PNG export in this shell yet).
- No manual light/dark toggle — it always follows VS Code's theme.
