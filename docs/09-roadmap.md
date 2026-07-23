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
