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
← next
- **In progress — library vertical slice (2026-07-23):** reusable `packages/ui-web` Carbon library
  panel, catalog search/category browsing, click-to-place icons and native containers, automatic
  containment with the prescribed 16px inset, and the four container presets confirmed by IBM
  worked examples (IBM Cloud, Public Network, OpenShift, Availability zone). Inferred presets
  remain withheld pending IBM Design confirmation.

##### M7.1 — Published-guidance conformance alignment
✅ **Done** (2026-07-23)

Aligned the implementation with the published
[IBM Cloud Architecture Framework](https://cloud.ibm.com/docs/architecture-framework?topic=architecture-framework-architecture-diagram)
and use the stencil repository as the supplemental asset/inventory source:

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

- `packages/ui-web` + `apps/web`: library panel, properties/layers, top bar, command palette;
  IBM-level templates + frames; find-on-canvas; auto/light/dark ([Editor UX](06-editor-ux.md)).
- Container presets: surface the named shortcut table ([Icon Catalog → Container presets](04-icon-catalog.md#container-presets),
  [D21](00-decision-log.md#d21--container-presets-are-a-named-shortcut-layer-not-new-element-types--locked))
  in the library panel alongside icon search.

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
