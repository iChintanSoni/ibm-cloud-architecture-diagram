# Canvas parity plan — IBM conformance + direct manipulation

Plan of record for closing two gaps found by auditing the engine against draw.io, Excalidraw, and
IBM's own _IT architecture diagrams kit_ v1.1 (`packages/catalog-build/.cache/architecture-icons/ppt/`)
plus the IBM 2.0 `.drawio` stencils and templates in the same cache.

Two workstreams, deliberately sequenced:

1. **Visual conformance** (M14) — ICAD renders IBM's icons and connectors incorrectly today.
2. **Direct manipulation** (M15–M20) — the canvas has no drag, resize, marquee, or clipboard.

Conformance runs first: it is renderer-local, and manipulation is about to build a selection
overlay on top of that same renderer. Rebasing visual-test baselines once is cheaper than twice.

---

## Audit summary

### What ICAD already does well

Orthogonal A* routing with obstacle avoidance, 11 semantic IBM connector types, containment with
move-with and cascade-delete, the 16px group pad, alternating container fills, the advisory linter
with quick-fixes, frames + presentation mode, and a genuinely keyboard-operable, screen-reader
navigable canvas ([Accessibility](07-accessibility.md)). The last of those is better than either
competitor and must not regress.

### Confirmed defects

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Icons render inverted — colored glyph on a white outlined tile, where IBM is a **white glyph on a solid category tile** (actors: white glyph on a solid black circle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | IBM source `<rect fill="#1192E8" width="48" height="48"/>` + `<path fill="#FFFFFF">`; `extract.ts` `normalizeIcon()` strips the tile and recolors the glyph                                                        |
| C2  | Relationship connectors use a filled block arrowhead where IBM uses an **open-V line arrow**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `Connectors.drawio`: `Dependendency: endArrow=open;endSize=12;dashed=1`                                                                                                                                            |
| C3  | `logical-connection` uses a dash-**dot** pattern (`6 3 1 3`); IBM uses even dashes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `Connectors.drawio`: `dashed=1;strokeWidth=2`                                                                                                                                                                      |
| C4  | Connector stroke width defaults to 1.5; IBM specifies 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | same                                                                                                                                                                                                               |
| C5  | Tunnel band is the stroke color at 18% opacity; IBM specifies `#FFD7D9`, with yellow added for the double-tunnel variant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `Connectors.drawio` colour-code cells                                                                                                                                                                              |
| C6  | The schema's `tunneling-connection` type is **mislabeled**: its rendering (band + solid line + arrow) actually matches IBM's "Traffic Through Tunnel/Encapsulation" line, not the "Tunneling Connection" text — which `Connectors.drawio` stores as a `strokeColor=none` **caption** cell (`edge="0"`), not an edge, and has no line style of its own. Count stays at 11; this is a display-label correction, not a missing type. _(Corrected during implementation — the original audit misread the raster deck image; the stencil XML, a higher-precedence [normative source](05-ibm-spec-conformance.md#normative-sources), settles it.)_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `Connectors.drawio`: the two "Traffic Through …Tunnel/Encapsulation" cells are `style="text;…"` value labels on real edges; "Tunneling Connection" is a separate `fontSize=11` caption cell with no edge behind it |
| C7  | Sidebar tab drawn for **Box only**; IBM draws it on every container (Region, OpenShift, Zone, Subnet, Public Network)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Kit slide 4 worked example                                                                                                                                                                                         |
| C8  | No sequencing/numbering badge (circled `#`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Kit slide 6                                                                                                                                                                                                        |
| C9  | `hitTest` is bbox-only and connectors carry a degenerate `0×0` rect, so connectors are geometrically unhittable; clicks work only through a second, DOM-based path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [`hitTest.ts`](../packages/core/src/interaction/hitTest.ts), [`App.tsx`](../apps/web/src/App.tsx)                                                                                                                  |
| C10 | Renderer never reorders existing DOM nodes, so `z` changes cannot repaint correctly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [`svgRenderer.ts` `render()`](../packages/core/src/render/svgRenderer.ts)                                                                                                                                          |
| C11 | `rotation` and `canvas.grid` are dead fields — declared, never read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [`types.ts`](../packages/core/src/scene/types.ts)                                                                                                                                                                  |
| C12 | `CommandBus` has no coalescing, so any per-frame gesture would flood the undo stack                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [`commandBus.ts`](../packages/core/src/commands/commandBus.ts)                                                                                                                                                     |
| C13 | Every `Scene` change — including a single-element `dispatch()`/`undo()`/`redo()` — re-runs a full-scene `SvgRenderer.render()` **and** a full-scene `Linter.run()`, not just for the changed ids. Cost scales with total diagram size, not gesture size: on the benchmark below, nudging 10 of 2000 elements and undoing it costs ~2s each, roughly what re-rendering the whole diagram from scratch costs. The ephemeral preview path (D26) avoids this during a drag itself, but `Interaction.commit()` still dispatches through this same full-scene path once at the end — [M16](#m16--the-core-loop)'s drag-to-move should budget for a multi-second freeze on commit at realistic diagram sizes unless render/lint are made incremental (scoped to the changed ids) before or during that milestone. _(Found while building M15.7's benchmark harness, not in the original audit. **Resolved in M16.1**: `Scene._transaction()` coalesces a command's `_put`/`_remove` calls into one change event — it turned out to be worse than this note implies, since a cascading move of N elements was N full-scene passes, not one — and `createEditor.ts`'s subscription now repaints only the affected ids for a position-only change instead of the whole scene.)_ | [`createEditor.ts`](../packages/core/src/api/createEditor.ts) constructor's `scene.on()` subscription; [`benchmark.test.ts`](../packages/core/src/perf/benchmark.test.ts)                                          |
| C14 | `syncDomOrder()` (C10's own fix) reconciled a z-order change by unconditionally `appendChild`-ing **every** element whenever the id-sequence signature changed at all — including elements whose relative position hadn't actually moved. `appendChild` on an already-attached node is a real detach-then-reinsert, which silently blurs DOM focus off it. Invisible to every existing test (jsdom doesn't model focus-on-detach), and only surfaced live in a real browser while building M16.5: focus a placed element, then Ctrl+D/paste/duplicate (any add, which always changes the signature) — focus drops to `<body>`, silently breaking every further keyboard shortcut, since `CanvasController`'s keydown listener is scoped to the canvas container and a `<body>`-targeted key event never bubbles into it. **Resolved**: `syncDomOrder()` now walks the desired order alongside the _actual_ current DOM order, `insertBefore`-ing a node only when it's genuinely out of place; an already-correctly-positioned node (the common case for anything not itself reordered) is never touched at all.                                                                                                                                                      | [`svgRenderer.ts` `syncDomOrder()`](../packages/core/src/render/svgRenderer.ts)                                                                                                                                    |

### Missing vs. both competitors

Drag-to-move, drag-to-resize, marquee selection, select-all, clipboard (copy/cut/paste/duplicate/
clone-drag), context menus, z-order, align/distribute, lock/hide, connector waypoint + endpoint
editing, in-place label editing, grid, alignment guides, space-drag/middle-drag panning, minimap.

---

## Decisions taken

Locked in [the decision log](00-decision-log.md#canvas--direct-manipulation) as D25–D28:

- **[D25](00-decision-log.md#d25--icons-render-as-ibm-authors-them-solid-tile-white-glyph--locked)** —
  icons render as IBM authors them: solid tile, white glyph.
- **[D26](00-decision-log.md#d26--gestures-are-ephemeral-commits-are-commands--locked)** —
  gestures are ephemeral; commits are commands.
- **[D27](00-decision-log.md#d27--the-interaction-state-machine-lives-in-core-not-the-shells--locked)** —
  the interaction state machine lives in core, not the shells.
- **[D28](00-decision-log.md#d28--constrained-defaults-full-range-on-demand--locked)** —
  constrained defaults, full range on demand.

Two smaller calls not worth their own ADR:

- **Marquee selects fully-enclosed elements only** — matching draw.io and Excalidraw, and safest in
  dense nested diagrams where an intersect-mode drag would constantly grab the enclosing Box or Zone.
- **Physical connection keeps its hollow box end-caps.** The kit's slide-6 image appears to show
  bare double lines, but `Connectors.drawio` is explicit
  (`shape=link;startArrow=box;startFill=0;endArrow=box;endFill=0;strokeWidth=2`) — the caps are
  simply too small to resolve at that image's scale. The current implementation is correct and M14
  does not touch it.

### IBM's own prescribed gestures

The kit's "Prescribed location / Scaling elements / Layering elements" slide instructs IBM's own
users directly, and we adopt it verbatim:

> _"1. Make sure the inside bounding box is highlighted by **double clicking on the inside shape**. 2. **Drag the bottom left corner** to scale to needed size."_
> _"each inner element should have about **16px buffer** on each side. **Alternate white and light
> color fills** for better readability."_

That gives us, from IBM rather than from guesswork: **8 resize handles**, **double-click to drill
into a nested container**, **both bounding boxes visible at once**, corner-drag-to-scale, and the
16px buffer as a live constraint rather than a create-time constant.

---

## M14 — IBM visual conformance

✅ **Done.** Renderer + catalog only; no interaction changes.

1. ✅ **Icon tiles (C1).** `extract.ts` stops calling `recolorWhite()` and stops assuming a white
   host container; glyphs stay `#FFFFFF`. `svgRenderer.ts` paints a filled tile from the manifest's
   `color`, using `container: "rounded"` to pick a circle for actors, and drops the `#161616` 1px
   outline. Glyph geometry moved to IBM's **24×24 at inset 12** from the old 20×20 at inset 14; all
   242 icons regenerated. Two bugs caught before shipping: both extraction paths (`extract.ts` and
   the independent `extractDrawioLibrary.ts`, feeding the 35-icon Groups category) still framed
   glyphs into a 0..20 space against the renderer's new 0..24 expectation, and the on-disk SVG
   files kept a stale `viewBox="0 0 20 20"` wrapper independent of the three runtime loaders that
   strip it. Doc screenshot retakes still outstanding (tracked, not blocking).
2. ✅ **Connector markers (C2–C5).** Added an `arrow-open` marker (open-V, `endSize=12`), routed
   `dependency`/`association`/`aggregation`/`composition` to it; `implementation`/`extends` keep
   the hollow closed triangle. `logical-connection` now an even dash, default `strokeWidth` 2,
   tunnel band fixed to `#FFD7D9` (confirmed directly in the vector source) with Carbon Yellow 30
   as a flagged placeholder for the double variant's second band (no literal value exists for it in
   `Connectors.drawio`). Added a `CONNECTOR_TYPE_LABELS` map to the Properties panel, which
   previously showed the raw kebab-case value with no label at all.
3. ✅ **Connector type display name (C6).** No new type — the `tunneling-connection` type's
   _display label_ now reads "Traffic Through Tunnel/Encapsulation" to match the line IBM's stencil
   actually labels; the internal schema key, `.icad` representation, and rendering (band + solid
   line + arrow) were already correct and stayed unchanged. No migration needed.
4. ✅ **Container sidebar tab (C7).** `sidebarTab()` now also renders on Group and Zone, colored to
   each container's own resolved stroke. Frame excluded (no IBM semantic).
5. ✅ **Sequencing badge (C8).** `ConnectorElement.sequence?: string`, rendered as a small circled
   badge straddling the connector's midpoint; editable via the Properties panel and MCP
   (`connect`/`connect_nearest`/`element_update`).
6. ✅ **Structured connector labels.** `ConnectorElement.annotation?: ConnectorAnnotation { name,
security?, port? }`, formatted via the new `formatConnectorAnnotation` (exported from
   `@icad/core`) as `NAME SECURITY:PORT` (e.g. `HTTPS TLS1.3:443`) — not a free-text string users
   punctuate by hand. The Properties panel switches the name field's label between
   "Protocol/Application name" and "Encapsulation name" based on the connector's own type. New
   `connector-annotation-incomplete`/`connector-annotation-invalid-port` linter rules flag a
   security/port set with no name, and a non-numeric port.
7. ✅ **Golden fixtures.** Not a `.drawio` parser — building one, even test-only, would cut against
   [D7](00-decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked)'s locked "no
   `.drawio` import," whose rationale (a full mxGraph mapping surface is large and fragile) doesn't
   stop applying just because the importer is dev-only. `svgRenderer.goldenFixtures.test.ts`
   instead hand-reproduces the `iks_sr_mz_vpc` reference diagram's structure (Client → IBM Cloud →
   Region → OpenShift → Zone → Subnet → NLB/ALB/Worker Nodes) using ICAD's own authoring API
   against the real bundled catalog, and asserts the fixes directly: solid tiles with white glyphs,
   a colored sidebar tab at every nesting depth, recolored corner glyphs, and correct connector
   flow colors/stroke width. Rendered and rasterized for a final visual check during development.

Steps 5 and 6 each add schema fields — both purely additive optional fields, so (unlike a rename)
neither needs a `.icad` version bump or migration entry; an older document simply loads without
them. Both share one linter-rule pass, one Properties-panel update, and one MCP schema update.
Physical connection is explicitly unchanged (see Decisions taken).

**Done when:** a side-by-side render of `iks_sr_mz_vpc` against IBM's own export matches on icon
fill, glyph color, connector markers, dash patterns, stroke width, and container tabs; all 11
connector types round-trip through `.icad`, the linter, and the MCP surface with corrected display
labels; the uncommitted `groupLabelText` work is landed with it.

---

## M15 — Interaction foundations

✅ **Done** — all 7 steps landed and tested. No user-visible features yet; everything after this
depends on it, and M16 is next.

1. ✅ **Ephemeral interaction layer (D26, C12).** `Editor.beginInteraction(ids)` returns an
   `Interaction` with `update(dx, dy)` / `commit()` / `abort()`. `update()` calls
   `SvgRenderer.previewTransform()`, which writes a plain `transform="translate(dx,dy)"` directly
   onto each affected `<g>` node (and its selection-outline overlay, tagged with the same
   `data-icad-id` so it tracks in lockstep) — no scene mutation, no `innerHTML` rebuild, no lint
   run. `commit()` clears the preview and dispatches the exact same `moveElements` command
   `nudgeElements` already uses, so move-with/reroute-on-commit semantics aren't reimplemented.
   Elements are flat DOM siblings, not nested SVG groups, so `beginInteraction` expands `ids` to
   every descendant itself (mirroring `moveElements`' own expansion) rather than relying on a
   parent transform to carry children along.
2. ✅ **Partial + ordered rendering (C10).** `render()` now reconciles DOM order to
   `scene.all()`'s z-order via a new `syncDomOrder()` — previously a z-order change repainted the
   element in place but never actually moved it in the DOM. Guarded by a cached id-sequence
   signature so the common case (nothing added/removed/reordered) costs one string comparison, not
   an O(n) `appendChild`-as-move-to-end walk. Also adds `renderer.renderElements(ids)`, a partial
   re-render primitive for future callers (e.g. M16's resize gesture) that need to repaint a few
   known elements without the full per-element pass over the whole scene.
3. ✅ **Unified hit-testing (C9).** `hitTest`/`hitTestAll`/`hitTestRect` in one module. Connectors
   are tested against their real rendered polyline (point-to-segment distance) with a tolerance,
   not their degenerate 0×0 declared bbox. Containment resolution explicitly prefers the deepest
   element in the scene's parentId hierarchy over its ancestors — replacing a z-order-only
   heuristic that only happened to prefer children in the common case because the editor's own
   placement/grouping flow tends to add a child after its container, not a rule the engine
   actually enforced (confirmed broken for a freshly-grouped container, fixed by a live
   browser check: clicking the bounding-box center of an outer Box now correctly selects the
   nested icon inside it, not the Box). The divergent `event.target.closest("[data-icad-id]")`
   DOM-walk in both `apps/web` and `apps/vscode`'s `App.tsx` click handlers is replaced with one
   `hitTest()` call each — the port-hover exclusion stays DOM-based since ports are decorations
   with no scene element to hit-test against, not part of the divergent path this closes.
4. ✅ **Interaction state machine (D27).** `core/interaction/CanvasController` owns wheel pan/zoom,
   click/shift-click select, keyboard nav (Tab/Enter/arrows/nudge/Delete), and both mouse
   (drag-a-port) and keyboard (`c` + Tab + Enter) connect flows as one class attached to the
   canvas container — modes are `idle` / `connecting` / `placing`, faithfully consolidating what
   `apps/web`'s and `apps/vscode`'s `App.tsx` each independently hand-rolled (confirmed
   byte-for-byte identical before the migration). `armPlacement(onPlace)` and the
   `onConnected`/`onDeleted` callbacks keep shell-only concerns (which `LibraryPlacement` is armed,
   announcement text) out of core; `onModeChange` lets shells mirror mode into their own render.
   `setSuspended()` lets a shell (e.g. during presentation mode) disable canvas keyboard handling
   from outside without `CanvasController` knowing why. Both `apps/web/src/App.tsx` and
   `apps/vscode/webview/src/App.tsx` are migrated — their canvas `<div>`s no longer carry any
   mouse/keyboard handlers directly. The remaining direct-manipulation modes this milestone's
   original scope named (pan drag, marquee, drag-to-move, resize, rotate) are net-new gestures that
   don't exist anywhere yet, not a migration of existing code — they're
   [M16](#m16--the-core-loop)'s job, and will land as new `CanvasMode` variants on this same class.
5. ✅ **Snapping engine.** `core/interaction/snapMove()`: grid snap against the live
   `scene.canvas.grid` (finally reading C11's dead field), sibling edge/center alignment
   candidates scoped to elements sharing the same `parentId`, and the 16px `PARENT_INSET` clamp —
   a hard constraint that always wins over a snap candidate, dropping that axis's guide rather
   than reporting a line the clamp then overrode. For each axis independently, every candidate
   (grid line, and each sibling's near/far edge and center) is compared and the single nearest one
   within `tolerance` wins, returning one adjusted delta and up to one guide per axis — not one
   candidate per feature. Pure and scene-only: it never touches the renderer or dispatches a
   command. Not yet wired into a live gesture, since dragging doesn't exist yet — that's
   [M16](#m16--the-core-loop)'s `Interaction.update()` caller to build; this ships the engine
   ahead of it, tested standalone (`snapping.test.ts`).
6. ✅ **De-fork `apps/vscode` (D27), confirmed.** Every non-host-specific file in
   `apps/vscode/webview/src` was diffed line-by-line against `apps/web/src`:
   `placement.ts`, `validation.ts`, and `main.tsx` are byte-identical; `catalog.ts` differs only
   in relative import-glob depth (`../../../` vs `../../../../`, since the webview sits one
   directory deeper) and comment wording, not logic; `App.tsx`'s only remaining differences are
   genuinely host-specific concerns `CanvasController` was never meant to own — file persistence
   (File System Access/Tauri vs. the extension host owning save/open/undo-bridging), theme
   sourcing (`useResolvedTheme` vs. `useVsCodeTheme`), and the export dialog's format/scale
   options (`apps/web` supports PNG export via canvas rasterization; the webview's sandboxed
   `<canvas>` access made that not worth doing yet, so it offers SVG only) — and both `App.tsx`
   files import the identical symbol set from `@icad/ui-web`
   (`CommandPalette`/`FindBar`/`InspectorPanel`/`LibraryPanel`/`LiveRegion`/`NewDiagramDialog`/`TopBar`/`elementDisplayName`/`findMatches`).
   No forked interaction logic remains anywhere in the shell.
7. ✅ **Benchmark harness**, absorbing the intent of [M12](09-roadmap.md#m12--performance-at-scale)
   so performance is measured before it regresses rather than after. There's no drag/resize
   gesture to time yet (that's M16), so `packages/core/src/perf/benchmark.test.ts` instead measures
   the primitives that exist today against synthetic 500/1,000/2,000-element diagrams
   (`syntheticDiagram.ts`: repeating Box-with-icons-and-connectors units, the same shape as the
   `iks_sr_mz_vpc` golden fixture): initial load (`loadIcad`), 200 `hitTestAll` samples, a `lint()`
   pass, pan + zoom, and a committed 10-element move + undo + redo. Budgets are regression guards,
   not real-browser targets — jsdom is far slower than a real browser at SVG DOM churn, so each
   budget is a generous (~2-5x) multiple of the observed baseline on this test environment, meant
   to catch an accidental new O(n) rather than assert absolute speed. Observed baseline (this
   environment, jsdom, single run):

   | Elements | Load (render+lint) | 200 hit-tests | `lint()` | pan+zoom | nudge+undo+redo |
   | -------- | ------------------ | ------------- | -------- | -------- | --------------- |
   | 500      | 83ms               | 12ms          | 7ms      | <1ms     | 887ms           |
   | 1,000    | 149ms              | 24ms          | 17ms     | <1ms     | 2,192ms         |
   | 2,000    | 382ms              | 46ms          | 47ms     | <1ms     | 6,018ms         |

   Pan/zoom stay sub-millisecond regardless of size — confirms `ViewportController` never touches
   the scene, exactly D3's design. Everything else scales with total diagram size, which is
   expected for load/hit-test/lint alone, but **not** for a single 10-element move: that's C13, a
   defect this benchmark surfaced rather than the original audit — dispatch, undo, and redo each
   run the same full-scene render+lint pass the initial load does, so a small edit on a large
   diagram costs what a full re-render costs. No virtualization decision follows from this data
   (500-2,000 elements render and hit-test comfortably fast); C13 is a real finding but a different
   problem than the one M12 was checking for, and is flagged there for M16 to account for rather
   than fixed here, since fixing it means making render/lint incremental — a larger change than
   "add a benchmark."

**Done when:** a scripted 200-frame drag of a 40-element subtree holds frame budget, produces
exactly one undo entry, and runs the linter exactly once; and all three shells drive the canvas
through the same `CanvasController` with no shell-local interaction code. The `CanvasController`
and shell-unification half of this is done (steps 4 and 6); the drag itself is M16's, at which
point it should also confirm C13 doesn't turn "one undo entry" into "one multi-second freeze" on a
realistic diagram.

---

## M16 — The core loop

✅ **Done.** The first milestone a user can feel — all 7 items below have landed.

- ✅ **Drag-to-move**, with a drag threshold, Shift to axis-lock, Escape to abort, and move-with
  semantics (`moveElements`, unchanged). `CanvasController` moved from mouse events to Pointer
  Events with `setPointerCapture` (D27 said it should be from the start; nothing had actually done
  it yet) so the gesture survives the cursor leaving the canvas. Live snapping (grid/sibling/16px
  inset) is fully wired via `snapMove()` — this is its first real caller — but drawing the guide
  lines it returns is left for M17 below, per that milestone's own "alignment guides ... drawn
  from M15's snapping engine." `Editor.beginInteraction()`/`SvgRenderer.previewTransform()` (D26)
  got their first real caller too.

  This also closed **C13**: a drag's `commit()` dispatches through the same full-scene
  render+lint path every command already used, and that path turned out to be worse than C13's
  original note — `Scene._put()` fires one change event _per element touched_, so a cascading
  move of N elements was N full-scene passes, not one. Fixed generically at `Scene` (a
  `_transaction()` wrapping each `CommandBus` dispatch/undo/redo now coalesces every `_put`/
  `_remove` inside it into a single event) rather than special-cased for move, so cascading
  delete and any other multi-element command get the same fix. `createEditor.ts`'s subscription
  now repaints only the affected ids (`SvgRenderer.renderElements()`, extended to also catch any
  attached connector — its endpoints are always live-derived regardless of routing mode — and to
  resync tab order) instead of the whole scene, for a coalesced "update"-reason change; anything
  that could have altered containment or z-order still gets a full `render()`. Verified via a new
  benchmark scenario mirroring M15's own "Done when" line (a scripted 200-update drag of a
  ~40-element subtree: the linter now runs exactly once for the whole gesture, and the existing
  dispatch/undo/redo benchmark dropped roughly 20-40x). Keyboard parity for this gesture needed no
  new code — arrow-key nudge (M8) already covers it.

- ✅ **8-handle resize** — 4 corner, 4 mid-edge — with Shift for aspect lock (corner handles only)
  and Alt to resize from center. Added a `resizing` mode alongside `dragging` on the same
  `CanvasController`, armed by a pointerdown on a handle rather than a hit-test: the handles
  themselves (rendered in `SvgRenderer.renderOverlays()`, `pointer-events: all` inside the
  otherwise-inert overlay layer, same trick as the existing port markers) only ever render for a
  single non-connector, non-frame selection — Frame stays excluded here for the same reason it's
  excluded from drag, hover-ports, and connect-mode elsewhere in this class. No drag threshold —
  grabbing a handle is unambiguous, unlike mousedown-on-an-element which could still be a plain
  click.

  The geometry itself is a new pure module, `interaction/resize.ts`'s `resizeBounds()`: given a
  handle and a scene-space delta it returns a candidate `{x,y,w,h}`, anchoring whichever
  corner/edge the dragged handle doesn't touch (or the original center, for Alt), clamped to a
  1px floor matching the Properties panel's own W/H minimum. Unit-tested standalone
  (`resize.test.ts`), independent of the renderer or `CanvasController`.

  Live preview needed a genuinely new primitive, not a reuse of D26's move preview: dragging
  translates via a CSS `transform`, which can't express a width/height change, so resize instead
  re-renders the one element from an ephemeral `{...committed, ...preview}` merge
  (`SvgRenderer.previewResize()`) and redraws the selection outline, the resize handles themselves,
  and any validation badge to track the previewed bbox rather than the last-committed one — all
  three read a new `previewGeometry` override alongside `scene.get()`. Connectors attached to the
  resized element are left unrouted until commit, the same accepted simplification
  `previewTransform` documents for move.

  Deliberately **not** move-with: `Editor.beginResizeInteraction()` commits via a bare
  `updateElement` patch (only the resized element's own fields), not `moveElements` — an
  edge/corner handle that shifts the element's own x or y (e.g. dragging the west edge) must not
  cascade that shift onto descendants the way a real move does, or shrinking a container from the
  left would drag its contents sideways with it. Children escaping/reflowing on a container resize
  is explicitly M17's "container resize reflows children," not this milestone's. No
  grid/sibling/16px-inset snapping either, per M17's own "live 16px buffer enforcement... rather
  than the pad applying only at group creation" — this milestone only does the plain geometry.
  Keyboard parity needed no new code: the Properties panel's typed X/Y/W/H fields
  (`InspectorPanel.tsx`, already fully keyboard-operable since M8) predate this gesture and already
  cover it, the same way M16.1 found arrow-key nudge already covered drag-to-move.

- ✅ **Marquee selection** (fully-enclosed only, per Decisions taken) **and Ctrl/Cmd+A** — a new
  `marquee` mode on `CanvasController`, armed by a pointerdown on empty canvas or a **Frame's own
  background** rather than any selectable element: a Frame has no drag semantics (D25) and
  typically spans most of the canvas in its presentation-sectioning role, so treating a press-drag
  starting on one as a move-arm candidate (like every other element) would make it impossible to
  rubber-band anything inside it. A connector's degenerate hit-region is left alone, matching its
  pre-existing click-only selection. Unlike drag/resize there's no separate commit step:
  `hitTestRect` + `selection.set()` run live on every pointermove (cheap — only repaints overlays,
  not the scene/linter), Shift unions the enclosed set with the pre-drag selection instead of
  replacing it, and Escape restores a snapshot of that pre-drag selection rather than undoing a
  command, since nothing was ever dispatched. `SvgRenderer.setMarqueeRect()` draws the rubber-band
  rectangle itself, mirroring the existing connector-draft preview line. Keyboard parity is
  Ctrl/Cmd+A (selects every scene element, connectors and Frames included, matching what a click or
  marquee can already reach) — genuinely new code, unlike M16.1/M16.2's nudge/Properties-panel
  reuse, since nothing pre-existing covered "select everything."
- ✅ **Double-click to drill into a nested container**, Escape to step back out, with **both
  bounding boxes rendered** — the parent faint, the child active (IBM's prescribed model). Unlike
  drag/resize/marquee, drilling isn't a transient gesture — it's a persistent scope you can still
  drag/resize/marquee _inside_ of — so it's tracked as its own `drillPath: ElementId[]` on
  `CanvasController` (outermost container first) rather than a new `CanvasMode` variant, emitted
  via a separate `onDrillChange`. Double-clicking a Box/Zone/Group that actually has children (an
  empty one has nothing a drilled marquee could reach, so it's excluded) selects and focuses it,
  then pushes its full drillable-ancestor chain; each entry in the chain renders a new faint,
  undashed `SvgRenderer.setDrillPath()` outline (`stroke-opacity: 0.35`, no inset) _alongside_ —
  not instead of — the existing active-selection outline, satisfying "both bounding boxes at once"
  without new selection-outline code. Frame is excluded from drilling for the same reason it's
  excluded from drag/hover-ports/connect-mode elsewhere in this class: a presentation-sectioning
  background, not an IBM containment primitive (D24).

  The functional payoff, not just the visual one: while drilled into container X, a press-drag
  starting on X's own background now arms a marquee scoped to X's own descendants (via
  `scene.isSelfOrDescendant`) instead of moving X — mirroring the Frame carve-out marquee selection
  already needed, generalized to "the thing you're currently working inside of has no drag
  semantics of its own right now." Without this, dragging a fully-packed container's background
  would always move the container, with no way to rubber-band-select its contents. Escape pops one
  level off the drill path and re-selects whatever's now innermost (or clears selection entirely
  once back at the root) — "step back out" moves the active selection outward a level, not just
  the faint-outline chain. Keyboard equivalent: a second Enter on an already-selected, already-
  focused drillable container drills into it (mirroring the two clicks in a double-click); Space is
  deliberately left as pure toggle-selection, never drilling, so the two keys stay distinguishable.
  Plain single-click hit-testing needed no changes at all — M15's C9 fix already always resolves to
  the deepest element under the pointer, so reaching a nested element directly never required
  drilling; this milestone's drill scope is about the marquee/background-drag semantics and the
  dual-outline affordance, not reachability.

- ✅ **Clipboard**: copy / cut / paste / duplicate, Alt+drag to clone, paste-at-cursor. An
  in-memory `Editor` clipboard (`copy`/`cut`/`paste`/`duplicateElements`), deliberately not the OS
  clipboard — `apps/vscode`'s webview sandbox makes async `navigator.clipboard` permissioning
  inconsistent across shells, the same reason M15 skipped PNG export there, and an internal
  clipboard needs no permission prompt and is trivially keyboard-testable either way; cross-window
  paste is out of scope, not an oversight. `copy()` expands `ids` to descendants (move-with's own
  expansion) plus any connector whose _both_ endpoints land in that set — one crossing the copy
  boundary can't sensibly be duplicated, so it's left attached to the original still-live element,
  the same rule an internal `parentId` reference follows if its container wasn't copied. `paste()`
  clones with fresh ids via a shared `cloneElementsForPaste()` (also `duplicateElements()`'s own
  engine): centered at an explicit point — `CanvasController`'s own last-tracked pointer position,
  "paste at cursor" — or, with none given, cascading `PASTE_OFFSET` (16px, the existing buffer
  convention) further with each successive keyboard paste. `duplicateElements()` is deliberately
  independent of the copy/cut/paste clipboard (so duplicating doesn't clobber a pending paste) and
  is also Alt-drag-clone's own engine: `CanvasController`'s `dragging` mode gained a `cloneOnDrag`
  flag (Alt held at pointerdown) that, the moment the drag crosses the threshold, swaps the
  dragged ids for a fresh duplicate and re-targets the live preview onto it — the originals never
  move. Every one of copy/cut/paste/duplicate is inherently a keyboard gesture already
  (Ctrl/Cmd+C/X/V/D); Alt-drag-clone's own keyboard equivalent is Ctrl/Cmd+D (this same duplicate)
  followed by arrow-key nudge, both already covered, mirroring M16.1/M16.2's own "nothing new
  needed" findings. One consolidated `onClipboardAction` callback (not four near-identical ones)
  reports each action's resulting elements for the shell to announce. Building this surfaced and
  fixed **C14** (above): the exact discovery path was Ctrl+D silently no-op'ing every action after
  the first, live in a real browser (jsdom couldn't have caught it) — `syncDomOrder()`'s blanket
  re-append on any add was blurring keyboard focus off the canvas entirely, so no further keydown
  ever reached `CanvasController`'s (container-scoped) listener again.
- ✅ **Right-click context menus**, contextual to the hit target. `CanvasController` reports only
  _where_ (a new `onContextMenu(screenPoint, scenePoint)`, plus the Menu key / Shift+F10 keyboard
  equivalent) — _what_ the menu shows is entirely `@icad/ui-web`'s new `ContextMenu` component and
  whichever shell wires it, the same split `armPlacement`'s opaque callback already uses. A
  right-click syncs `selection` to the hit target first (an unselected target replaces it, one
  already part of a multi-selection leaves the whole group alone — "right-click any member" acts
  on the group; empty canvas or a Frame's own background clears it, matching the existing
  drill/marquee carve-out for "no real target"), so a shell only needs to read `editor.selection`
  to decide which actions apply — contextual to the hit target without `CanvasController` itself
  needing to know what a menu even is. `ContextMenu` is a thin wrapper over Carbon's own
  `Menu`/`MenuItem` (which already handles positioning, open/close, and keyboard nav natively) and
  the exact same `CommandItem[]` shape the command palette already uses (a new optional `danger`
  field renders Delete in Carbon's own destructive styling), so every action — Cut/Copy/Paste/
  Duplicate/Delete/Group/Ungroup/Select All — is defined once per shell and reused by both
  surfaces, not duplicated between them. "Paste" passes the exact scene point the menu opened at,
  so it lands where you actually right-clicked (or where the keyboard equivalent last focused/
  selected something), not wherever the pointer happens to be once the item runs.
- ✅ **Alt+click to select through to an occluded element.** A plain click already always lands on
  the deepest element at a point (M15's C9 fix), so Alt+click's own job is reaching every _other_
  element sharing that point — it cycles through `hitTestAll`'s full ordered stack there (a new
  `altClickCycle` tracking the last Alt+click's client point and stack index), advancing one step
  deeper each repeated Alt+click at the same spot and wrapping back to the top once exhausted;
  Alt+clicking a different point resets to that point's own deepest element. Always replaces the
  selection outright, matching Shift-click's own precedent that Alt is a reveal tool for one
  specific occluded element, not a multi-select gesture. No new keyboard code needed — Tab/
  Shift+Tab's tab order (M8) already reaches every element regardless of visual overlap, the same
  "already covered" finding M16.1/M16.2 made for nudge/Properties respectively.

Every gesture ships with its keyboard equivalent in the same PR — [D19](00-decision-log.md#d19--full-ibm-equal-access--wcag-21-aa--locked)
is a requirement, not a follow-up.

## M17 — The feedback layer

🟡 **In progress** — M17.1 (space+drag and middle-drag panning), M17.2 (grid, alignment guides,
live gesture readout), M17.3 (live 16px buffer enforcement on resize), and M17.4 (containers
auto-grow on drag) have landed.

1. ✅ **Render the grid.** `SvgRenderer` gained a background layer (`packages/core/src/render/
svgRenderer.ts`) — a single SVG `<pattern>` tiled at `scene.canvas.grid` spacing (the second real
   reader of that field, after `snapMove`; C11's "dead field" finding is fully closed now) behind a
   single huge `<rect fill="url(#icad-grid-pattern)">`. `patternUnits="userSpaceOnUse"` tiles in the
   same scene-space coordinate system the viewBox already maps, so it scales and pans for free with
   zero extra per-frame work — one DOM node regardless of zoom or diagram size, unlike per-line grid
   rendering. Toggled from `TopBar`'s View menu (`Show grid`/`Hide grid`, `packages/ui-web/src/
TopBar.tsx`) via a new `gridVisible`/`onToggleGrid` prop pair, persisted in `apps/web` via a new
   `persistence/gridPreference.ts` mirroring `themePreference.ts`'s own shape; `apps/vscode`'s
   webview defaults it on with no persistence (a cosmetic-only view preference, the same
   narrower-parity posture that shell already takes on PNG export). Recolors instantly on theme
   change (no `render()` call required, matching `setTheme()`'s own existing "call any time" shape).
   **Snapping to it already existed** (`snapMove()`'s grid-snap candidates, wired into drag since
   M16.1) — this step was purely the missing visual.
2. ✅ **Alignment guides.** The exact `SnapGuide[]` `snapMove()` already computed during drag (M15)
   but never rendered — `CanvasController.updateDrag` now passes them to a new `SvgRenderer.
setSnapGuides()`, drawn as thin dashed magenta lines (`#ee5396`, deliberately distinct from the
   blue selection/marquee family so a guide reads as "the canvas telling you something," not "part
   of the selection") in the overlay layer, cleared on drag end/abort. A locked axis's own guide
   (Shift axis-lock) is filtered out too — its delta is forced to 0 regardless of what `snapMove`
   found there, so drawing it would describe a snap that isn't actually being applied.
3. ✅ **Live position/dimension readout.** A small dark HUD label (`SvgRenderer.
setGestureReadout()`) tracks `"x, y"` during drag and `"w × h"` during resize, anchored just
   above the moving/resizing element's current top-left corner, cleared on commit/abort alongside
   the guides. Fixed dark-on-light styling regardless of the diagram's own resolved theme — this is
   transient gesture chrome, not diagram content, the same posture the validation badge already
   takes.
4. ⬜ Drop-target highlight when a drag hovers a container.
5. ✅ **Live 16px buffer enforcement on resize.** Drag already clamped to the parent inset
   (`snapMove`, M15); resize didn't (M16.2's own note: "No grid/sibling/inset snapping yet"). Rather
   than force one shared clamp function onto both — a move translates a fixed-size bbox rigidly, so
   clamping its _position_ is correct, but a resize handle only ever moves a subset of the box's
   four edges independently, and reusing a whole-bbox clamp there would silently collapse the box
   to 1px if both edges of the same side overshot the inset at once — `snapping.ts` gained a second,
   resize-specific export, `clampRectToParentInset(scene, parentId, rect)`, sharing only the
   boundary-computation building block (`parentInsetBounds`) with `snapMove`'s own clamp. Each of the
   four edges is clamped independently to `[parent + inset, parent + size - inset]`; an anchored
   edge a handle didn't touch is already valid (the box was valid before the gesture started) so
   clamping is a no-op there, and only the dragged edge(s) actually get capped. Wired into
   `CanvasController.updateResize` (not `Editor.beginResizeInteraction()`) — the same layering drag
   already uses, where `CanvasController` owns calling `snapMove()` and `Editor` just
   previews/commits whatever geometry it's given. The live W×H readout (M17.2) reads the _clamped_
   bounds, so the HUD always matches what's actually previewed/committed, never the raw
   pre-clamp candidate. A parent too small to fit the inset on either axis leaves the candidate
   untouched rather than producing a nonsensical clamp target — an edge case for a container far
   smaller than its own buffer, not a realistic diagram. _(Drag's own clamp, described above as
   already existing since M15, was removed by M17.4 right below — this resize-specific one is
   unaffected and still a hard limit.)_
6. ✅ **Containers auto-grow** when a child is dragged toward an edge, instead of letting it escape.
   `snapMove`'s drag-time parent-inset clamp (M15–M17.3's own item 5 above) is gone: a dragged child
   is no longer stopped at a wall mid-gesture, it goes wherever the pointer takes it. Instead,
   `Editor`'s `commitMove()` (shared by `beginInteraction().commit()` and `nudgeElements()`, so mouse
   drag and its keyboard equivalent get this for free alike) grows the moved elements' shared parent
   to fit afterward, via a new hand-written `autoGrowContainer` command
   (`packages/core/src/commands/commands.ts`) batched right after `moveElements` — its `do()` calls
   the new `autoFitContainer(scene, containerId, padding)` (`scene/bounds.ts`) fresh against the
   _current_ scene, so inside the batch's sequential `do()` walk it naturally sees the move already
   applied. `autoFitContainer` reuses `groupElements()`'s own bbox+padding sizing math, generalized
   via a new shared `fitRectWithPadding(bbox, padding, existing?)`: with no `existing` it's exactly
   `groupElements()`'s creation-time sizing (refactored to call it too, no behavior change there);
   with the container's own current bounds as `existing`, the result never shrinks below them —
   auto-grow only ever expands. A no-op (no `_put`, nothing added to the batch's change-event ids)
   when the container already comfortably contains its children, which is the common case for most
   drags. Auto-grow only applies when every dragged id shares one _defined_ parent — an ambiguous
   multi-parent selection or top-level (parentless) elements simply skip it, since there's no single
   container to grow. Resize's own clamp (item 5) is deliberately unaffected — the roadmap's own
   wording only ever named "dragged," not resized, for this behavior.
7. ⬜ **Container resize reflows children**, clamping them inside with the buffer preserved.
8. ⬜ **Alternating fills re-derive on reparent**, so nesting depth stays visually correct after a
   drag.
9. ✅ **Space+drag and middle-drag panning.** A new `panning` mode on `CanvasController`
   (`packages/core/src/interaction/canvasController.ts`), armed by either a middle-click
   (`event.button === 1`) or a left-button drag while a tracked `spaceHeld` flag is true — both
   checked first in `handlePointerDown`, ahead of the resize-handle/port/element/marquee branches,
   so panning always wins. No drag threshold (same "grabbing is unambiguous" reasoning M16.2 gave
   for resize handles) and purely a `ViewportController.panBy()` change — no scene, command, or
   linter involvement at all, so it costs nothing render-wise. Panning follows the hand (dragging
   right/down moves the viewport's scene-space origin left/up, the opposite sign convention from
   `handleWheel`'s scroll-pan, which is intentional — two different gestures, two different
   intuitive directions). Releasing Space ends a space-triggered pan immediately even if the mouse
   button is still down (mirrors how other direct-manipulation editors treat the _key_, not the
   button, as what defines the gesture); a middle-click pan only ever ends on its own pointerup,
   since there's no key to release. `spaceHeld` also clears on window blur so a stuck "grab" cursor
   can't survive something like Alt-Tab while the key is held. Space's pre-existing "select the
   focused element" keydown behavior is left completely untouched — a keyboard-only user never also
   fires a `pointerdown`, so there's no real conflict, only a flag that arming checks and this one
   key event alone never acts on. Cursor feedback (`grab` while armed, `grabbing` while actively
   panning) mirrors the existing inline `resizeCursor(handle)` pattern already used for resize
   handles. No keyboard equivalent needed beyond what already exists: panning the viewport itself
   has no accessibility requirement distinct from what Find/frame-presentation already provide.

## M18 — Arrangement

⬜ **Not started.** Blocked on M15's DOM reordering.

Z-order (to front / to back / step), 6-way align, distribute, lock and hide, and turning the
read-only Layers tab into an interactive one.

## M19 — Connector editing

⬜ **Not started.**

Waypoint drag handles (`setConnectorWaypoints` already exists in core and is simply unexposed),
endpoint retargeting onto a different element or port, reset-to-auto-routing, and in-place label
editing on the line.

## M20 — Full range on demand

⬜ **Not started.** Last, because rotation is the most invasive change in the plan.

- Rotation handle with 15° Shift-snapping, plus rotation-aware hit-testing (inverse transform),
  rotated resize handles, rotated port positions, and rotated bounds.
- Color picker beyond the 9 IBM pairs.
- New linter rules flagging non-zero rotation and off-palette color as off-spec (D28).

---

## Cross-cutting

- **Accessibility.** Every pointer gesture needs a keyboard path, and the existing tab order,
  `aria-owns` tree, and live-region announcements must survive each milestone. Re-verified per PR,
  not at the end.
- **MCP parity.** Every new command is exposed as an MCP tool in the same change, per the roadmap's
  standing rule that human-editor capabilities land as commands so agents inherit them.
- **Shell parity.** D27 means VS Code and desktop inherit each gesture for free, once M15 de-forks
  `apps/vscode`. Until that step lands, no manipulation work should be built against the fork.
- **Visual baselines.** M14 rebases them once. M16+ should not touch them; if a manipulation change
  moves a baseline, that is a bug worth investigating rather than re-recording.
