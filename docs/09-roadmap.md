# Roadmap

Sequenced to de-risk the custom engine first, then add surfaces and the agent story. Milestones,
not dates.

## v1 — Editor-first web shell (MVP) · [D20](00-decision-log.md#d20--mvp--editor-first-web-shell--locked)

Ship a usable, on-spec human editor in the browser.

#### M1 — Core engine skeleton

✅ **Done** (2026-07-22)

- `packages/core`: scene model, command bus + undo, SVG DOM renderer, pan/zoom, selection,
  hit-testing. Framework-agnostic ([D2](00-decision-log.md#d2--framework-agnostic-typescript-core--thin-shells--locked)).

#### M2 — Icon catalog pipeline

✅ **Done** (2026-07-23)

- `packages/catalog-build` converts a pinned IBM stencils commit → `packages/catalog` (manifest +
  SVGs): 242 icons across 11 categories (a `groups` category and 35 icons added per
  [D23](00-decision-log.md#d23--catalog-gains-a-groups-icon-category-narrowing-d21--locked)). See
  [Icon Catalog](04-icon-catalog.md).
- `core/catalog` runtime search/resolve.

#### M3 — Semantic elements & containers

✅ **Done** (2026-07-23)

- Box (`deployedOn`), Group (`deployedTo`), Zone, Actor, IconNode, Text elements, all reachable
  through the public `Editor` API (`addBox`/`addGroup`/`addZone`/`addActor`/`addIcon`/`addText`).
- Containment/move-with: `Scene.descendantsOf`/`ancestorsOf` walk the `parentId` tree (cycle-safe);
  `moveElements` cascades a move to every nested descendant; `removeElement` cascades delete to the
  whole subtree, undoing back to the exact prior tree; a new `reparentElement` command changes
  container membership and rejects cycles.
- A `deployedTo` Group originally required a `deployedOn` Box ancestor; M7.1 removed that
  unsupported assertion after cross-checking the published Architecture Framework.
- Container presets (named shortcuts like VPC/Subnet/Region over these three primitives) are
  explicitly out of scope here — [D21](00-decision-log.md#d21--container-presets-are-a-named-shortcut-layer-not-new-element-types--locked) lands them in M7 instead.

#### M4 — Smart connectors

✅ **Done** (2026-07-23)

- Connectors bind to named ports (`n`/`e`/`s`/`w`/`center`) and route through a grid-based
  orthogonal (Manhattan) router: obstacle-free where possible, fewest bends, mild west→east bias
  per [Layout convention](05-ibm-spec-conformance.md#layout-convention). Obstacles are leaf shapes
  (icon/actor/text) only — containers are never treated as obstacles, since IBM deployment
  diagrams routinely cross a box/zone boundary.
- Moving or resizing a connected element re-routes its attached `"auto"` connectors as part of the
  same undoable command; `editor.setConnectorWaypoints()` overrides a route manually (switches it
  to `"manual"`, exempt from auto re-routing) and `editor.autoRouteConnector()` reverts it.
- Full IBM connector nomenclature ([Connector nomenclature](05-ibm-spec-conformance.md#connector-nomenclature)):
  the five connection types (logical/physical/tunneling/double-tunnel/plain, with
  unidirectional/bidirectional + green-private/blue-public variants) and the six relationship
  types (dependency, association, aggregation, composition, implementation, extends), each with
  its own line style and endpoint/arrowhead/diamond marker.
- Linter gained a crossing-route rule: an auto or manual connector whose path crosses a leaf shape
  it isn't attached to is flagged, with a "re-route" quick-fix.

#### M5 — `.icad` I/O + export

✅ **Done** (2026-07-23)

- `core/io`: `toIcad`/`fromIcad`/`applyIcad` round-trip the scene through the single-file JSON
  shape; a migration registry (empty until the schema bumps past v1) feeds into a repair pass that
  keeps a loaded scene always structurally valid regardless of source — a dangling `parentId` is
  cleared, a `parentId` cycle is broken, a connector missing either endpoint is dropped, and
  degenerate (non-positive/non-finite) geometry is clamped to a minimum size ([File Format](03-file-format.md#versioning--migration)).
- SVG export (canonical, with the re-editable `.icad` source embedded per [D8](00-decision-log.md#d8--re-editable-svg-via-embedded-icad-copy--locked)) and PNG export (1×/2×/3×, transparent/white) via `core/io/export`.
- `apps/web`: real Open/Save/Save-As through the File System Access API, falling back to
  download/upload on browsers without it ([D9](00-decision-log.md#d9--file-system-access-api--fallback--locked)); continuous IndexedDB autosave with a recovery banner offering to
  discard on reload after a crash ([D10](00-decision-log.md#d10--autosave-draft--crash-recovery--locked)).

#### M6 — Conformance linter

✅ **Done** (2026-07-23)

- Fourteen IBM-default rules cover semantic/type and visual mismatches, catalog references, palette
  use, containment, labels, connector validity/routing, west→east public flow, and icon geometry.
  Rule severities (`error`/`warn`/`info`/`off`) and the warn/block export gate are configurable per
  document and persist in `.icad`.
- Quick-fixes use the shared command bus, including a single-step “Fix all of this type,” so every
  correction is undoable and ready for the v2 agent API.
- The Carbon validation panel groups by severity, selects targets, exposes rule settings, and
  mirrors diagnostics as editor-only canvas badges. The export dialog shows a compliance summary
  and enforces block-on-error when enabled.

#### M7 — Chrome, templates, find, themes (Carbon)

✅ **Done** (2026-07-23)

- ✅ **Library vertical slice done (2026-07-23):** reusable `packages/ui-web` Carbon library
  panel, catalog search/category browsing, click-to-place icons and native containers, automatic
  containment with the prescribed 16px inset, and the four container presets confirmed by IBM
  worked examples (IBM Cloud, Public Network, OpenShift, Availability zone). Inferred presets
  remain withheld pending IBM Design confirmation. **Region and VPC added as a fifth/sixth
  confirmed preset per [D24](00-decision-log.md#d24--regionvpcsubnet-are-box-only-availability-zoneon-prem-are-boundary--locked).**

##### M7.1 — Published-guidance conformance alignment

✅ **Done** (2026-07-23)

Aligned the implementation with the published
[IBM Cloud Architecture Framework](https://cloud.ibm.com/docs/architecture-framework?topic=architecture-framework-architecture-diagram)
and used the stencil repository as the supplemental asset/inventory source:

1. Documented the source-of-truth precedence: Architecture Framework → IBM Design-approved internal
   guidance → native Draw.io stencils → repository inventory/complementary XML → raw SVG exports
   and repository prose.
2. Removed the `group-without-box` linter rule: the published guidance defines
   `deployedTo` but does not require every Group to be nested under a Box.
3. Matched IBM connector endpoints: bidirectional connections use dots at both ends; unidirectional
   connections use a source dot and destination arrow. Added reference-backed rendering tests.
4. Relabeled the public library tool from **Zone** to **Boundary** while retaining `zone` as the
   internal primitive until IBM Design confirms its normative status.
5. Added golden visual fixtures for a node, actor, Box, Group, public/private connections,
   bidirectional/unidirectional connections, and alternating white/light nested-container fills.

**Separate design follow-up (not part of M7.1):** confirm whether `deployedTo` is single- or
multi-valued before changing the `.icad` schema or replacing `parentId` with membership relations.

##### M7.2 — Selection inspector and layers

✅ **Done** (2026-07-23)

Made placed elements editable and the diagram hierarchy navigable:

1. Add Carbon **Properties / Layers / Validation** tabs to the right inspector, moving the existing
   validation surface into its tab without losing diagnostics, quick-fixes, or rule settings.
2. Expose selection changes to the React shell and show single-selection properties for label,
   position, size, parent container, and type-specific fields.
3. Route every property mutation through public `Editor` commands so edits are undoable, reroute
   attached connectors when geometry changes, and autosave normally.
4. Add a hierarchical Layers tree derived from `parentId`; selecting a row selects the canvas
   element, and the selected canvas element is revealed in the tree.
5. Cover inspector edits, undo/redo, connector rerouting, layer nesting, and selection
   synchronization with component and integration tests.

**Done when:** a user can place an element, select it, edit its core properties, undo the edit, and
navigate the same object through Layers and Validation without leaving the right inspector.

##### M7.3 — IBM-level templates and frame authoring

✅ **Done** (2026-07-23)

Turned the four locked IBM diagram levels into reusable starter documents and completed the first
frame-authoring slice:

1. Added framework-agnostic `createTemplateDocument()` builders for Blank, System context,
   High-level / logical, and Detailed / deployment diagrams. Each seeded template uses named
   frames, valid containment, IBM catalog references, and routed west→east flows.
2. Added undoable public `Editor.addFrame()` and atomic `Editor.reorderFrames()` APIs; frame names
   render on the canvas and remain editable with presentation order in Properties.
3. Added Frame to the Library placement surface with normal 16px automatic containment for later
   elements, while new frames themselves always remain top-level.
4. Added a Carbon New Diagram chooser, shown on first launch and available from the top bar. It
   explicitly warns before replacing a populated document and clears its file identity.
5. Opening or creating a document now clears stale undo/redo history, preventing commands from a
   replaced document from mutating the new one.
6. Covered template structure/conformance/serialization, frame creation/reordering/undo, Library
   placement, and template selection with core and component tests.

**Done when:** a user can start at any IBM diagram level, create and edit named frames, order them,
save/reopen the result as `.icad`, and continue editing through the shared command surface.

##### M7.4 — Top bar, command palette, find, frame presentation, theme persistence

✅ **Done** (2026-07-23)

Closed out the remaining M7 chrome: a real pan/zoom camera plus the surfaces that depend on it.

1. Added an ephemeral `ViewportController` (`packages/core/src/render/viewport.ts`, not part of
   undo history or the `.icad` document) and a `boundsOf()` scene helper; `SvgRenderer` applies it
   as the root SVG's `viewBox`. `Editor` exposes `viewport`, `focusOnElements()`, `fitToContent()`,
   `zoomIn()`/`zoomOut()`/`resetView()`. `apps/web` wires scroll-to-pan and Ctrl/Cmd+scroll-to-zoom
   as a native non-passive wheel listener (React's synthetic `onWheel` can't `preventDefault`).
2. Replaced the plain button toolbar with a full Carbon UI Shell `TopBar`
   (`packages/ui-web/src/TopBar.tsx`): File/Edit/View/Insert/Help menus, a live zoom-percent
   indicator, Find and Command-palette actions, and the theme switch.
3. Added `CommandPalette` (Ctrl/Cmd+K) and `FindBar` (Ctrl/Cmd+F) — Find matches element labels,
   resolved catalog icon names, and **frame names**, jumping/zooming the viewport to each match
   exactly per [Find on canvas](06-editor-ux.md#find-on-canvas-f).
4. Added a **Frames** tab to the inspector listing frames in presentation order with click-to-jump
   and a **Present frames** mode; arrow/PageUp/PageDown keys step frame-to-frame while presenting.
5. Persisted the auto/light/dark chrome preference to `localStorage`, independent of any one
   `.icad` document, surviving reloads.
6. Covered the viewport math, find matching, and every new component with core/ui-web unit and
   component tests; verified the integrated flow (insert, undo/redo, find, present, theme
   persistence, export) end-to-end in a running browser.

**Done when:** a user can run any action from the top bar or the command palette, jump to any
element or frame by name via Find, step through a presentation, and keep their chosen theme across
a reload.

#### M8 — Accessibility to AA

🟡 **In progress** — everything automatable is done, and a live-browser verification pass has since
found and fixed four real defects the automated suite couldn't see; only the actual human
VoiceOver/NVDA sign-off pass remains ([Accessibility](07-accessibility.md)).

##### M8.1 — Baseline canvas keyboard operation, roles/names, CI a11y checks

✅ **Done** (2026-07-23)

Per the doc's own phasing ("chrome and keyboard operation first, then the screen-reader object
tree and live regions"), landed the foundational layer everything else builds on:

1. Every canvas element now gets a real ARIA role (`group` for containers, `button` for
   everything selectable) and an accessible name (`accessibleName()`/`accessibleRole()` in
   `packages/core/src/scene/accessibleName.ts`) — containers mention their child count,
   connectors describe both resolved endpoints and the connection/relationship type instead of
   just geometry.
2. Added a meaningful keyboard tab order (`computeTabOrder()`,
   `packages/core/src/interaction/tabOrder.ts`): containers before children, siblings west→east
   per [Layout convention](05-ibm-spec-conformance.md#layout-convention), connectors last.
   `SvgRenderer` keeps exactly one element as the sole `tabindex="0"` node (roving tabindex) and
   re-renders the existing selection outline as the shared visual focus indicator; `Editor` gained
   `tabOrder()`, `focusNext()`/`focusPrevious()` (auto-panning into view only when the target isn't
   already visible), `nudgeElements()`, and `deleteElements()` (cascading, undoable).
3. `apps/web` wires Tab/Shift+Tab (exits to surrounding chrome at the boundary — no keyboard trap),
   arrow keys (nudge, Shift for a larger step), and Delete/Backspace on the canvas; mouse clicks
   now also move real DOM focus (a click's exact target is often a non-focusable child shape, so
   focus doesn't follow the click for free).
4. Fixed a real bug the accessibility pass surfaced: `SvgRenderer` originally moved DOM focus on
   every selection change, which stole focus from Find/the command palette/frame presentation
   while the user was still typing/clicking elsewhere. Selection and keyboard focus are now
   decoupled — only deliberate Tab navigation calls the explicit `focusElement()`.
5. Added a focus trap (Tab) and focus-restore-on-close to `CommandPalette` and `FindBar`
   (`packages/ui-web`) — neither existed before.
6. Stood up `.github/workflows/ci.yml` (typecheck, lint, test on every push/PR) and an
   `axe-core` smoke test (`packages/ui-web/src/a11y.test.tsx`) over the Carbon chrome components;
   this caught two real ARIA violations (an invalid listbox/listitem structure in `CommandPalette`,
   a duplicated `role="search"` landmark in `FindBar`) before they shipped.

**Known limitation:** jsdom can't evaluate layout-dependent rules (contrast, target size) or real
screen-reader output — those need a live browser pass, tracked below.

##### M8.2 — Connect/group interactions, nested object tree, live regions, real-browser CI

✅ **Done** (2026-07-23)

Closed out every remaining M8 item except the manual screen-reader pass:

1. Built port-to-port connector drawing from scratch — it didn't exist as a mouse feature before
   this pass. `packages/core/src/routing/pickPorts.ts` picks a reasonable port pair by dominant
   axis; `SvgRenderer` reveals a hovered element's four port markers, draws the in-progress draft
   line, and exposes `Editor.connectNearest()`/`setConnectorDraftPoints()`/`previewConnectorBetween()`.
   `apps/web` wires the mouse gesture (hover to reveal ports, drag from a port, drop on an exact
   port or anywhere on another element for a nearest-port fallback, drop on empty canvas cancels)
   and a keyboard equivalent (press `c` on a focused element to enter connect mode, Tab to aim at a
   target, Enter to confirm, Escape to cancel).
2. Built `Editor.groupElements()`/`ungroupElement()` — also new. `ungroupElement` is a hand-written
   `Command` rather than a composed `batch()`, because `removeElement`'s cascading delete snapshots
   descendants at construction time, which would delete children mid-reparent if composed naively.
   Wired to `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G`, the Edit menu, and the command palette.
3. Decoupled keyboard focus from selection (`Editor.focusedElement()`/`focusElement()` vs.
   `editor.selection`): Tab moves focus only, Enter selects the focused element, Shift+Space
   extends the selection without collapsing it — needed so keyboard users can build a multi-element
   selection (for Group) the same way a mouse user shift-clicks.
4. Added the full nested ARIA object tree: containers render `aria-owns` over their children, so
   assistive tech reads containment as real parent/child structure (`Frame > Boundary > Boundary >
Group > button`) instead of a flat list — confirmed against a live accessibility tree, not just
   jsdom.
5. Added `LiveRegion` (`packages/ui-web/src/LiveRegion.tsx`, visually-hidden `role="status"`) and
   wired announcements to insert/delete/connect/group/ungroup/quick-fix actions.
6. Stood up real-browser a11y + keyboard E2E: Playwright + `@axe-core/playwright`
   (`apps/web/e2e/`), wired into a new CI `e2e` job. Found and fixed four real accessibility bugs
   that jsdom's axe pass couldn't catch (no `<main>` landmark, no `<h1>`, an `<h1>` not contained by
   a landmark, a scrollable command-palette list without a verifiable keyboard path) plus two
   Carbon/test-infra issues (styled radio buttons intercept clicks on the input itself, not the
   label; Modal leaves fading content in the DOM after "close").
7. Verified every new interaction manually in a live browser (not just automated tests): mouse
   drag-to-connect, mouse Group/Ungroup via the Edit menu, and live-region announcements all confirmed
   working end-to-end. (One dead end during that pass: hovering an element showed zero port markers
   on a diagram carried over from earlier manual testing — traced to a stray leftover frame
   overlapping the scene, which legitimately won `hitTest`'s topmost-bbox match ahead of the element
   underneath; not a product bug, and reproduced cleanly with correct behavior on a fresh diagram.)

##### M8.3 — Live-browser verification pass; manual sign-off script

✅ **Verification pass done, human sign-off still pending** (2026-07-23)

Before handing M8 to an actual screen-reader user, drove the real Chrome accessibility tree (the
same data VoiceOver/NVDA consume) against a running instance to exercise every M8.1/M8.2 flow
end-to-end. Found and fixed four real defects no automated suite (jsdom axe or Playwright axe) had
caught, because each one is a live-interaction/data-integrity gap rather than a static markup
violation:

1. **Catalog icon placement had no keyboard path at all.** The Library panel's "arm a placement,
   then click a canvas point" gesture — used for every icon and preset, not just containers — only
   ever completed on a mouse click; a keyboard user could reach every button but never finish
   placing an icon, the actual content of an IBM architecture diagram. Fixed by detecting a
   keyboard activation (`event.detail === 0` on the button's click event) and placing immediately
   at the viewport center in that case, matching how `Insert X` commands already behave
   (`packages/ui-web/src/LibraryPanel.tsx`, `apps/web/src/App.tsx`, `apps/web/src/placement.ts`).
2. **`Insert X` commands never moved keyboard focus to the new element.** `handleInsert` set
   selection and announced the addition but left real DOM focus wherever the triggering menu/palette
   closed (typically `<body>`), unlike every other insertion path — breaking the natural
   create-then-immediately-edit/move/connect flow for a keyboard user. Fixed by calling
   `editor.focusElement(id)` there too (`apps/web/src/App.tsx`).
3. **Cascading delete left dangling connectors.** Deleting a container cascades to its descendants
   (by design), but a connector attached to one of those descendants from _outside_ the deleted
   subtree survived with an endpoint that no longer resolves — surfacing live as an interactive
   element literally named "Connector: unknown element to unknown element". The `.icad` repair pass
   already drops exactly this case on load ([File Format](03-file-format.md#versioning--migration)),
   but nothing cleaned it up live in the running editor. Fixed `removeElement` to also remove (and
   undo-restore) any connector referencing a deleted element
   (`packages/core/src/commands/commands.ts`), with a regression test in `commandBus.test.ts`.
4. **Ungroup announced success even when nothing happened.** `ungroupElement()` correctly no-ops on
   a non-container, but the Ctrl/Cmd+Shift+G keyboard shortcut called it unconditionally and
   announced "Ungrouped X" regardless — a screen-reader user could be told an action occurred that
   didn't. Fixed by gating the handler on `isContainer()`, matching the Edit-menu item's existing
   `canUngroup` gate (`apps/web/src/App.tsx`).

All four fixes verified live (not just re-run through unit tests) by reproducing each bug and its
fix end-to-end in a running browser; full core/ui-web/web unit suites and the Playwright a11y +
keyboard E2E specs all still pass.

**Remaining for M8:** the actual human sign-off pass. A live-browser accessibility-tree walk is a
strong proxy but isn't the same as a person's ears at a real screen reader judging phrasing,
timing, and verbosity — [Accessibility](07-accessibility.md#manual-screen-reader-script-voiceover--nvda)
now has a concrete ~20-minute script for that pass (VoiceOver or NVDA), written so any teammate can
run it without prior context.

**v1 exit criteria:** an architect builds a correct system-context + high-level diagram end to
end, exports a reviewer-grade SVG, reopens it; linter catches common violations; AA verified.

## v2 — Agent surface + VS Code

Make the same engine machine-authorable and put it where developers live.

#### M9 — MCP server (agent authoring toolset)

✅ **Done** (2026-07-24)

##### M9.1 — Catalog, document, authoring, and conformance/SVG-export tools

✅ **Done** (2026-07-24)

`packages/mcp` — a new workspace package, an MCP server exposing `core/api`'s `Editor` to agents
over stdio, so "agents and humans drive one engine" per D2/D15
([Agent Integration](08-agent-integration.md), [D15](00-decision-log.md#d15--mcp-full-authoring-toolset--locked-v2)):

1. `Editor` isn't headless by itself — its constructor needs a real `HTMLElement` container and its
   renderer touches bare DOM globals (D3's locked "live SVG DOM nodes"). `src/headlessEditor.ts`
   builds one jsdom `Window` at process start and copies the globals `Editor`/`io/export.ts`
   actually reference (`document`, `XMLSerializer`, `Image`, `URL`, `Blob`, ...) onto `globalThis`
   — the same thing `packages/core`'s own jsdom-based test suite already proves works, just outside
   a test runner. `packages/catalog-build` already depends on `jsdom` as a real dependency for the
   same kind of need — direct precedent in this repo.
2. 25 tools across four groups — catalog search/categories; document create/open/save/get; every
   `element_add_*`, update/move/delete, connect (exact-port + nearest-port auto-pick), group/ungroup,
   frame reorder; lint, quick-fix apply (single + all), SVG export. `src/catalog.ts` is a Node-native
   equivalent of `apps/web/src/catalog.ts`'s catalog loader (that one depends on Vite's
   `import.meta.glob`, unavailable in a plain Node process).
3. `quickfix_apply` takes a diagnostic **id**, not a raw diagnostic object — `Diagnostic.quickFix`
   is a live `Command` (closures), which cannot survive the JSON-RPC boundary. The server caches the
   most recent `lint()` results by id (`src/state.ts`) and looks the real object up server-side.
4. Every authoring/conformance/export/save tool requires an explicit `doc_create`/`doc_open` first
   (mirrors the human product's own forced "New Diagram chooser on first launch," M7.3, rather than
   silently authoring into a scene an agent never asked to start); `doc_create`/`doc_open` refuse to
   replace a document with unsaved changes unless called with `force: true`.
5. Tools return both a short human-readable summary and, where there's real structured data to
   reason over (ids, diagnostics, the full document), `structuredContent` validated against a zod
   `outputSchema`.
6. Tested by spinning up a real client+server pair per test over the MCP SDK's `InMemoryTransport`
   (25 tools, 5 test files, 15 tests) — a full protocol round-trip, not just calling handler
   functions directly. Additionally verified end-to-end over **real stdio**: the compiled server
   spawned as an actual subprocess, driven through `doc_create` → `element_add_icon` →
   `connect_nearest` → `lint` → `quickfix_apply_all` → `export_diagram` → `doc_save`, then reopened
   in a _second_, independent subprocess via `doc_open` to confirm the round-trip is real, not just
   in-memory.

**Deferred, explicitly** (not silently dropped):

- **PNG export.** `io/export.ts`'s `exportPng` itself requires a real browser canvas 2D context;
  jsdom doesn't implement canvas without the native `canvas` npm package (not installed anywhere in
  this repo, and unproven headless — no existing test coverage to lean on). `export_diagram`
  supports `format: "svg"` only until that's spiked and proven.
- **`editor.open({ path })`** (hand off to a running human-editor shell) — needs real
  application-launching/IPC that doesn't exist yet (no `apps/desktop`; `apps/web` is a dev-server-only
  Vite app). Belongs with `apps/desktop` (v3) or a VS Code integration, not this package.
- Agent Skills (M9.2, below) and `apps/vscode` (M10).

##### M9.2 — Agent Skills

✅ **Done** (2026-07-24)

`packages/mcp/skills/` — three composable `SKILL.md` packages
([D16](00-decision-log.md#d16--authoring--spec--export-agent-skills--locked-v2), [Agent Integration](08-agent-integration.md)):

1. **`ibm-diagram-spec`** — the conventions reference: element semantics (Box/Group/Zone/Actor/
   Connector), color usage, connector nomenclature (connection vs. relationship families,
   `flowColor`, cardinality), categories/tiers, west→east layout, and the linter's five rule
   categories. Self-contained (doesn't require repo access to `docs/`), since a skill package can
   travel to an agent independent of this repository.
2. **`ibm-diagram-authoring`** — the workflow: read a requirement for actors/locations/groupings/
   components/relationships, pick a diagram level (`doc_create`), resolve every icon through
   `catalog_search` (never invent a `catalogRef`), build outside-in with `parentId` chains, lay out
   west→east, pick the right `connectorType`/`flowColor`, and lint incrementally rather than only at
   the end. Includes a worked example: a full requirement-to-tool-call-sequence for a 3-tier
   VPC-hosted app.
3. **`ibm-diagram-export`** — validate (`lint`) → resolve via `quickfix_apply`/`quickfix_apply_all`
   (re-lint after, since diagnostic ids go stale) → `export_diagram` (SVG only — PNG still deferred
   per M9.1) → `doc_save` for the `.icad` source itself, which export doesn't touch.

`packages/mcp/src/skills.test.ts` guards all three against drift: it spins up a real MCP
client/server pair, lists the actual registered tools, and asserts every snake_case inline-code
token in each `SKILL.md` resolves to one of them — a typo'd or renamed tool reference fails CI
instead of silently misleading an agent.

**Deferred, explicitly:** hardening generation quality against a corpus of real requirement prompts
(the A2A "GenerateArchitectureDiagram" capability) needs an actual agent loop driving the MCP server
end-to-end and judging output quality — a live-agent evaluation pass, not something this
documentation-and-tooling change can self-verify. Tracked as follow-up before the v2 exit criteria
("an agent generates a valid, non-trivial topology from a paragraph a human accepts with minor
edits") are called met.

#### M10 — `apps/vscode`

🟡 **Built and tested; interactive F5 sign-off pending** (2026-07-24) — custom editor for `.icad`,
diagrams-in-repo next to code.

A new `apps/vscode` package: a VS Code `CustomEditorProvider` (own `CustomDocument`, not
`CustomTextEditorProvider`) registered for `*.icad`, per [Architecture](02-architecture.md#shells):
_"core runs in the webview, the extension host handles file I/O."_

1. **Two bundles.** `src/` is the extension host (plain Node, bundled with esbuild to
   `dist/extension.cjs`) — a thin file-I/O and undo/redo relay that never touches `.icad` semantics
   itself. `webview/` is the actual editor (Vite-built, `base: "./"` for the
   `vscode-webview:`-origin CSP), mounting the real `@icad/core` `Editor` + every `@icad/ui-web`
   Carbon component unchanged (Library/Properties/Layers/Validation panels, Find, Command Palette,
   New Diagram dialog, live-region announcements) — confirmed via direct reading that neither
   package has a browser-storage dependency, so only `apps/web`'s persistence layer (File System
   Access API, IndexedDB autosave, `localStorage` theme) needed replacing, not the editor itself.
2. **Undo/redo bridged to VS Code's own stack, not reimplemented.** The webview posts `{type:
"edit", content, label}` on `commands.onDispatch` — which never fires during `commands.undo()/
redo()` replay (`packages/core/src/commands/commandBus.ts`) — so the host's
   `onDidChangeCustomDocument` bridge and the engine's own `CommandBus` stay in exact 1:1 sync with
   no feedback loop; a separate `{type: "sync"}` message reports post-undo/redo content back to the
   host without pushing a spurious second stack entry. Ctrl+Z/Ctrl+Shift+Z are handled by VS Code
   natively, not by a second in-webview keybinding.
3. **Hot exit replaces autosave/crash-recovery outright** ([D10](00-decision-log.md#d10--autosave-draft--crash-recovery--locked))
   — `backupCustomDocument` writes the working copy to VS Code's own backup URI; no IndexedDB draft
   store or recovery banner was ported, since VS Code's tab dirty-dot and hot exit already cover
   that job for a custom editor.
4. **Theme follows VS Code**, not a manual light/dark/auto picker — the host pushes
   `{type: "themeKind"}` on webview-ready and on every `onDidChangeActiveColorTheme`.
5. SVG export relays `{type: "exportSvg"}` to the host, which shows a native Save dialog and writes
   via `vscode.workspace.fs`. `.icad`'s existing migration/repair pass runs unchanged inside
   `editor.loadIcad()` — no new validation code needed for hand-edited or stale files.
6. Tested with a hand-rolled fake of the `vscode` namespace slice touched (`Uri`, `EventEmitter`,
   `workspace.fs`, a fake `WebviewPanel`), the same reasoning `packages/mcp/vitest.config.ts` uses
   for staying off `jsdom` — 15 tests covering open/edit/save/save-as/revert/backup and, critically,
   that a `"sync"` message does **not** re-fire `onDidChangeCustomDocument` (the anti-feedback-loop
   guarantee the whole undo bridge depends on). Both bundles build cleanly; the whole workspace
   (`pnpm -r typecheck && pnpm -r lint && pnpm -r test`) passes with the new package included.
7. **Two real defects unit tests couldn't have caught, found by actually loading the extension**
   in an isolated VS Code instance (own `--user-data-dir`/`--extensions-dir`, never the user's live
   session) and reading its extension-host logs: (a) `package.json`'s `name` originally followed
   this repo's own `@icad/*` pnpm-workspace convention, but a VS Code extension identifier is
   `<publisher>.<name>` and rejects `@`/`/` — the manifest parsed but every declarative contribution
   (including `customEditors`) silently failed to register. Fixed by renaming to the bare
   `"icad-vscode"` plus an explicit `"publisher": "icad"`. (b) `activationEvents` was entirely
   absent from VS Code's parsed copy of the manifest even though `contributes.customEditors` was
   present — added an explicit `"onCustomEditor:icad.editor"` activation event rather than rely on
   implicit inference. Both are one-line manifest fixes with no code-path changes.

**Remaining for M10:** confirmed via extension-host logs that the corrected manifest loads with
zero errors and `contributes.customEditors` parses correctly, but did **not** reach a fully
conclusive confirmation that opening a `.icad` file actually resolves to our custom editor in
normal interactive use — every CLI-driven attempt to force that specific check hit VS Code
multi-instance/file-argument-timing quirks (a file passed as a CLI argument at cold start resolves
to the default text editor before extension scanning finishes; `--reuse-window` against an isolated
instance didn't reliably force a fresh open) that are about the _test harness_, not the extension
code — no error ever appeared for our code specifically across any of these attempts. An actual
interactive F5 ("Run ICAD Extension", `.vscode/launch.json`) pass in a real VS Code window — open a
`.icad` file by double-clicking it, place/connect/group elements, Ctrl+Z/Ctrl+Shift+Z, Save, and a
simulated-crash hot-exit recovery — is still needed, and matters more here than a formality: it's
the one check that would have caught both defects above just as fast as the log-diffing did, and
it's the only way to confirm the canvas itself renders and is interactive — the same kind of live
sign-off M8.3 called out as distinct from what an automated suite can confirm. This environment can
build and unit-test the extension and inspect a real (isolated) instance's logs, but has no
GUI/display access to drive a native VS Code window interactively (unlike a web page, there's no
devtools-style automation surface available here).

**Deferred, explicitly** (not silently dropped, same posture as M9.1's PNG-export deferral):

- Real `@vscode/test-electron` integration tests / browser E2E parity with `apps/web/e2e/`.
- External file-change live-reload (e.g. a git checkout while the editor is open).
- PNG export from the webview — it has a real `<canvas>` so `exportPng` should work, but SVG export
  shipped first and PNG wasn't exercised in this pass.
- Marketplace publishing polish (icon, README, publisher id, categories beyond the minimum).

**v2 exit criteria:** an agent generates a valid, non-trivial topology from a paragraph a human
accepts with minor edits; `.icad` opens identically in web and VS Code.

## v3 — Desktop + scale

Put the same engine on the desktop as a native app, and make sure it holds up at real-world
diagram sizes and catalog churn. Carries two open items forward from v1/v2 rather than blocking on
them: M8.3's human VoiceOver/NVDA sign-off and M10's interactive F5 VS Code pass both still need a
real device this environment doesn't have; they proceed in parallel with v3, not before it.

#### M11 — `apps/desktop` (Tauri shell)

🟡 **In progress** (2026-07-24) — scaffolded, themed, iconed, builds and bundles headlessly; the
interactive sign-off, code signing, and DMG packaging are what's left (all need a real machine).

Same "core runs in the webview, the host handles file I/O" split as
[M10](#m10--appsvscode) ([Architecture](02-architecture.md#shells)). Landed so far:

1. `apps/desktop` scaffolded via `tauri init` (`--ci`, non-interactive) and hand-tuned: a Tauri
   (Rust) host in `src-tauri/`, no separate webview package — `tauri.conf.json`'s `frontendDist`
   points straight at `apps/web`'s own build output (`../../web/dist`, `devUrl` at its Vite dev
   server) and `beforeDevCommand`/`beforeBuildCommand` just run `apps/web`'s existing `dev`/`build`
   scripts. `@icad/core` and `@icad/ui-web` are therefore reused unmodified, same as M10 confirmed
   possible — there's no `apps/desktop/webview/src` fork to keep in sync.
2. **Persistence reused as-is, per [D22](00-decision-log.md#d22--desktop-shell-reuses-webs-file-system-access--autosave-layer-unlike-vs-code--locked-v3)**:
   `apps/web`'s D9 File System Access path and D10 OPFS/IndexedDB autosave+recovery banner are
   completely untouched. The only new code is `apps/web/src/persistence/tauri.ts` — native
   Open/Save/Save-As via `@tauri-apps/plugin-dialog`+`plugin-fs`, a `consumeStartupFile()`/
   `onNativeFileOpen()` pair for the file-association path below — gated behind a synchronous
   `isTauri()` check (mirrors `@tauri-apps/api/core`'s own detection) and reached only through
   dynamic `import()`, confirmed via the production build output to code-split into their own
   small chunks that a plain browser build never fetches. `App.tsx`'s `persistIcad`/
   `handleOpenClick` now check `isTauri()` before falling through to the existing File System
   Access/download-fallback branches, unchanged.
3. Native `.icad` file associations: `tauri.conf.json`'s `bundle.fileAssociations` registers the
   extension for the platform bundler to wire into Info.plist/registry/desktop-entry. The Rust host
   (`src-tauri/src/lib.rs`) covers both OS delivery mechanisms — Windows/Linux hand a launched
   process the path as an argv, parsed by `icad_path_from_args`; macOS delivers "Open With" as a
   `RunEvent::Opened` run-loop event instead, including on a cold first launch. A cold-start path is
   exposed once through a `get_startup_file` command (an emitted event would race the frontend
   attaching its listener) while `tauri-plugin-single-instance` — registered first, a Tauri
   requirement — redirects a second launch's path into the already-running window via an
   `icad://open-file` event and focuses it, rather than spawning a duplicate process.
4. `capabilities/default.json` grants `fs:allow-read-text-file`/`allow-write-text-file` an
   intentionally unscoped `"path": "**"` — a general-purpose file-associated editor has to reach any
   user-chosen path, not just an app-sandboxed one — flagged here as a real security-relevant choice
   worth a dedicated review before packaging for actual distribution, not asserted as final.
5. `app.security.csp` was tightened from `tauri init`'s default `null` to a same-origin policy
   (`default-src 'self'`, plus `data:` for the already-bundled IBM Plex fonts/icons); `identifier`
   set to a placeholder `com.ibm.icad.desktop` pending a real IBM-issued reverse-DNS id before any
   real code-signing/distribution.
6. **Real app icon, sourced from IBM's own catalog, not invented.** `apps/desktop/app-icon.svg`
   recolors the `ibm-cloud` glyph from
   [Icon Catalog](04-icon-catalog.md) (`packages/catalog/2.0.0/icons/network/ibm-cloud.svg`, the
   pinned IBM-Cloud/architecture-icons stencil) white-on-IBM-Blue-60, centered in a rounded square
   per macOS's convention of baking the icon's silhouette into the artwork rather than relying on
   OS masking. `pnpm tauri icon app-icon.svg` regenerated every platform size/format from it (the
   iOS/Android variants it also produces were deleted — v3 has no mobile target); a rebuild
   confirmed the bundled `.app`'s `icon.icns` byte-for-byte matches the regenerated one. Still an
   explicit placeholder pending real IBM Design sign-off before any real distribution, same as
   [D21](00-decision-log.md#d21--container-presets-are-a-named-shortcut-layer-not-new-element-types--locked)'s
   posture on unconfirmed presets.
7. **Native window chrome now follows the resolved theme, not just launch-time config.**
   `persistence/tauri.ts`'s `setNativeTheme()` calls `@tauri-apps/api/window`'s
   `getCurrentWindow().setTheme()` whenever
   [M7.4](#m74--top-bar-command-palette-find-frame-presentation-theme-persistence)'s persisted
   preference changes: `"auto"` passes `null` (hands the titlebar back to the OS, live — the same
   behavior an unset window `theme` config already gave for free); an explicit light/dark choice
   forces the titlebar to match, rather than leaving native chrome OS-driven while the canvas itself
   has been overridden. The in-canvas theme resolution itself
   (`useResolvedTheme`'s `matchMedia("(prefers-color-scheme: dark)")` listener) was already
   correct under any modern webview and needed no changes.
8. **PNG export UI — the real gap was bigger than "unexercised under Tauri": `apps/web` never had a
   PNG option in its Export dialog at all**, in either shell, even though `core/io/export`'s
   `exportPng` (scale 1×/2×/3×, transparent/white background) has existed since
   [M5](#m5--icad-io--export). Added a format selector (SVG/PNG) plus PNG's scale/background
   controls to the shared Export modal, and a unified `handleExport` dispatching to
   `handleExportSvg`/`handleExportPng`. Both now save through a new `saveExport()` helper: a native
   Save dialog via `persistence/tauri.ts`'s `saveExportNative()` (`@tauri-apps/plugin-dialog` +
   `plugin-fs`'s binary `writeFile`) under Tauri, the pre-existing browser `downloadBlob()`
   otherwise — so SVG export on desktop gained a real native Save-As for free in the same change,
   where it previously always silently dropped into the Downloads folder even when running in
   Tauri. This lands in `apps/web` only, so it also reaches the browser shell and — per D22 — desktop
   for free; `apps/vscode`'s separately-forked `webview/src` still carries its own PNG deferral from
   [M9.1](#m91--catalog-document-authoring-and-conformancesvg-export-tools)/[M10](#m10--appsvscode)
   untouched.
9. Verified headlessly in this environment (no GUI/display access here, so nothing below is a
   substitute for an interactive pass): `cargo check` passes for the Rust host — which also
   validates `tauri.conf.json` and `capabilities/default.json` parse correctly, since
   `tauri::generate_context!()` parses both at compile time; `apps/web`'s own typecheck/lint/test/
   build all still pass with every new code path added (24 tests in `persistence/tauri.test.ts` —
   dialog cancel, Save vs. Save-As, startup-file/relaunch-event handling, native theme sync, native
   export save); `cargo tauri build` completed two full release compiles (before and after the icon
   swap) and produced a working `ICAD.app` each time — its generated `Info.plist` confirms
   `bundle.fileAssociations` round-tripped correctly into a real `CFBundleDocumentTypes` entry for
   `.icad`, and the bundled `icon.icns` was confirmed byte-identical to the freshly generated one.
   The `.dmg` packaging step itself hung on the first attempt and had to be killed (later rebuilds
   used `--bundles app` to skip it): `bundle_dmg.sh` drives Finder over AppleScript to lay out the
   disk-image window, which needs a real interactive WindowServer session this sandbox doesn't have
   — a known limitation of headless macOS (unrelated to anything in this change; unconfirmed
   whether it reproduces on a real CI runner or a human's own machine, both of which typically have
   one).

**Not yet done:**

- `.dmg` packaging — confirmed hanging in this specific sandbox (see above), not yet retried
  anywhere with a real WindowServer session.
- Code signing/notarization (an IBM org/certificate dependency, not a code task — same posture as
  [D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)'s sign-off gate) and the actual
  interactive pass: open by double-click, Open/Save/Save-As, native file association end to end,
  offline launch. Same limitation M10 hit — this environment can build, bundle, and unit-test the
  app but has no GUI/display access to drive a native window interactively.

**Done when:** a `.icad` file opens identically in web, VS Code, and desktop; double-clicking a
`.icad` file launches or focuses the desktop app and loads it; SVG and PNG export both work
natively; the app runs fully offline post-install.

#### M12 — Performance at scale

🟡 **In progress** — the benchmark landed as [M15 step 7](#m15--interaction-foundations)
(`packages/core/src/perf/benchmark.test.ts`), per the overlap note this section used to carry.
What remains here is purely the virtualization decision that benchmark informs.

[D3](00-decision-log.md#d3--svg-dom-rendering--locked) flagged viewport virtualization as something
"very large diagrams may need... later" — benchmark first, build only if the benchmark demands it:

1. ✅ Generate synthetic large diagrams (500 / 1,000 / 2,000 elements and connectors) and measure,
   headlessly in `packages/core` under its own jsdom Vitest environment: initial load, hit-testing,
   lint pass time, pan/zoom, and command-bus dispatch/undo/redo. Results and budgets in
   [Canvas parity plan → M15 step 7](10-canvas-parity-plan.md#m15--interaction-foundations).
2. Only if a real threshold is breached, add viewport virtualization to the SVG renderer: cull
   off-screen elements from the live DOM while keeping them in the scene model and hit-testing
   index. This touches several things M8 built on the assumption of a fully-materialized DOM —
   DOM-based hit-testing, the `aria-owns` nested a11y tree
   ([M8.2](#m82--connectgroup-interactions-nested-object-tree-live-regions-real-browser-ci)), and
   keyboard tab order ([M8.1](#m81--baseline-canvas-keyboard-operation-rolesnames-ci-a11y-checks))
   — all need re-verification against a partially-virtualized DOM, not just the renderer itself.
3. ✅ The benchmark doesn't show a real rendering/hit-test/lint problem at 500-2,000 elements —
   documented instead of building virtualization, which stays un-started unless a real diagram
   breaches it. It did surface a different, real problem (C13: dispatch/undo/redo cost scales with
   total diagram size, not gesture size, because they re-run a full-scene render+lint pass) — not
   a virtualization question, and tracked separately for [M16](#m16--the-core-loop) to account for.

**Done when:** a documented benchmark exists for render/pan/zoom/hit-test/lint at defined element
counts (✅); virtualization ships only if that benchmark demanded it (it didn't, so this stays
un-started), with a11y/keyboard coverage re-verified against the virtualized DOM if it ever does.

#### M13 — Catalog refresh cadence + migration tooling

⬜ **Not started**

1. Define the refresh trigger: how `packages/catalog-build` re-pins a newer
   `IBM-Cloud/architecture-icons` commit — an IBM Design-signaled manual re-pin
   ([D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)) rather than an unattended
   scheduled job, consistent with this being an IBM-gated tool.
2. Build a diff tool comparing the generated catalog directory across versions (e.g.
   `packages/catalog/2.0.0` vs. a new `3.0.0`) — added / renamed / removed icons — to catch
   `catalogRef` breakage before it reaches a shipped `.icad`.
3. Decide and implement the resolution story for a `.icad` document whose `catalogRef` no longer
   exists in the currently bundled catalog version: today [File Format](03-file-format.md#versioning--migration)'s
   repair pass only handles structural issues (dangling `parentId`, degenerate geometry, …), not a
   missing catalog reference. Likely a placeholder/greyed icon plus a dedicated linter diagnostic
   rather than a hard load error, tracked against a bundled-catalog-version field alongside the
   `.icad` schema version already recorded.
4. Decide whether catalog-ref migrations belong in the same (currently empty) migration registry
   `core/io` already has for `.icad` schema bumps ([M5](#m5--icad-io--export)), or a separate
   registry — don't conflate the two without deciding explicitly.

**Done when:** a documented, exercised process re-pins the catalog to a new IBM stencil release
end-to-end, with a defined (not silent) outcome for any `.icad` file left referencing a
now-missing icon.

**v3 exit criteria:** `apps/desktop` ships with native `.icad` file associations on macOS, Windows,
and Linux, and opens a document identically to web and VS Code; a documented performance benchmark
exists for large diagrams (or is inherited from M15, per M12's note), with virtualization shipped
only if it was actually needed; the catalog refresh process has been exercised at least once
end-to-end with a defined missing-icon story.

## v4 — Canvas parity

Make the canvas render what IBM actually specifies, and make it directly manipulable. Full plan,
audit evidence, and per-defect provenance in
[Canvas parity plan](10-canvas-parity-plan.md); decisions in
[D25–D28](00-decision-log.md#canvas--direct-manipulation). This is the largest single body of work
in the project. M14 (visual conformance — icons, connectors, container tabs) is done; M15–M20
(direct manipulation) remain and are what a first-time user notices most — today the canvas has no
drag, no resize, no marquee, and no clipboard.

**Sequencing note:** M14 fixed a live correctness defect against
[D5](00-decision-log.md#d5--crisp--professional-visual-style--locked)/[D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)
— the shipped icon set was visually wrong — so it was pulled ahead of M12/M13 rather than waiting
for v3 to close. M15–M20 genuinely depend on v3-era stability and should not be.

#### M14 — IBM visual conformance

✅ **Done**

Renderer and catalog only; no interaction changes. Audited against the _IT architecture diagrams
kit_ v1.1 deck and the IBM 2.0 `.drawio` stencils vendored in
`packages/catalog-build/.cache/architecture-icons/`.

1. ✅ **Icon tiles.** IBM's icon is a 48×48 solid category tile with a 24×24 white glyph inset by
   12 (actors: solid black circle). `extract.ts` regenerated all 242 icons off the corrected
   framing ([D25](00-decision-log.md#d25--icons-render-as-ibm-authors-them-solid-tile-white-glyph--locked)).
   Caught and fixed two bugs before shipping: both extraction paths (`extract.ts` and
   `extractDrawioLibrary.ts`, the latter feeding the 35-icon Groups category) were still framing
   glyphs into a 0..20 space against the renderer's corrected 0..24 expectation; the on-disk SVG
   files also declared a stale `viewBox="0 0 20 20"` wrapper independent of the three loaders that
   strip it at runtime. No `.icad` migration: icons are referenced by `catalogRef`.
2. ✅ **Connector markers.** Open-V arrowhead (`endArrow=open`, per `Connectors.drawio`) for
   dependency/association/aggregation/composition, distinct from implementation/extends's closed
   hollow triangle. `logical-connection`'s dash fixed to even (was dash-dot), default stroke width
   2 (was 1.5), tunnel bands fixed to `#FFD7D9` (confirmed directly in the vector source) with
   Carbon Yellow 30 for the double variant (a reasoned placeholder — no literal value exists for it
   anywhere in `Connectors.drawio`). Physical connection's hollow box caps were already correct and
   untouched. Added human-readable connector-type labels to the Properties panel, which previously
   showed the raw kebab-case schema value with no label map at all.
3. ✅ **Connector type display name.** No new type: `Connectors.drawio` stores "Tunneling
   Connection" as a caption cell with no edge behind it, not a distinct line style — the schema's
   existing `tunneling-connection` type already rendered correctly (band + solid line + arrow) as
   what IBM actually labels "Traffic Through Tunnel/Encapsulation". Fixed as a Properties-panel
   display-label correction; no schema or `.icad` change. _(This corrects the original audit
   finding, which misread the raster deck image as implying a 12th connector type — the stencil
   XML, a higher-precedence [normative source](05-ibm-spec-conformance.md#normative-sources),
   settled it before any code was written against the wrong premise.)_
4. ✅ **Container sidebar tab** on Group and Zone, not Box alone, colored to each container's own
   accent — IBM's worked examples draw it on every container. Frame excluded (no IBM semantic).
5. ✅ **Sequencing badge** — a short free-text badge (e.g. "1", "2a") in a small circle at the
   connector's midpoint, settable via the Properties panel or MCP.
6. ✅ **Structured connector labels** — `ConnectorAnnotation { name, security?, port? }`, formatted
   via `formatConnectorAnnotation` as `NAME SECURITY:PORT` (e.g. `HTTPS TLS1.3:443`), with the
   Properties panel switching the name field's label between "Protocol/Application name" and
   "Encapsulation name" based on the connector's own type. A new linter rule flags a security/port
   set with no name, and a non-numeric port. Both additions are purely additive optional fields —
   neither needed a `.icad` version bump or migration entry.
7. ✅ **Golden fixtures.** Not a `.drawio` parser — building one, even test-only, would cut against
   [D7](00-decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked)'s locked
   "no `.drawio` import," which exists precisely because a full mxGraph mapping surface is large
   and fragile; that reasoning doesn't stop applying just because the importer is dev-only.
   Instead, `svgRenderer.goldenFixtures.test.ts` hand-reproduces the `iks_sr_mz_vpc` reference
   diagram's structure (Client → IBM Cloud → Region → OpenShift → Zone → Subnet → NLB/ALB/Worker
   Nodes) using ICAD's own authoring API against the real bundled catalog — not synthetic fixture
   icons — and asserts the M14 fixes directly: solid actor/icon tiles with white glyphs, a colored
   sidebar tab at every nesting depth, corner glyphs recolored to each container's own accent, and
   correct connector flow colors/stroke width. Rendered and rasterized for a final visual check
   against the original reference image during development.

**Done when:** a side-by-side render of `iks_sr_mz_vpc` against IBM's own export matches on icon
fill, glyph color, connector markers, dash patterns, stroke width, and container tabs; all 11
connector types round-trip through `.icad`, the linter, and MCP with corrected display labels.

#### M15 — Interaction foundations

✅ **Done.**

No user-visible features; everything after this depends on it. Full detail in
[Canvas parity plan → M15](10-canvas-parity-plan.md#m15--interaction-foundations).

1. ✅ Ephemeral gesture layer ([D26](00-decision-log.md#d26--gestures-are-ephemeral-commits-are-commands--locked)):
   `Editor.beginInteraction()`, `SvgRenderer.previewTransform()`.
2. ✅ Partial + order-correct rendering: `render()` now reconciles DOM order to z-order (previously
   never happened), plus `renderElements()` for targeted re-renders.
3. ✅ Unified hit-testing: `hitTest`/`hitTestAll`/`hitTestRect`, connectors hit via real polyline
   distance instead of their degenerate bbox, containment-aware instead of an incidental z-order
   heuristic. Both `apps/web` and `apps/vscode`'s divergent DOM-based click-selection path are
   replaced with it.
4. ✅ The `CanvasController` interaction state machine moved into core
   ([D27](00-decision-log.md#d27--the-interaction-state-machine-lives-in-core-not-the-shells--locked)):
   click/shift-click select, keyboard nav/nudge/delete, and mouse + keyboard connect flows, wired
   into both `apps/web` and `apps/vscode`, whose `App.tsx` canvas elements no longer carry any
   interaction handlers of their own. Pan/marquee/drag/resize/rotate modes are new gestures for
   [M16](#m16--the-core-loop) to add to this same class, not something this step migrated.
5. ✅ The snapping engine (`snapMove()`): grid snap, sibling edge/center alignment, and the 16px
   parent inset as a hard constraint. Not yet wired into a live drag gesture — that lands with
   [M16](#m16--the-core-loop)'s drag-to-move.
6. ✅ Confirmed no forked interaction logic remains between `apps/vscode`'s `webview/src` and
   `apps/web`: every shared file (`placement.ts`, `validation.ts`, `main.tsx`) is identical or
   differs only in import-path depth (`catalog.ts`); `App.tsx`'s remaining differences are
   genuinely host-specific (file persistence, theme sourcing, PNG export); both import the same
   symbol set from `@icad/ui-web`.
7. ✅ The benchmark M12 also needs (`packages/core/src/perf/benchmark.test.ts`): synthetic
   500/1,000/2,000-element diagrams timing load, hit-test, lint, pan/zoom, and dispatch/undo/redo.
   Pan/zoom stay sub-millisecond at every size; everything else scales with diagram size as
   expected — except a single 10-element move, which costs roughly a full re-render (~2s at 2,000
   elements) because dispatch/undo/redo each re-run the full-scene render+lint pass, not just the
   changed ids. That's a new finding (C13 in the
   [canvas parity plan](10-canvas-parity-plan.md#confirmed-defects)), not the virtualization
   question this milestone was checking for — full detail and the observed numbers are there.

**Done when:** a scripted 200-frame drag of a 40-element subtree holds frame budget, produces
exactly one undo entry, and runs the linter exactly once; all three shells drive the canvas through
the same `CanvasController` with no shell-local interaction code.

#### M16 — The core loop

✅ **Done** — all 7 items have landed: M16.1 (drag-to-move), M16.2 (8-handle resize), M16.3
(marquee selection + Ctrl/Cmd+A), M16.4 (double-click to drill into a nested container), M16.5
(clipboard), M16.6 (right-click context menus), and M16.7 (Alt+click select-through); see
[Canvas parity plan → M16](10-canvas-parity-plan.md#m16--the-core-loop).

Drag-to-move, 8-handle resize, marquee (fully-enclosed), select-all, clipboard
(copy/cut/paste/duplicate/Alt-drag clone), context menus, Alt+click select-through, and
double-click to drill into a nested container with both bounding boxes shown — the last three
straight from the kit's own "Prescribed location / Scaling elements" instructions to IBM users.
Every gesture ships with its keyboard equivalent in the same PR;
[D19](00-decision-log.md#d19--full-ibm-equal-access--wcag-21-aa--locked) is a requirement, not a
follow-up.

1. ✅ **Drag-to-move.** `CanvasController` migrated from mouse to Pointer Events with
   `setPointerCapture` (D27) and gained its first `dragging` mode: a drag threshold, Shift
   axis-lock, Escape-to-abort, and live snapping (grid/sibling/16px inset via M15's `snapMove()`,
   wired into a real gesture for the first time) — built on `Editor.beginInteraction()`/
   `SvgRenderer.previewTransform()` (D26), also their first real caller. Alongside it, fixed a
   perf gap the drag would otherwise have made painfully visible: `Scene._transaction()` now
   coalesces every `_put`/`_remove` a single command makes into one change event instead of one
   per element, and `createEditor.ts`'s subscription repaints just the affected ids
   (`SvgRenderer.renderElements()`, extended to also repaint any attached connector and resync tab
   order) instead of the whole scene for a position-only change — see C13 in the
   [canvas parity plan](10-canvas-parity-plan.md#confirmed-defects), now resolved. Keyboard parity
   for this gesture was already satisfied by M8's arrow-key nudge; no new keyboard code was needed.
2. ✅ **8-handle resize** (Shift aspect-lock, Alt resize-from-center). `CanvasController` gained a
   `resizing` mode alongside `dragging`, on the same Pointer Events/`setPointerCapture` plumbing;
   unlike drag there's no threshold (grabbing a handle is unambiguous) and no move-with — an
   edge/corner handle that shifts the element's own x/y (e.g. the west edge) must not cascade that
   shift onto descendants the way a real move does, so `Editor.beginResizeInteraction()` dispatches
   a bare `updateElement` patch, not `moveElements`. The geometry math itself
   (`interaction/resize.ts`'s `resizeBounds()`) is pure and unit-tested standalone. Live preview
   reuses D26's ephemeral-gesture pattern but needed a new `SvgRenderer.previewResize()`, since
   resize changes intrinsic w/h that `previewTransform`'s translate-only preview can't express —
   it re-renders the one element (and redraws the selection outline/handles/validation-badge
   position to match) without touching the scene. No grid/sibling/16px-inset snapping yet, per
   M17's own "live 16px buffer enforcement... rather than the pad applying only at group creation."
   Keyboard parity needed no new code: the Properties panel's typed X/Y/W/H fields already covered
   it, mirroring how M16.1 found arrow-key nudge already covered drag-to-move.
3. ✅ **Marquee selection (fully-enclosed) and Ctrl/Cmd+A.** A new `marquee` mode on
   `CanvasController`, armed by a pointerdown on empty canvas or a Frame's own background (a Frame
   has no drag semantics and typically spans most of the canvas, so treating it like any other
   selectable element would make its interior impossible to rubber-band). No separate commit step
   like drag/resize — `hitTestRect` + `selection.set()` run live on every move, Shift unions with
   the pre-drag selection instead of replacing it, and Escape restores that snapshot. Ctrl/Cmd+A
   is genuinely new keyboard code (unlike M16.1/M16.2's nudge/Properties-panel reuse) since nothing
   pre-existing covered "select everything."
4. ✅ **Double-click to drill into a nested container**, both bounding boxes shown, Escape to step
   out. Tracked as its own `drillPath` on `CanvasController` (a persistent scope, not a
   `CanvasMode`, since you can still drag/resize/marquee while drilled) rather than changing what a
   plain click resolves to — M15's C9 fix already always hit-tests to the deepest element, so
   reaching a nested child directly never needed drilling. The functional change is what a
   press-drag on the drilled container's own background now does: it arms a marquee scoped to that
   container's descendants instead of moving it, generalizing the Frame carve-out M16.3 already
   needed. `SvgRenderer.setDrillPath()` renders each ancestor in the chain as a new faint,
   undashed outline alongside (not instead of) the existing active-selection outline, so both
   render at once per IBM's prescribed model. Keyboard parity: a second Enter on an
   already-selected, already-focused drillable container drills into it, mirroring the two clicks
   in a double-click; Space stays pure toggle-selection and never drills.
5. ✅ **Clipboard**: copy/cut/paste/duplicate, Alt-drag clone, paste-at-cursor. An in-memory
   `Editor` clipboard, not the OS one — `apps/vscode`'s webview sandbox makes `navigator.clipboard`
   permissioning inconsistent across shells (the same reason M15 skipped PNG export there), and an
   internal clipboard needs no permission prompt and is trivially keyboard-testable either way.
   `copy()` expands to descendants plus any connector with both endpoints copied (one crossing the
   boundary stays attached to the original, the same rule an uncopied container's own child
   follows). `paste()`/`duplicateElements()` share one clone engine (`cloneElementsForPaste()`);
   paste centers on an explicit point (`CanvasController`'s last-tracked pointer position — "paste
   at cursor") or cascades a 16px offset further each keyboard press with none given.
   `duplicateElements()` stays independent of the copy/cut/paste clipboard (so duplicating doesn't
   clobber a pending paste) and is also Alt-drag-clone's engine: a new `cloneOnDrag` flag on the
   existing `dragging` mode swaps the dragged ids for a fresh duplicate the moment the drag crosses
   its threshold, leaving the originals untouched. No new keyboard code needed — copy/cut/
   paste/duplicate are inherently keyboard gestures (Ctrl/Cmd+C/X/V/D), and Alt-drag-clone's own
   equivalent is that same duplicate plus arrow-key nudge, both already covered. Surfaced and fixed
   **C14** (canvas parity plan): `SvgRenderer.syncDomOrder()`'s blanket re-append on any scene
   addition was silently blurring keyboard focus to `<body>` in a real browser (invisible to
   jsdom), breaking every keyboard shortcut after the first add — now a minimal-move reconciliation
   that only touches nodes actually out of place.
6. ✅ **Right-click context menus**, contextual to the hit target. `CanvasController` only reports
   _where_ — a new `onContextMenu(screenPoint, scenePoint)`, plus the Menu key / Shift+F10 keyboard
   equivalent — after syncing `selection` to the hit target (unselected replaces it, part of a
   multi-selection leaves the group alone, empty canvas/a Frame clears it). _What_ the menu shows
   is entirely a new `@icad/ui-web` `ContextMenu` component, a thin wrapper over Carbon's own
   `Menu`/`MenuItem`, reusing the exact `CommandItem[]` shape the command palette already uses (a
   new optional `danger` field renders Delete in Carbon's destructive styling) so every action —
   Cut/Copy/Paste/Duplicate/Delete/Group/Ungroup/Select All — is defined once per shell. Paste
   passes the exact scene point the menu opened at, landing where you actually right-clicked.
7. ✅ **Alt+click select-through to an occluded element.** A plain click already always lands on
   the deepest element at a point (M15's C9), so Alt+click's job is reaching every _other_ element
   sharing it: a new `altClickCycle` tracks the last Alt+click's client point and stack index,
   cycling one step deeper through `hitTestAll`'s full ordered stack each repeated Alt+click at the
   same spot and wrapping back to the top once exhausted; a different point resets to that point's
   own deepest element. Always replaces the selection outright — a reveal tool for one specific
   occluded element, not a multi-select gesture. No new keyboard code needed: Tab/Shift+Tab's tab
   order (M8) already reaches every element regardless of visual overlap.

#### M17 — The feedback layer

🟡 **In progress** — M17.1 (space+drag and middle-drag panning) has landed; see
[Canvas parity plan → M17](10-canvas-parity-plan.md#m17--the-feedback-layer).

Rendered grid and snapping, alignment guides with spacing hints, drop-target highlight, live 16px
buffer enforcement, containers that auto-grow rather than let children escape, child reflow on
container resize, alternating fills re-derived on reparent, live dimension readout, and
space-drag/middle-drag panning.

#### M18 — Arrangement

⬜ **Not started** — blocked on M15's DOM reordering.

Z-order, 6-way align, distribute, lock/hide, and an interactive Layers tab.

#### M19 — Connector editing

⬜ **Not started**

Waypoint drag handles (`setConnectorWaypoints` already exists in core, merely unexposed), endpoint
retargeting, reset-to-auto-routing, and in-place label editing on the line.

#### M20 — Full range on demand

⬜ **Not started**

Last, because rotation is the most invasive change in the plan. Rotation handle with 15°
Shift-snapping plus rotation-aware hit-testing, handles, ports, and bounds; a color picker beyond
the 9 IBM pairs; and two new linter rules flagging non-zero rotation and off-palette color as
off-spec ([D28](00-decision-log.md#d28--constrained-defaults-full-range-on-demand--locked)).

**v4 exit criteria:** a render of an IBM-authored template is visually indistinguishable from IBM's
own export; an architect builds a nested multi-zone diagram end to end using only the mouse, and
again using only the keyboard, with drag, resize, marquee, clipboard, alignment, and connector
editing throughout; every new capability is reachable from the MCP surface; AA re-verified.

## Explicitly deferred / revisit later

- Real-time multi-user collaboration ([D4](00-decision-log.md#d4--local-first-single-user-files--locked) is single-user by design).
- `.drawio` import / round-trip ([D7](00-decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked)).
- Cloud sync / share links / accounts.
- Public open-source release (depends on IBM decision, [D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)).

## Cross-cutting throughout

- IBM Design sign-off gates each release ([D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)).
- Tests grow with features: Vitest (core), Playwright (web + keyboard E2E), CI a11y.
- Every human-editor capability lands as a **command** so the v2 MCP server inherits it for free.
  From v4 on, a _gesture_ is ephemeral and a _commit_ is the command
  ([D26](00-decision-log.md#d26--gestures-are-ephemeral-commits-are-commands--locked)) — in-flight
  drag state is deliberately not part of the document, the undo history, or the MCP surface, but
  every committed mutation still is.
- From v4 on, interaction lives in `packages/core`, not the shells
  ([D27](00-decision-log.md#d27--the-interaction-state-machine-lives-in-core-not-the-shells--locked)),
  so a new gesture reaches web, VS Code, and desktop in one change rather than three.
