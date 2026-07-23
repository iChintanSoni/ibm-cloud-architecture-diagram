# Roadmap

Sequenced to de-risk the custom engine first, then add surfaces and the agent story. Milestones,
not dates.

## v1 — Editor-first web shell (MVP) · [D20](00-decision-log.md#d20--mvp--editor-first-web-shell--locked)

Ship a usable, on-spec human editor in the browser.

**M1 — Core engine skeleton** ✅ Done (2026-07-22)
- `packages/core`: scene model, command bus + undo, SVG DOM renderer, pan/zoom, selection,
  hit-testing. Framework-agnostic ([D2](00-decision-log.md#d2--framework-agnostic-typescript-core--thin-shells--locked)).

**M2 — Icon catalog pipeline** ✅ Done (2026-07-23)
- `packages/catalog-build` converts pinned IBM stencils → `packages/catalog` (manifest + SVGs).
- `core/catalog` runtime search/resolve. See [Icon Catalog](04-icon-catalog.md).

**M3 — Semantic elements & containers** ← next
- Box (`deployedOn`), Group (`deployedTo`), Zone, Actor, IconNode, Text; containment/move-with.

**M4 — Smart connectors**
- Ports, orthogonal auto-routing, IBM connector types, manual waypoints ([D13](00-decision-log.md#d13--smart-orthogonal-connectors-with-ibm-types--locked)).

**M5 — `.icad` I/O + export**
- Read/write single-file JSON + migration layer; SVG (embedded source) + PNG export ([File Format](03-file-format.md)).
- File System Access API + fallback; autosave/recovery ([D9](00-decision-log.md#d9--file-system-access-api--fallback--locked)/[D10](00-decision-log.md#d10--autosave-draft--crash-recovery--locked)).

**M6 — Conformance linter**
- Rule set, diagnostics, quick-fixes, validation panel, optional export gate ([Spec Conformance](05-ibm-spec-conformance.md)).

**M7 — Chrome, templates, find, themes (Carbon)**
- `packages/ui-web` + `apps/web`: library panel, properties/layers, top bar, command palette;
  IBM-level templates + frames; find-on-canvas; auto/light/dark ([Editor UX](06-editor-ux.md)).

**M8 — Accessibility to AA**
- Keyboard-operable canvas, screen-reader object tree, live regions, CI a11y checks ([Accessibility](07-accessibility.md)).

**v1 exit criteria:** an architect builds a correct system-context + high-level diagram end to
end, exports a reviewer-grade SVG, reopens it; linter catches common violations; AA verified.

## v2 — Agent surface + VS Code

Make the same engine machine-authorable and put it where developers live.

- **`packages/mcp`** — full authoring toolset over `core/api` ([Agent Integration](08-agent-integration.md), [D15](00-decision-log.md#d15--mcp-full-authoring-toolset--locked-v2)).
- **Agent Skills** — `ibm-diagram-authoring` / `-spec` / `-export` ([D16](00-decision-log.md#d16--authoring--spec--export-agent-skills--locked-v2)).
- **`apps/vscode`** — custom editor for `.icad`, diagrams-in-repo next to code.
- Harden generation quality against real requirement prompts (the A2A "GenerateArchitectureDiagram"
  capability).

**v2 exit criteria:** an agent generates a valid, non-trivial topology from a paragraph a human
accepts with minor edits; `.icad` opens identically in web and VS Code.

## v3 — Desktop + scale

- **`apps/desktop`** — Tauri shell, native `.icad` file associations, offline install.
- Performance: viewport virtualization for very large diagrams if needed ([D3](00-decision-log.md#d3--svg-dom-rendering--locked) note).
- Catalog refresh cadence + migration tooling for new IBM icon versions.

## Explicitly deferred / revisit later

- Real-time multi-user collaboration ([D4](00-decision-log.md#d4--local-first-single-user-files--locked) is single-user by design).
- `.drawio` import / round-trip ([D7](00-decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked)).
- Cloud sync / share links / accounts.
- Public open-source release (depends on IBM decision, [D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)).

## Cross-cutting throughout

- IBM Design sign-off gates each release ([D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)).
- Tests grow with features: Vitest (core), Playwright (web + keyboard E2E), CI a11y.
- Every human-editor capability lands as a **command** so the v2 MCP server inherits it for free.
