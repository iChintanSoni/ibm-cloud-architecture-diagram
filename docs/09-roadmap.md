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
- `core/catalog` runtime search/resolve. Keywords are auto-tokenized from each icon's own literal
  upstream name at build time, with a manual `packages/catalog-build/src/keywordOverrides.ts` table
  layered on top for architecture terms with no name overlap — first added for `"region"`, `"cache"`,
  `"on-prem"`/`"on-premises"` (M22.3, 2026-07-30), extended for `"lb"` (all 9 load-balancer icons),
  `"k8s"` (Kubernetes specifically, not OpenShift), and `"vm"`/`"vsi"` (Virtual Server only, not the
  more specific instance-profile/group icons) after `apps/web` dogfooding found all four as genuine
  zero-result searches (M25.2, 2026-08-04). Each override is hand-applied directly to the already-
  generated `packages/catalog/2.0.0/index.json` too, since a full `pnpm generate` rebuild is gated
  behind IBM Design sign-off and out of scope for a keyword-only fix.

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
  diagrams routinely cross a box/zone boundary. (M23.1, 2026-07-31) Containers unrelated to
  either endpoint (not an ancestor/descendant of, or equal to, the endpoint) add a soft routing
  cost instead — never a hard block, so an unrelated sibling container is avoided when a cheap
  detour exists but can still be crossed if that's genuinely the only option
  (`containerAvoidanceRectsFor` in `routeConnector.ts`). (M23.2, 2026-07-31) The soft-obstacle
  channel is now generic (`SoftObstacle { rect, penalty }`, `orthogonalRouter.ts`) rather than
  container-specific, so a second, independent producer can share the same mechanism: every
  container's own label footprint (`containerLabelRect`, `render/containerLabel.ts` — a heuristic
  estimate, since no real text measurement exists anywhere in this headless-capable core) is a
  soft obstacle for every connector with no relatedness exemption, unlike the unrelated-container
  case above — even a connector's own legitimately-entered ancestor container's label is worth
  avoiding. (M23.3, 2026-08-01) The `PORT_FAN_SPAN_RATIO` spread that keeps multiple connectors
  sharing one (element, side) from stacking on the same point now has a `MIN_PORT_SEPARATION_PX =
16` floor as well — the ratio alone divides a fixed span more finely as sibling count grows, so
  it got _tighter_ with more connectors on a side, and on a typical 48px icon with 2 siblings
  worked out to under 10px, barely clearing a single 7x7px arrowhead marker's own width before the
  next one started.
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

#### M26 — Reference architecture templates

✅ **Done** (2026-08-04)

Extended M7.3's template mechanism with 4 new, fixed built-in templates — faithful reproductions of
IBM's own published "Single Region, Multi-Zone" Kubernetes/OpenShift reference architectures
(see [D30](00-decision-log.md#d30--iksroks-single-region-multi-zone-reference-diagrams-ship-as-4-built-in-templates--locked)
for the full source→catalog icon mapping and the fidelity trade-offs made along the way):

1. Added `iks-sr-mz-classic`, `iks-sr-mz-vpc`, `roks-sr-mz-classic`, `roks-sr-mz-vpc` as new
   `DiagramTemplateId` values, decoupled from `DocumentMeta["diagramLevel"]` (all 4 map to
   `"detailed"` via a new `TEMPLATE_DIAGRAM_LEVEL` lookup) — these are worked examples at IBM's
   existing detailed/deployment level, not a 5th diagram level.
2. Added `packages/core/src/templates/referenceArchitectures.ts`: one parametrized builder
   (distribution × infrastructure) producing the full Client → Multi-zone LB → 3× (Availability
   Zone → Subnet → Load Balancer → 2 Worker Nodes) skeleton, called 4 times for the 4 fixed,
   independent product-facing ids. Moved the shared `frame`/`actor`/`icon`/`connector` element
   builders out of `templates.ts` into a new `elementBuilders.ts` so both modules could reuse them
   without a runtime circular import.
3. `NewDiagramDialog` gained a second, separately-labeled "Reference architectures" radio group
   alongside the existing "Diagram level" group, sharing one selection/create flow.
4. `packages/mcp`'s `diagramTemplateIdSchema` and `doc_create` description grew to cover the 4 new
   ids, so agents can seed these templates the same way humans do.
5. Covered all 4 templates with core template tests (structure/containment/serialization validity,
   `diagramLevel` resolution, and an exact expected-diagnostic-count assertion for the documented,
   advisory-only lint categories — see D30, count since revised by the M27 router/lint-quality
   pass and M28.1's Subnet header-overlap fix) and a `NewDiagramDialog` component test for the new
   radio group and its `onCreate` id.

**Done when:** a user can pick any of the 4 IKS/ROKS × Classic/VPC reference architectures from the
New Diagram dialog (or an agent via `doc_create`), get a structurally faithful, fully-labeled
starting diagram matching IBM's own published reference, and continue editing it through the shared
command surface like any other template.

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
7. `scene_apply` (M23.4, 2026-08-03): a batch tool accepting an array of add/connect operations,
   applied as one call and one undo step — a dogfooding session found building one realistic
   diagram needed 26 separate `element_add_*`/`connect*` round-trips, since call count scaled
   linearly with diagram size. `Editor.applyBatch` (`core/api/createEditor.ts`) validates every op
   against a disposable scratch `Scene` (seeded from the real one) before touching the real scene or
   dispatching anything — all-or-nothing, with every failing op reported, not just the first — so a
   connect op can reference an element added earlier in the same batch (needs an explicit id to be
   referenced that way) without risking a partially-applied, un-undoable batch if a later op turns
   out invalid.

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
10. **Two real defects found by actually using the shipped `v0.1.0` desktop build**, neither caught
    by `tauri.test.ts`'s mocked `writeFile`/`writeTextFile` calls because both are Tauri IPC
    permission/CSP checks that only apply at runtime, below what a JS-level mock exercises:
    (a) `capabilities/default.json` granted `fs:allow-write-text-file` (for `.icad` save) but never
    `fs:allow-write-file` — the binary-write permission `saveExportNative()` actually calls — so
    every native export, SVG included, silently failed the IPC call; (b) `app.security.csp`'s
    `img-src` allowed `'self' data:` but not `blob:`, and `exportPng()`
    ([`packages/core/src/io/export.ts`](../packages/core/src/io/export.ts)) rasterizes by loading
    the intermediate SVG into an `<img>` from a `URL.createObjectURL()` blob: URL — blocked by the
    webview's CSP before PNG export ever reached the (now-fixed) permission gap. Neither failure
    threw anywhere `handleExportSvg`/`handleExportPng` in `apps/web/src/App.tsx` could catch it, so
    both looked identical from the UI: the Export dialog just sat there. Fixed by adding a
    `fs:allow-write-file` grant (same `"path": "**"` scope as the existing text-write permission)
    and `blob:` to `img-src`. `.dmg` packaging (previously blocked in this sandbox, see above) later
    completed successfully via a real macOS CI runner as part of the
    [M21](#m21--licensing--release-packaging) release workflow —
    `icad-desktop-v0.1.0-macos-arm64.dmg` shipped in the `v0.1.0` GitHub Release.

**Not yet done:**

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

✅ **Done**

1. ✅ **Refresh trigger.** Stays a deliberate, IBM Design-signaled manual re-pin
   ([D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)), not a scheduled job — but
   the process is now concrete and documented end to end
   ([Icon Catalog → Re-pin process](04-icon-catalog.md#re-pin-process-roadmap-m13)):
   `packages/catalog/current.json` (`{ "version": "…" }`) became the single canonical pointer every
   runtime loader reads (`apps/web/src/catalog.ts`, `packages/mcp/src/catalog.ts`,
   `packages/core`'s golden-fixture test all switched from a hardcoded `"2.0.0"` path literal to a
   wildcard glob/dynamic path + this one file), so a re-pin's only cross-file step is flipping its
   one field, not editing three.
2. ✅ **Diff tool.** `packages/catalog-build/src/diff.ts` (pure, unit-tested) +
   `diffCatalog.ts` (CLI: `pnpm --filter @icad/catalog-build diff <oldDir> <newDir>
[--apply-aliases]`) compares two on-disk catalog directories' manifests and reports
   added/removed/renamed icons — renames detected by an exact glyph-content hash match (with
   per-icon id-namespacing normalized away) scoped to the same category, deliberately conservative
   over fuzzy name-matching. `--apply-aliases` writes matched renames into the new manifest's
   `aliases` automatically.
3. ✅ **Missing-`catalogRef` resolution story**, confirmed rather than newly built: the renderer's
   gray/black placeholder-tile fallback (`svgRenderer.ts`, already shipped as part of M14) and the
   `non-catalog-icon` lint rule (`packages/core/src/linter/rules.ts`) already handle a broken
   reference correctly. What M13 adds is the piece that was actually missing — tooling to populate
   `aliases` so a rename resolves _invisibly_ instead of ever going missing — plus a new
   informational, document-level `catalog-version-mismatch` lint rule that explains _why_ an old
   file might show placeholder icons (its pinned `catalog.version` differs from the one currently
   bundled).
4. ✅ **Migration-registry question, decided explicitly**:
   [D29](00-decision-log.md#d29--catalog-ref-compatibility-uses-catalog-aliases-not-the-icad-schema-migration-registry--locked-v3) —
   catalog-ref compatibility lives entirely in the catalog manifest's own `aliases` mechanism, not
   the `.icad` schema `MIGRATIONS` registry (`packages/core/src/io/icad.ts`); the two are
   independent version axes and re-pinning the catalog never forces a schema bump.

**Done when:** a documented, exercised process re-pins the catalog to a new IBM stencil release
end-to-end, with a defined (not silent) outcome for any `.icad` file left referencing a
now-missing icon. ✅ The process and tooling are documented and exercised (diff tool run against
the real 242-icon catalog, unit-tested rename/alias detection against synthetic fixtures); an
actual re-pin to a _new_ upstream IBM stencil release remains a separate, future IBM
Design-signaled event, not something to trigger speculatively from this milestone.

**v3 exit criteria:** `apps/desktop` ships with native `.icad` file associations on macOS, Windows,
and Linux, and opens a document identically to web and VS Code; a documented performance benchmark
exists for large diagrams (or is inherited from M15, per M12's note), with virtualization shipped
only if it was actually needed; the catalog refresh process has been exercised at least once
end-to-end with a defined missing-icon story.

## v4 — Canvas parity

✅ **Complete.** All seven milestones (M14–M20) are done. Full plan, audit evidence, and
per-defect provenance in [Canvas parity plan](10-canvas-parity-plan.md); decisions in
[D25–D28](00-decision-log.md#canvas--direct-manipulation).

Make the canvas render what IBM actually specifies, and make it directly manipulable. M14
(visual conformance — icons, connectors, container tabs) was pulled ahead because the shipped icon
set was visually wrong against
[D5](00-decision-log.md#d5--crisp--professional-visual-style--locked)/[D17](00-decision-log.md#d17--official--ibm-internal-tool--locked).
M15–M20 (direct manipulation — drag, resize, marquee, clipboard, alignment, connector editing,
rotation, and color picker) followed.

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
   replaced with it. (M24.1, 2026-08-03) `hitTestAll`'s containment-aware tie-break originally
   compared raw ancestor-_count_ depth, not an actual ancestor relationship — so any container
   nested a level or more deep always outranked a connector (whose `parentId` is never set)
   wherever their geometries overlapped, regardless of z-order or whether the two were related at
   all. Found via `apps/web` dogfooding: connectors routinely overlap container fill after
   [M23.1](#m4--smart-connectors)'s soft-obstacle detours, and clicking them silently selected the
   container underneath instead. Fixed by tie-breaking on a genuine ancestor/descendant check
   (`hitTest.ts`), falling back to z-order — the previous topmost-wins default — for every other
   overlap, including unrelated containers at different depths.
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
   it, mirroring how M16.1 found arrow-key nudge already covered drag-to-move. (M25.1, 2026-08-04)
   Found via `apps/web` dogfooding: those X/Y/W/H fields (and Rotation, and a frame's Presentation
   order — every `NumberInput` in `InspectorPanel.tsx`) silently _concatenated_ on edit rather than
   replacing — clicking a "48" width and typing "50" produced "4850", since a bare `<input
type="number">` has no select-on-focus behavior and the click just places the cursor at the end.
   Fixed with `onFocus={(event) => event.target.select()}` on all three `NumberInput` usages —
   confirmed live that `.select()` genuinely selects a `type="number"` input's text in both real
   Chrome and jsdom (test env), despite both reporting `selectionStart`/`selectionEnd` as `null`.
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

✅ **Done** — all 7 items have landed: M17.1 (space+drag and middle-drag panning), M17.2 (grid,
alignment guides, live gesture readout), M17.3 (live 16px buffer enforcement on resize), M17.4
(containers auto-grow on drag), M17.5 (container resize reflows children), M17.6 (drop-target
highlight, drag-to-reparent, and the reparent-render bug fix it surfaced), and M17.7 (alternating
fills re-derive on reparent, a direct consequence of M17.6's own fix) — M17 complete; see
[Canvas parity plan → M17](10-canvas-parity-plan.md#m17--the-feedback-layer).

Rendered grid and snapping, alignment guides with spacing hints, drop-target highlight, live 16px
buffer enforcement, containers that auto-grow rather than let children escape, child reflow on
container resize, alternating fills re-derived on reparent, live dimension readout, and
space-drag/middle-drag panning.

#### M18 — Arrangement

🟡 **In progress** — M18.1 (z-order), M18.2 (align), and M18.3 (distribute) landed; lock/hide and
the interactive Layers tab remain as their own sub-milestones. Its stated blocker ("M15's DOM
reordering") had already shipped back when M16 landed, so this was actually unblocked before work
started. (M24.3, 2026-08-04) The Layers tab itself (lock/hide toggles, hierarchy, selection) was
already built and working by the time of `apps/web` dogfooding, ahead of this section being updated
— found two real bugs in it there: `elementDisplayName` (`packages/ui-web/src/inspectorModel.ts`)
had no connector-specific case, so nearly every connector showed as generic "Untitled connector"
(connectors carry their descriptive text in `annotation.name`, rarely set, not the generic `.label`
most other element types use — though `.label` still wins first when a connector does have one, e.g.
a "HTTPS" caption, unchanged from before); fixed with an `elementsById`-driven fallback to
`"{from} → {to}"`. Separately, selecting a connector via the Layers tab never panned the canvas —
`Editor.ensureVisible` (pan/zoom-to-fit only if not already in view) already existed and was already
paired with `focusElement` by keyboard Tab-navigation, just never exposed/called from this surface;
made it public and wired it into the Layers-panel select handler in `apps/web/App.tsx`.

Z-order, 6-way align, distribute, lock/hide, and an interactive Layers tab.

##### M18.1 — Z-order

✅ **Done.**

`bringToFront`/`bringForward`/`sendBackward`/`sendToBack`, each undoable, scoped to siblings (a
container never leapfrogs its own descendants — the renderer paints one flat, non-nested list),
keyboard-equivalent (Ctrl/Cmd+`]`/`[`, Shift for the to-front/to-back variants), and reachable from
the Edit menu, command palette, right-click menu, and MCP. Full detail, the corruption bug a naive
per-bracket renumbering scheme would have caused, and the pre-existing `groupElements` bug this
work found and fixed along the way: [Canvas parity plan → M18.1](10-canvas-parity-plan.md#m181--z-order).

##### M18.2 — Align

✅ **Done.**

`alignLeft`/`alignCenterHorizontal`/`alignRight`/`alignTop`/`alignMiddle`/`alignBottom`, each
undoable, moving every selected element to the corresponding edge/center of the whole selection's
own bounding box (never a designated anchor element) — the Figma/Illustrator/PowerPoint
convention. Connectors in the selection are silently excluded (their position is entirely derived
from the elements they connect, not independently movable). Reachable from the Edit menu, the
command palette, and MCP; no context-menu entry or keyboard shortcut, same reasoning M18.1 gave for
keeping the context menu lean. Full detail: [Canvas parity plan → M18.2](10-canvas-parity-plan.md#m182--align).

##### M18.3 — Distribute

✅ **Done.**

`distributeHorizontal`/`distributeVertical`, each undoable, spacing the selected elements' _gaps_
(not centers) evenly along the chosen axis: the two outermost elements anchor in place, everything
between them moves so consecutive gaps match — the Figma/Illustrator/PowerPoint convention.
Requires at least three distributable (non-connector) elements; connectors in the selection are
silently excluded, same reasoning as M18.2. Reachable from the Edit menu, the command palette, and
MCP; no context-menu entry or keyboard shortcut, same reasoning M18.2 gave for align. Full detail:
[Canvas parity plan → M18.3](10-canvas-parity-plan.md#m183--distribute).

#### M19 — Connector editing

✅ **Done** — waypoint drag handles (diamond handles on inner waypoints, live renderer preview,
single undo step on release), midpoint insert handles (+ circle per segment), endpoint retargeting
(pink endpoint handles drag-and-drop to a new port; auto-routing connectors re-route immediately),
reset-to-auto-routing ("Reset routing" button in the Properties panel), and MCP parity
(`connector_retarget`, `connector_reset_routing`). (M24.2, 2026-08-03) The Properties-panel button
was "Reset routing"'s only entry point — found via `apps/web` dogfooding to be effectively buried,
especially once F1's [M24.1](#m16--the-core-loop) fix made selecting a manually-rerouted connector
reliable enough to actually reach it. Added the same `editor.autoRouteConnector(id)` call as a
`"Reset routing"` entry to both of `App.tsx`'s existing command surfaces — the Command Palette's
`commands` array and the right-click `contextMenuItems` array — gated identically to the Properties
button (`element.type === "connector" && element.routing === "manual"`, single selection only).

#### M20 — Full range on demand

✅ **Done** — rotation handle with 15° Shift-snapping, rotation-aware hit-testing/handles/ports/bounds,
IBM palette swatches + free color picker, and two new linter rules (`non-zero-rotation`,
`off-palette-color`). See [Canvas parity plan → M20](10-canvas-parity-plan.md#m20--full-range-on-demand).

**v4 exit criteria:** a render of an IBM-authored template is visually indistinguishable from IBM's
own export; an architect builds a nested multi-zone diagram end to end using only the mouse, and
again using only the keyboard, with drag, resize, marquee, clipboard, alignment, and connector
editing throughout; every new capability is reachable from the MCP surface; AA re-verified.

## v5 — Release channel

Get a downloadable build of the engine into people's hands — a preview channel, distinct from the
[D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)-gated official IBM release.

#### M21 — Licensing + release packaging

✅ **Done** — all five sub-milestones landed, including a real end-to-end run (a `v0.1.0` tag
actually pushed and the workflow actually watched) that found and fixed three genuine CI-only
bugs no local testing or `actionlint` could have caught.

1. ✅ **M21.1 — Licensing + VS Code packaging readiness.** Apache-2.0 `LICENSE`, set on every
   distributed package (core, ui-web, mcp, web, vscode, desktop) — `catalog-build` and the private
   root stay `UNLICENSED` since neither ships. A `NOTICE` carves the bundled IBM icon SVGs out of
   that license, since upstream IBM-Cloud/architecture-icons has no detected license of its own.
   `apps/vscode/README.md` added, required by `vsce` for M21.3's packaging step.
2. ✅ **M21.2 — Standalone MCP server release tarball.** `packages/mcp/scripts/package-release.mjs`
   assembles `icad-mcp-vX.Y.Z.tar.gz` via `pnpm deploy --prod --legacy` — a real, self-contained
   `node_modules` rather than a bundled single file (an esbuild bundle was tried first and abandoned:
   jsdom isn't meant to be bundled, and hit three separate failures in a row) — plus a sibling copy
   of `packages/catalog` replicating the relative-path layout `catalog.ts`'s lookup already expects.
   Verified by extracting the tarball outside the repo and round-tripping a real MCP `initialize`
   request against the deployed server.
3. ✅ **M21.3 — VS Code `.vsix` packaging.** `@vscode/vsce` + a `package` script
   (`vsce package --no-dependencies`, since the host bundle already inlines everything via esbuild),
   an icon rasterized from the desktop app icon, a repo-root `LICENSE` copy (`vsce` looks locally,
   not up the tree), and a `.vscodeignore` trimming the `.vsix` to just `dist/` + metadata. Verified
   end to end: installed the packaged `.vsix` into a real VS Code via
   `code --install-extension`, opened a generated sample `.icad` file, and confirmed the custom
   diagram editor rendered it (not raw JSON).
4. ✅ **M21.4 — Desktop release packaging scripts.** `apps/desktop/scripts/apply-version.mjs` stamps
   the release version into `tauri.conf.json` right before `tauri build` (ephemeral, never
   committed); `collect-bundle.mjs` locates whatever `tauri build` just produced (Tauri's own output
   filename varies by OS) and copies it to a stable `icad-desktop-vX.Y.Z-<platform-arch>.<ext>` name.
   The macOS/`.dmg` path was verified directly — a real `tauri build`, the resulting `.dmg` mounted,
   the `.app` launched from it — closing out M11's previously-deferred "DMG packaging, needs a real
   machine" tail.
5. ✅ **M21.5 — Unified release workflow.** `.github/workflows/release.yml` ties M21.1–M21.4
   together: pushing a `vX.Y.Z` tag creates a draft GitHub Release (with a preview-build disclaimer
   prepended to the auto-generated notes), then four parallel jobs build and upload web (zip), mcp
   (tarball), vscode (vsix), and desktop (macOS/Windows/Linux matrix) artifacts to it. Nothing
   auto-publishes — the draft is left for manual review. Also landed the README "Download" section
   and the doc updates deferred from M21.1–M21.4.

**Found and fixed by the real end-to-end run** (pushing an actual `v0.1.0` tag, not just local
testing/`actionlint`) — the first draft was deleted (`gh release delete --cleanup-tag`) once these
were confirmed the only failures:

- `build-desktop` passed `--bundles dmg` after a bare `--` in `tauri build -- --bundles dmg`, which
  Tauri only treats as a `cargo build` passthrough, not its own flag — cargo rejected it outright.
  Fixed by dropping the `--`.
- `build-mcp`'s `package-release.mjs` ran `pnpm deploy` with `stdio: "inherit"`, so its own
  `[WARN]`-prefixed progress output leaked into the workflow's `OUT="$(node ...)"` capture; bash read
  the stray `[WARN]` text as a glob bracket expression and aborted with "no matches found". Fixed by
  redirecting the child's stdout to the parent's stderr and having the workflow compute the
  (deterministic) output filename directly instead of capturing it.
- A second real-CI run then surfaced a genuine cross-platform bug plain local development could
  never catch (this app had only ever been built on macOS until this run): `tauri::RunEvent::Opened`
  is only defined in the tauri crate's macOS build of `RunEvent` — referencing it unconditionally in
  `apps/desktop/src-tauri/src/lib.rs` is a hard compile error on Windows/Linux. Fixed by moving the
  `if let` into a `match` with a `#[cfg(target_os = "macos")]`-gated arm and a `_ => {}` catch-all.
- Separately (an M20 gap `ci.yml` caught on the same push, not an M21 regression): the MCP server's
  `server.test.ts` had a hardcoded tool-name list that was never updated when `element_rotate`
  shipped as a real tool — fixed by adding it to the expected list.
- Later, actually using the shipped `v0.1.0` desktop build surfaced a fourth real defect (native
  export silently doing nothing) — see [M11 item 10](#m11--appsdesktop-tauri-shell).

`v0.1.0` is live: [GitHub Releases](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram/releases/tag/v0.1.0),
with web/mcp/vscode/desktop (macOS/Windows/Linux) artifacts attached.

**Done when:** a tagged push produces a draft GitHub Release carrying working web, MCP, VS Code, and
desktop artifacts for all three desktop platforms, unattended (✅ — confirmed via a real tag push,
not just workflow linting).

## v6 — Autonomous agent runtime (Deep Agents + A2A) · [D31](00-decision-log.md#d31--new-agent-package-hosts-the-deep-agent-runtime-kept-separate-from-the-mcp-server--locked-v6)

Close the gap [M9.2](#m92--agent-skills) left open: a real agent loop that drives `packages/mcp`
end-to-end from natural language, not just documentation an agent framework could in principle
follow. Introduces `apps/agent` — a LangChain JS Deep Agents runtime, exposed over A2A via
[`@a2a-js/sdk`](https://github.com/a2aproject/a2a-js) — as the concrete "Solution Architecture
Agent" [D15](00-decision-log.md#d15--mcp-full-authoring-toolset--locked-v2)/[D16](00-decision-log.md#d16--authoring--spec--export-agent-skills--locked-v2)
already named. See [Agent Runtime](11-agent-runtime.md).

#### M29 — Agent package scaffold + MCP subprocess lifecycle

✅ **Done** (2026-08-06)

`apps/agent` (`@icad/agent`) — a new workspace package, structured like `packages/mcp` (plain
`tsc` build, `vitest` tests, no bundler), `private: true` like the other shells since it isn't
published as a library. `typecheck`/`lint`/`test` are picked up automatically by the root's
recursive scripts; `build` follows the existing apps-build-their-own-way convention (`apps/web`/
`vscode`/`desktop` aren't in the root `build` script either — each is invoked directly,
`pnpm --filter @icad/agent build`).

No agent/LLM logic yet — just the plumbing
([D34](00-decision-log.md#d34--one-ephemeral-mcp-subprocess-per-task-single-task-at-a-time--locked-v6)):
`McpSession` (`src/mcpSession.ts`), a thin wrapper over `@langchain/mcp-adapters`'
`MultiServerMCPClient`, spawning `@icad/mcp`'s compiled stdio entrypoint as a fresh child process
per session (`restart: { enabled: false }` — a dead subprocess fails the task, it never silently
respawns onto a document state the caller no longer recognizes). The entrypoint path is resolved
via real Node module resolution (`createRequire(import.meta.url).resolve("@icad/mcp")`, following
its `package.json` `main`) rather than a hardcoded relative path across the monorepo — works
whether the workspace dependency is a pnpm symlink (dev) or a real copy (a materialized
`pnpm deploy` layout, same shape M21.2's release tarball already produces). Exposes both
`tools()` (LangChain-compatible `StructuredToolInterface[]`, for M30's orchestrator/sub-agents to
call directly) and a direct `callTool(name, args)` escape hatch that needs no LLM at all — used by
this milestone's own tests, and by any future non-agent plumbing.

**Done when:** an integration test spins a real subprocess and round-trips a real `.icad` + `.svg`
through it (`doc_create` → `element_add_box` → `export_diagram` → `doc_save`), with no hand-written
mock of the MCP protocol. ✅ `src/mcpSession.test.ts` does exactly that — spawns the real compiled
`@icad/mcp` binary, then reads back the actual `.icad`/`.svg` files it wrote to disk (rather than
trusting whatever shape the LangChain tool wrapper's return value happens to have) to confirm the
whole protocol round-trip is real, not just the call. A second test confirms an unknown tool name
fails loudly instead of silently no-op-ing. Verified further: `pnpm -r typecheck`/`lint` both clean
across all 8 workspace projects including the new one; every other package's own test suite still
green (`@icad/mcp` 34, `@icad/ui-web` 84, `@icad/web` 25, `@icad/core` 663 — [M12](#m12--performance-at-scale)'s
own perf benchmark showed its already-documented flakiness under full-suite concurrent load,
re-confirmed harmless by re-running that one file in isolation, clean).

#### M30 — Deep Agent orchestrator + sub-agents

✅ **Done** (2026-08-06)

The orchestrator + `diagram-builder` + `conformance-exporter` sub-agent structure
([D33](00-decision-log.md#d33--orchestrator-plus-two-sub-agents-diagram-builder-and-conformance-exporter--locked-v6)),
each loading the appropriate existing `packages/mcp/skills/` `SKILL.md`. Configurable chat model
via LangChain's generic interface
([D36](00-decision-log.md#d36--agent-memory-is-ephemeral-per-task-the-llm-provider-is-configurable--locked-v6));
ephemeral per-task memory. The hard export gate
([D37](00-decision-log.md#d37--hard-export-gate-auto-fix-everything-fixable-then-block-on-remaining-errors--locked-v6)):
`runDiagramTask` runs its own independent `lint()` after the orchestrator finishes and refuses to
report success with any `error` diagnostic outstanding — never merely trusted to what the
sub-agents report about their own work.

**Package confirmed at kickoff**: [`deepagents`](https://github.com/langchain-ai/deepagentsjs)
(`createDeepAgent`, `SubAgent`, the default ephemeral `StateBackend`) +
[`@langchain/ollama`](https://www.npmjs.com/package/@langchain/ollama) for the local dev model
(D36) + the existing `@langchain/mcp-adapters` (M29). All real APIs verified against the installed
packages' own source/types before writing code, the same discipline used for `@a2a-js/sdk` in M32.

**Done when:** given a hardcoded natural-language requirement (no A2A surface yet), the agent
produces a lint-clean `.icad` + exported SVG via a real spawned MCP subprocess, for at least one
non-trivial multi-tier topology. ✅ Confirmed with a real `qwen3:8b` (local Ollama) run: "A Customer
actor connects through a Load Balancer to an Application tier group containing two Virtual Server
instances, which connect to a PostgreSQL database" produced a real, lint-clean `.icad` + `.svg`.

**Live dogfooding findings (2026-08-06)** — same rigor as `packages/mcp`'s own M22/M23 dogfooding:
running the real pipeline against a real local model surfaced issues no amount of mocked/unit
testing could have caught. Five real findings, in the order hit:

1. **A sub-agent can't be trusted to relay an exact file path through a natural-language
   delegation instruction.** ✅ **Fixed.** The orchestrator's system prompt told
   conformance-exporter which path to `export_diagram`/`doc_save` to; a real run invented
   `/exports/diagram.svg` instead of reproducing the real one, failing the task outright. Fix:
   `export_diagram`/`doc_save` moved out of conformance-exporter's tools entirely, now called
   procedurally by `runDiagramTask` with the real paths, after the lint gate passes. See the
   amendment on [D33](00-decision-log.md#d33--orchestrator-plus-two-sub-agents-diagram-builder-and-conformance-exporter--locked-v6).
2. **`@langchain/ollama`'s `ChatOllama` rejects non-string tool-message content**, and most
   `@icad/mcp` tools return one (their `ok()` helper pairs a text summary with `structuredContent`
   for the outputSchema; `@langchain/mcp-adapters` folds both into a `{type, text,
structuredContent}` object when handed to the LLM). ✅ **Fixed.** `McpSession` now configures
   `MultiServerMCPClient`'s `afterToolCall` hook to extract just the text
   (`extractToolResultText`) before it ever reaches the model; `callToolRaw` (bypassing
   mcp-adapters entirely) still exposes the real `structuredContent` for `runDiagramTask`'s own
   deterministic checks.
3. **A failed tool call crashed the entire agent run instead of coming back as a visible error the
   model could react to.** A real run called `connect_nearest` with `"Customer"` (a label) instead
   of the real generated element id; the resulting MCP validation error propagated as an uncaught
   exception through LangGraph's `ToolNode`, killing the whole task rather than giving the model a
   chance to notice its own mistake and retry. ✅ **Fixed.** `McpSession.tools()` now wraps every
   tool with `withErrorRecovery`: a failed call returns `"Error calling {name}: {message}"` as a
   normal string result instead of throwing. (`callTool`/`callToolRaw`, used by procedural code and
   tests, are left unwrapped — those callers should see real failures directly.)
4. **A small local model can silently duplicate its own work on a multi-step build.** One
   successful run's `.icad` had 8 non-connector elements (Customer 1/2, Load Balancer 1/2,
   Application Tier 1/2, PostgreSQL 1/2) but only 3 connectors — half the topology was a
   disconnected duplicate, and diagram-builder's own final report didn't mention it, describing
   exactly one clean topology. Lint passed anyway (duplicate elements with different labels don't
   trip any conformance rule — this is a content-correctness problem, not a spec-conformance one,
   the same class of gap the very first MCP dogfooding session flagged: "lint passing is not the
   same as the diagram being legible"). 🟡 **Partially mitigated, not solved.** Tried giving
   diagram-builder a live `doc_get` self-check tool plus an explicit "don't duplicate, check first"
   prompt instruction — the prompt instruction is kept, but the `doc_get` tool grant regressed
   finding #2 in a way not confidently root-caused before this milestone shipped (likely a
   concurrency/timing interaction between `@langchain/mcp-adapters` and `@langchain/ollama` around
   that specific call) and was reverted. **Documented as a known limitation of running a small
   (8B) local model on a multi-step tool-calling task**, not a wiring bug — see
   `apps/agent/src/tools.ts`'s comment on `DIAGRAM_BUILDER_TOOL_NAMES` for the full account.
5. **High turn count / latency**: a full run takes 3-6 minutes on `qwen3:8b` on a laptop. Root
   causes, confirmed by reading the actual transcript rather than assumed:
   - diagram-builder issues one MCP tool call per element/connector (~10-15 turns for an 11-element
     diagram) instead of using `scene_apply` (the batch tool M23.4 built for exactly this) — the
     `ibm-diagram-authoring` skill predates M23.4 and has never taught it.
   - `qwen3` generates verbose chain-of-thought reasoning before every single action (confirmed in
     the transcript — several paragraphs just to decide to delegate to diagram-builder first);
     `@langchain/ollama`'s `ChatOllama` exposes a real `think?: boolean` option to suppress this,
     unused today.
   - conformance-exporter's job (`lint` → `quickfix_apply_all` → re-`lint`) is largely mechanical,
     but always goes through a full LLM sub-agent turn-sequence today, even when
     `quickfix_apply_all` alone would resolve everything with zero judgment required.
   - Not attributable to any single bug — inherent to chaining many sequential local-model
     inference turns, each slower than a hosted API's, with no batching. 🔴 **Open — see M30.1-M30.4
     below.**

Non-obvious gotcha worth remembering if `apps/agent`'s tool-call layer is touched again: **a
"fix" validated only by a passing unit test can still regress a live-model run** — finding #4's
`doc_get` mitigation typechecked, linted, and passed the full non-live test suite cleanly, and
still broke a real run. The only thing that caught it was re-running the actual live pipeline,
the same lesson M21's real tag-push and M23's real dogfooding sessions already established for
this project in different contexts.

**Second round of live findings, while verifying M30.1/M30.4** — two more real bugs, one of them
serious:

6. **An empty, no-op run trivially passed the conformance gate.** `lint()` on a document with zero
   elements returns zero diagnostics — there's nothing to flag — so a run where the orchestrator
   silently built nothing at all (found live: diagram-builder reported "Task completed" without
   ever calling a single authoring tool) was reporting `success: true` with a 0-element diagram.
   **This is a false positive, not just messy output — worse than finding #4's duplication, since
   nothing about the result even hinted something was wrong.** ✅ **Fixed.** `runDiagramTask` now
   also fetches `doc_get()` in parallel with the `lint()` gate check and requires at least one
   element to exist before declaring success; `diagram-builder`'s prompt was also made more
   directive ("you must actually call scene_apply/element_add__/connect_ tools before reporting
   completion"). Covered by a real regression test (`runDiagramTask.test.ts`, new
   `orchestratorFactory` injection point mirroring `IcadAgentExecutor`'s existing `runTask`
   injection) — a real MCP session, a fake orchestrator that calls no tools, no LLM involved —
   proving the empty-document case is now caught deterministically rather than relying on live
   testing alone to catch a regression here again.
7. **conformance-exporter confused the MCP document with a file on disk.** It tried to glob for
   `**/*.icad` and then asked "the user" for the exact file path — `lint()`/`quickfix_apply*` take
   no path argument at all, they operate on whatever document is already open in the MCP server's
   own state, but deepagents' built-in filesystem tools (`glob`/`ls`/`read_file`/`grep`, meant for
   an agent's own scratch/planning memory) are available to every sub-agent by default and the
   model reached for one of those instead. Contributed heavily to one run's ~30-minute duration —
   a long, confused back-and-forth ending in the sub-agent giving up and asking a question that (in
   this non-interactive pipeline) could never be answered. ✅ **Fixed** — `CONFORMANCE_EXPORTER_PROMPT`
   now states explicitly that the diagram is not a file, there is nothing to glob or search for,
   and every conformance tool takes no path argument.

Both fixes landed together, verified with a clean (no concurrent load) live run — which
immediately validated finding #6's fix working exactly as intended: it correctly reported
`success: false` ("the document has zero elements") instead of a false positive, timing back to a
reasonable ~5.4 minutes. But the failure itself pointed at the real underlying cause:

8. **The orchestrator called both sub-agent delegations in the same message — in parallel —
   instead of sequentially.** deepagents' own `task` tool description explicitly invites this
   ("Launch multiple agents concurrently when their tasks are independent, using a single message
   with multiple tool calls"), and the orchestrator prompt never said these two specific
   delegations are _not_ independent. The result: conformance-exporter ran before (or alongside)
   diagram-builder, validated a still-empty document, found trivially zero diagnostics (nothing
   built yet = nothing to flag), and reported "fully compliant" — an empty diagram sailing through
   for the wrong reason. Finding #6's gate caught the outcome correctly; this is the fix for _why_
   it kept happening. ✅ **Fixed** — the orchestrator's system prompt now states explicitly that
   these two steps are sequential and dependent, to call the task tool for diagram-builder alone
   and wait for its result before ever calling it for conformance-exporter, and that calling both
   in the same message is a real mistake, not a valid time-saving move.

**Re-running with #6-#8 fixed together confirmed the sequencing fix worked** (delegations ran one
at a time, in order) but surfaced a ninth, different issue:

9. **`scene_apply`'s `connect` and `connect_nearest` batch-op shapes are easy to confuse, and a
   confused model can burn a very long time on it.** `connect_nearest` takes flat string ids
   (`fromId`/`toId`); `connect` takes port-ref objects (`from`/`to`, each `{ elementId, port }`).
   A run's diagram-builder mixed the two up, got a schema-validation error back, and — reproduced
   directly against a real MCP subprocess with no LLM involved, confirming this is a genuine
   validation failure and not a fluke — spent the better part of 33 minutes retrying and re-failing
   before giving up with zero elements built (caught correctly by finding #6's gate, not a false
   positive). **Worth noting explicitly: this is not a crash.** Tracing it down confirmed
   LangGraph's `ToolNode` already catches this specific exception class
   (`ToolInputParsingException`, a client-side schema mismatch on the tool call itself) and reports
   it back to the model as a normal tool error automatically — a different, already-safe code path
   from finding #3's fix (which covers server-side business-logic errors, a `ToolException` from a
   valid-shaped call the MCP server itself rejects). The model saw a real error and kept trying;
   it just couldn't work out the right shape from the error alone within a reasonable number of
   attempts. ✅ **Mitigated** — `ibm-diagram-authoring` now spells out both shapes side by side with
   an explicit "do not mix these up" callout, using the exact two field names each one needs.

**Re-confirming finding #9's fix live surfaced its real root cause** — findings #4 and #9's whole
"the model can't recover from a schema mistake" pattern turned out to be substantially explained by
one thing, found by reading the _actual_ error text the model was receiving rather than assuming
the model itself was simply not capable enough:

10. **`@langchain/core`'s default tool-call error message discards the real validation error
    entirely.** `"Received tool input did not match expected schema"` — no field, no path, no
    expected-vs-received detail — unless a `verboseParsingErrors: true` option is set on the tool.
    `McpSession`'s error-recovery wrapper (finding #3's fix) never set it, so every schema mistake
    the model made came back as this one uninformative sentence, over and over, with no way for the
    model to tell what was actually wrong. ✅ **Fixed** — `verboseParsingErrors: true` added to
    `withErrorRecovery`'s wrapped tool (`mcpSession.ts`), plus a real regression test
    (`mcpSession.test.ts`, a genuinely malformed `scene_apply` call through a real MCP session, no
    LLM) proving the returned error string now contains real detail, not just a longer version of
    the same generic sentence. **Measurably helped, did not fully solve it**: a live re-run of the
    same failing prompt went from ~26-35 minutes down to ~8.5 minutes before still failing the same
    way — real, substantial progress, not a complete fix. The deeper cause: `@langchain/mcp-adapters`
    validates against the tool's JSON-Schema representation of `scene_apply`'s 9-way discriminated
    `ops` union via a JSON-Schema `anyOf`-style validator, and when _no_ branch matches, the
    reported failing branch can be the wrong one — confirmed directly: an op the model sent with
    `kind: "connect_nearest"` and correct `fromId`/`toId` fields still came back reporting
    `kind/const: Instance does not match "connect_nearest"`, which is not just unhelpful but
    actively contradicts what the model actually sent. No array index is reported either, so even a
    correct error can't be pinned to which of several ops in the batch caused it. This is
    third-party validator behavior (`@langchain/mcp-adapters`'s JSON-Schema-based client-side
    validation path, most likely `@cfworker/json-schema` underneath), not something fixable in this
    project's own code without patching or replacing that dependency — **left as a documented, open
    limitation**, not chased further this session.

**Overall assessment of the M30 live-testing loop, end to end**: three independent runs across this
milestone (the original M30 "Done when" confirmation, the first M30.1-specific check, and further
partial successes along the way) demonstrated a full, correct, non-duplicated success — M30's core
capability and M30.1's correctness improvement are both genuinely proven, not assumed. Ten real
findings came out of chasing a clean timing number and then chasing full reliability past that:
nine fixed outright, one (`scene_apply`'s misleading `anyOf` validation errors) diagnosed precisely
and left open as a real, understood limitation of the current tooling rather than a mystery. A
fully clean, fast, first-try success on every single run isn't guaranteed with an 8B local model
driving a schema this complex — expect occasional retries or failures, or D37's gate legitimately
rejecting a run outright, always honestly reported, never a silent false success. This is the
natural stopping point for this session's live-verification work; M30.2's `think` A/B comparison
and further `scene_apply` reliability work are left for a future session, tracked here rather than
chased indefinitely.

##### M30.1 — Teach `scene_apply` batch-building in the authoring skill

✅ **Shipped** (2026-08-06), **timing impact still unmeasured.** Updated
`packages/mcp/skills/ibm-diagram-authoring/SKILL.md` to teach `scene_apply` as the preferred
pattern for a diagram's initial build (rewrote the worked example to use one batch call instead of
per-element calls, and spelled out the "an op referenced later in the array needs an explicit id"
constraint), and reinforced the same preference in `apps/agent/src/subagents.ts`'s
`DIAGRAM_BUILDER_PROMPT`.

**Correctness confirmed live**: a fresh run after this change produced a clean, correct, non-
duplicated topology — 6 real elements + 4 connectors, both Virtual Server instances correctly
represented as individual icons inside the Application Tier group (not just the group's own corner
icon, which is what an earlier buggy run had done). **Timing not yet cleanly measured** — the two
live attempts made to compare before/after were each confounded by something else: the first by
concurrent `pnpm build`/`test`/`lint` work running on the same machine at the same time (~22
minutes, not trustworthy), the second by findings #6/#7 above (~30 minutes, mostly spent on a
confused conformance-exporter conversation, not diagram-building at all). A clean measurement
(no concurrent load, findings #6/#7 fixed) is the next live run.

**Done when:** `packages/mcp/src/skills.test.ts` still passes (tool names referenced stay real) —
✅ confirmed — and a fresh live run's transcript shows diagram-builder issuing a `scene_apply` call
for the initial build rather than one call per element. The top-level orchestrator transcript
doesn't show sub-agents' own internal tool calls (they run in an isolated subgraph), so confirming
this specifically needs either a deepagents-level trace of the sub-agent's own turns or inferring
it indirectly from a real speedup — still open.

##### M30.2 — Disable Ollama's reasoning mode for tool-calling turns

✅ **Shipped as a configurable option** (2026-08-06), **not defaulted on**. `resolveChatModel`
(`model.ts`) now accepts `think?: boolean`, resolved from `config.think`, then
`$ICAD_AGENT_MODEL_THINK` ("true"/"false", throws on any other value), then left `undefined` (the
model's own default — a "thinking" model like `qwen3` defaults to reasoning enabled). Passed
straight through to `ChatOllamaCallOptions.think`, a real, verified option in the installed
`@langchain/ollama` package. 5 unit tests cover the resolution order and the invalid-value case,
all without needing a real Ollama server (`ChatOllama`'s constructor is lazy — no network call
until an actual completion is requested).

**Deliberately left unset by default rather than hardcoded off**: by the time this shipped, the
M30 dogfooding findings list had grown to nine real issues found via live testing, several
specifically about the model needing _more_ deliberation, not less (findings #4's topology
duplication, #9's schema-shape confusion). Flipping `think` off by default without a clean,
confounder-free A/B comparison already in hand would be trading a measured problem (slow turns)
for an unmeasured risk (worse decisions) — exactly the kind of call this project's own
verify-before-committing culture argues against making on assumption. The option exists and is
cheap to flip via env var for whoever runs the next comparison.

**Done when:** a live run with `think: false` completes measurably faster (via M30.4's timing) with
no regression in diagram correctness (element/connector count, no new duplication) versus a
`think: true` baseline on the same prompt. **Not yet done** — the option is real and tested, but
the actual comparison run is deferred past this milestone's own scope, given how much the parallel
finding-fixing work above already consumed of this session's live-testing budget.

##### M30.3 — Deterministic pre-lint pass before escalating to conformance-exporter

✅ **Shipped** (2026-08-06) — as an architectural simplification, not just a conditional call.
Implementing this properly turned out to require removing the orchestrator LLM layer entirely: its
only job (delegate to diagram-builder, then to conformance-exporter, in order, exactly once each)
had already become fully procedural, and finding #8 (live-tested the same day) proved an LLM
"orchestrator" could still get even that simple sequencing wrong — it called both delegations in
the same message, and conformance-exporter ended up validating an empty document.
`buildDiagramBuilderAgent`/`buildConformanceExporterAgent` (`subagents.ts`) now build two
independent, standalone Deep Agents — no `task`-tool delegation layer, no orchestrator — invoked
directly and sequentially by `runDiagramTask`'s own code: diagram-builder runs, then (no LLM
involved) `quickfix_apply_all()` → `lint()` once; conformance-exporter is only built and invoked at
all if error-severity diagnostics survive that, with the remaining diagnostics handed to it
directly in its task message rather than making it re-discover them via its own `lint()` call. See
[D33's amendment](00-decision-log.md#d33--orchestrator-plus-two-sub-agents-diagram-builder-and-conformance-exporter--locked-v6)
for the full reasoning.

**Done when:** a live run whose diagram is already quick-fixable to zero errors skips the
conformance-exporter delegation entirely, and a live run that still needs real judgment still
correctly falls through to it. ✅ Both directions covered by a real regression test
(`runDiagramTask.test.ts`, real MCP session + fake agents, no LLM): one proves conformance-exporter
is never even constructed when the quick-fix pass alone reaches zero errors (a factory that throws
if called), the other proves `timing.conformanceExporterMs` is present only when it actually ran —
which caught a real bug of its own: the first implementation inferred "did conformance-exporter
run" from comparing two timestamps, which is always true (time only moves forward) regardless of
whether the branch executed. Fixed with an explicit `conformanceExporterInvoked` boolean instead.
Live confirmation of the full restructured flow is still pending as of this writing.

##### M30.4 — Per-phase timing instrumentation

✅ **Shipped** (2026-08-06), built ahead of M30.2/M30.3 (moved up in the sequence — without real
per-phase numbers, comparing M30.1/M30.2's actual effect would have been guesswork on top of
guesswork). `RunDiagramTaskResult` now carries a `timing` field (`sessionStartMs`, `docSetupMs`,
`orchestratorMs`, `gateCheckMs`, `exportSaveMs`, `pngMs`, `totalMs`, via `performance.now()`) on
both success and failure branches, so a failed run's timing is visible too, not just a successful
one's.

**Immediately paid for itself**: the first live run measured with it showed `orchestratorMs:
1,837,893` (~30.6 minutes) against a ~3-6 minute baseline from earlier runs — the number itself is
what prompted digging into _why_, which is exactly how findings #6 and #7 above were found. Without
a number to be suspicious of, a slow-but-not-hung run might have been shrugged off as "small models
are just slow sometimes" instead of a real, fixable bug.

**Done when:** a live run's timing breakdown is captured — ✅ confirmed, see above. Comparing a
`think: true` vs. `think: false` run (M30.2) and a before/after M30.1 comparison both still need a
clean run free of findings #6/#7's confounds to be trustworthy.

#### M31 — Agent-side PNG export

✅ **Done** (2026-08-06)

SVG→PNG conversion
([D35](00-decision-log.md#d35--existing-diagrams-are-referenced-by-file-path-png-is-produced-agent-side--locked-v6))
via [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js) (`apps/agent/src/pngExport.ts`'s
`convertSvgToPng` — a real Rust SVG renderer via native bindings, not a headless browser), run
procedurally by `runDiagramTask` right after the export/save step succeeds (M30 finding #1 moved
export/save out of conformance-exporter's own tools; PNG conversion was written to follow that same
procedural pattern from the start, not added to any sub-agent's toolset).

**Done when:** a real run produces `.icad` + `.svg` + `.png` for the same diagram, and the PNG is
visually confirmed to match the SVG (spot-checked, not just "didn't throw"). ✅ Verified two ways:
`pngExport.test.ts` checks real PNG structure (magic bytes + IHDR width/height) against a hand-built
SVG, independent of any LLM; separately, a real ICAD-exported SVG (a labeled box containing an IBM
Virtual Server icon) was converted and visually inspected — correct colors, glyph, and layout, not
just valid PNG bytes.

#### M32 — A2A server surface

✅ **Done** (2026-08-06)

`GenerateArchitectureDiagram` and `ModifyArchitectureDiagram` as two skills in an `AgentCard`
([D32](00-decision-log.md#d32--a2a-server-is-primary-a2a-client-is-plumbing-only-localhost-only-no-auth--locked-v6)),
served via `DefaultRequestHandler` + `InMemoryTaskStore` (sufficient given
[D34](00-decision-log.md#d34--one-ephemeral-mcp-subprocess-per-task-single-task-at-a-time--locked-v6)'s
single-task-at-a-time model) and the SDK's Express `jsonRpcHandler`/`agentCardHandler`
(`UserBuilder.noAuthentication`), on `localhost:41241` (the SDK's own sample convention) unless
overridden. `ModifyArchitectureDiagram` takes an explicit `.icad` path in its task input. An
`AgentExecutor.execute()` implementation drives the (post-M30.3) diagram-builder →
conformance-exporter flow, publishing `AgentEvent.task` → `statusUpdate` (submitted → working) →
`artifactUpdate` (the `.icad`, `.svg`, `.png` paths) → a final `statusUpdate` (completed, or failed
carrying [D37](00-decision-log.md#d37--hard-export-gate-auto-fix-everything-fixable-then-block-on-remaining-errors--locked-v6)'s
diagnostics). `AgentExecutor.cancelTask()` kills the task's MCP subprocess early, mirroring the
SDK's own cancellable-agent sample.

**Done when:** a real A2A client call round-trips both skills against a running `apps/agent`
server, including one cancelled mid-flight. ✅ Confirmed two ways: `a2a/server.test.ts` (4 real
HTTP/JSON-RPC round-trips against a real server, including a real cancellation, with a faked
`runDiagramTask` so no LLM is needed), and a real live dogfooding pass (see M33) with the real,
unfaked pipeline underneath.

#### M33 — A2A dev-harness CLI, plumbing-only A2A client, dogfooding

✅ **Done** (2026-08-06)

A minimal CLI acting as an A2A client for local testing/dogfooding — modeled directly on the SDK's
own sample `client.ts` (`ClientFactory` + `JsonRpcTransportFactory`, `sendMessageStream`, printing
`task`/`statusUpdate`/`artifactUpdate` events as they arrive). The A2A client capability
([D32](00-decision-log.md#d32--a2a-server-is-primary-a2a-client-is-plumbing-only-localhost-only-no-auth--locked-v6))
is wired at the SDK level with no real delegate target yet.

**Live dogfooding found one real, distinct A2A-layer bug**, separate from any of M30's ten
diagram-generation findings:

11. **`undici`'s default HTTP body/headers timeout (~5 minutes) killed the A2A stream mid-task.**
    A real diagram-generation task can take many minutes _between_ streamed events — that's an LLM
    step, not network latency, but the underlying `fetch()` inside `@a2a-js/sdk`'s
    `JsonRpcTransportFactory` doesn't know that, and undici's default timeout doesn't distinguish
    "still working" from "connection is dead." A real dogfooding run crashed outright with
    `UND_ERR_BODY_TIMEOUT` partway through a real task — the `AgentCard` served correctly and the
    first two events (`task`, `statusUpdate: working`) came through fine, only the _wait_ for the
    next event exceeded the timeout. ✅ **Fixed** — `sendDiagramRequest.ts` now calls
    `setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }))` (the `undici` package,
    added as a real dependency) once at module load, disabling the timeout outright rather than
    just raising it: A2A's own task lifecycle (`cancelTask`) is the right layer for a caller to
    give up on a genuinely stuck task, not a fixed low-level HTTP timeout that can't tell the
    difference. Confirmed fixed with a second live run: the exact same request that crashed before
    now streamed cleanly through `task` → `statusUpdate` (working) → `statusUpdate` (failed, with
    the real reason) with no transport-level error at all.

**Done when:** the dogfooding session runs to completion and its findings (if any) are written up
and proposed as a follow-up milestone, same pattern as the M22/M23 dogfooding → fix-milestone
cadence. ✅ Done as described above. **Scope note, honestly recorded:** the live dogfooding pass
covered `GenerateArchitectureDiagram` only (not a `ModifyArchitectureDiagram` run), and no
successful diagram was produced through the live pass — the underlying diagram-builder hit the
same `scene_apply` limitation already documented under M30's findings #4/#9/#10, correctly reported
as a clean `TASK_STATE_FAILED` with the real reason all the way through the A2A stream, not a
transport failure. That's exactly what this milestone needed to prove — the A2A layer itself (task
lifecycle, streaming, failure reporting) works correctly end-to-end — decoupled from whether any
given diagram-generation attempt succeeds, which is M30's concern, not M32/M33's. No visual
chrome-devtools verification was performed this pass, since no successful SVG was produced to
inspect; worth doing in a future session once a live run succeeds through the full A2A path.

**v6 exit criteria:** a real A2A caller (the dev-harness CLI, or any other A2A client) generates a
valid, non-trivial topology from a paragraph of requirements, and separately modifies an existing
`.icad` from a natural-language instruction — entirely through the A2A surface, with no human in
the tool loop — closing the v2 exit-criteria gap [M9.2 flagged](#m92--agent-skills) ("needs an
actual agent loop driving the MCP server end-to-end," previously only exercised via manual Claude
Code dogfooding sessions, never a real autonomous agent).

**Not yet fully met, honestly**: every piece of infrastructure this exit criteria depends on is now
real and verified — the Deep Agent pipeline, the A2A server and its task lifecycle, the dev-harness
client, the hard export gate, agent-side PNG export — and the pipeline has produced multiple
genuine successes during this session's live testing. But no single run went "one paragraph in,
through the real A2A surface, out the other side with a real diagram" _and_ "an existing `.icad`
modified via a real A2A `ModifyArchitectureDiagram` call" in the same verification pass. Getting
there needs either a more capable model (a real question for a future session, not a code gap) or
further work on `scene_apply`'s reliability (findings #4/#9/#10). Tracked here rather than
overstated as done.

## Explicitly deferred / revisit later

- Real-time multi-user collaboration ([D4](00-decision-log.md#d4--local-first-single-user-files--locked) is single-user by design).
- `.drawio` import / round-trip ([D7](00-decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked)).
- Concurrent multi-task A2A sessions, cross-session agent memory, and real A2A-client delegation to
  another agent — all deferred by [v6](#v6--autonomous-agent-runtime-deep-agents--a2a)'s own
  [D32](00-decision-log.md#d32--a2a-server-is-primary-a2a-client-is-plumbing-only-localhost-only-no-auth--locked-v6)/[D34](00-decision-log.md#d34--one-ephemeral-mcp-subprocess-per-task-single-task-at-a-time--locked-v6)/[D36](00-decision-log.md#d36--agent-memory-is-ephemeral-per-task-the-llm-provider-is-configurable--locked-v6),
  pending real demand.
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
