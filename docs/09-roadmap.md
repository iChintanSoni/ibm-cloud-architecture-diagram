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
  SVGs): 207 icons across 10 categories. See [Icon Catalog](04-icon-catalog.md).
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
  remain withheld pending IBM Design confirmation.

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
   (by design), but a connector attached to one of those descendants from *outside* the deleted
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
