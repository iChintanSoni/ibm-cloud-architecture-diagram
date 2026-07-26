# Canvas parity plan — IBM conformance + direct manipulation

Plan of record for closing two gaps found by auditing the engine against draw.io, Excalidraw, and
IBM's own *IT architecture diagrams kit* v1.1 (`packages/catalog-build/.cache/architecture-icons/ppt/`)
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

| # | Defect | Evidence |
|---|---|---|
| C1 | Icons render inverted — colored glyph on a white outlined tile, where IBM is a **white glyph on a solid category tile** (actors: white glyph on a solid black circle) | IBM source `<rect fill="#1192E8" width="48" height="48"/>` + `<path fill="#FFFFFF">`; `extract.ts` `normalizeIcon()` strips the tile and recolors the glyph |
| C2 | Relationship connectors use a filled block arrowhead where IBM uses an **open-V line arrow** | `Connectors.drawio`: `Dependendency: endArrow=open;endSize=12;dashed=1` |
| C3 | `logical-connection` uses a dash-**dot** pattern (`6 3 1 3`); IBM uses even dashes | `Connectors.drawio`: `dashed=1;strokeWidth=2` |
| C4 | Connector stroke width defaults to 1.5; IBM specifies 2 | same |
| C5 | Tunnel band is the stroke color at 18% opacity; IBM specifies `#FFD7D9`, with yellow added for the double-tunnel variant | `Connectors.drawio` colour-code cells |
| C6 | The schema's `tunneling-connection` type is **mislabeled**: its rendering (band + solid line + arrow) actually matches IBM's "Traffic Through Tunnel/Encapsulation" line, not the "Tunneling Connection" text — which `Connectors.drawio` stores as a `strokeColor=none` **caption** cell (`edge="0"`), not an edge, and has no line style of its own. Count stays at 11; this is a display-label correction, not a missing type. *(Corrected during implementation — the original audit misread the raster deck image; the stencil XML, a higher-precedence [normative source](05-ibm-spec-conformance.md#normative-sources), settles it.)* | `Connectors.drawio`: the two "Traffic Through …Tunnel/Encapsulation" cells are `style="text;…"` value labels on real edges; "Tunneling Connection" is a separate `fontSize=11` caption cell with no edge behind it |
| C7 | Sidebar tab drawn for **Box only**; IBM draws it on every container (Region, OpenShift, Zone, Subnet, Public Network) | Kit slide 4 worked example |
| C8 | No sequencing/numbering badge (circled `#`) | Kit slide 6 |
| C9 | `hitTest` is bbox-only and connectors carry a degenerate `0×0` rect, so connectors are geometrically unhittable; clicks work only through a second, DOM-based path | [`hitTest.ts`](../packages/core/src/interaction/hitTest.ts), [`App.tsx`](../apps/web/src/App.tsx) |
| C10 | Renderer never reorders existing DOM nodes, so `z` changes cannot repaint correctly | [`svgRenderer.ts` `render()`](../packages/core/src/render/svgRenderer.ts) |
| C11 | `rotation` and `canvas.grid` are dead fields — declared, never read | [`types.ts`](../packages/core/src/scene/types.ts) |
| C12 | `CommandBus` has no coalescing, so any per-frame gesture would flood the undo stack | [`commandBus.ts`](../packages/core/src/commands/commandBus.ts) |
| C13 | Every `Scene` change — including a single-element `dispatch()`/`undo()`/`redo()` — re-runs a full-scene `SvgRenderer.render()` **and** a full-scene `Linter.run()`, not just for the changed ids. Cost scales with total diagram size, not gesture size: on the benchmark below, nudging 10 of 2000 elements and undoing it costs ~2s each, roughly what re-rendering the whole diagram from scratch costs. The ephemeral preview path (D26) avoids this during a drag itself, but `Interaction.commit()` still dispatches through this same full-scene path once at the end — [M16](#m16--the-core-loop)'s drag-to-move should budget for a multi-second freeze on commit at realistic diagram sizes unless render/lint are made incremental (scoped to the changed ids) before or during that milestone. *(Found while building M15.7's benchmark harness, not in the original audit. **Resolved in M16.1**: `Scene._transaction()` coalesces a command's `_put`/`_remove` calls into one change event — it turned out to be worse than this note implies, since a cascading move of N elements was N full-scene passes, not one — and `createEditor.ts`'s subscription now repaints only the affected ids for a position-only change instead of the whole scene.)* | [`createEditor.ts`](../packages/core/src/api/createEditor.ts) constructor's `scene.on()` subscription; [`benchmark.test.ts`](../packages/core/src/perf/benchmark.test.ts) |

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

> *"1. Make sure the inside bounding box is highlighted by **double clicking on the inside shape**.
> 2. **Drag the bottom left corner** to scale to needed size."*
> *"each inner element should have about **16px buffer** on each side. **Alternate white and light
> color fills** for better readability."*

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
   *display label* now reads "Traffic Through Tunnel/Encapsulation" to match the line IBM's stencil
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
   |---|---|---|---|---|---|
   | 500 | 83ms | 12ms | 7ms | <1ms | 887ms |
   | 1,000 | 149ms | 24ms | 17ms | <1ms | 2,192ms |
   | 2,000 | 382ms | 46ms | 47ms | <1ms | 6,018ms |

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

🟡 **In progress.** The first milestone a user can feel.

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
  original note — `Scene._put()` fires one change event *per element touched*, so a cascading
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
- ⬜ 8-handle resize — 4 corner, 4 mid-edge — with Shift for aspect lock and Alt to resize from center.
- ⬜ Marquee selection (fully-enclosed only, per Decisions taken) and Ctrl/Cmd+A.
- ⬜ **Double-click to drill into a nested container**, Escape to step back out, with **both bounding
  boxes rendered** — the parent faint, the child active (IBM's prescribed model).
- ⬜ Clipboard: copy / cut / paste / duplicate, Alt+drag to clone, paste-at-cursor.
- ⬜ Right-click context menus, contextual to the hit target.
- ⬜ Alt+click to select through to an occluded element.

Every gesture ships with its keyboard equivalent in the same PR — [D19](00-decision-log.md#d19--full-ibm-equal-access--wcag-21-aa--locked)
is a requirement, not a follow-up.

## M17 — The feedback layer

⬜ **Not started.**

- Render the grid; snap to it.
- Alignment guides with equal-spacing hints, drawn from M15's snapping engine.
- Drop-target highlight when a drag hovers a container.
- **Live 16px buffer enforcement** — dragging and resizing snap to the parent inset and refuse to
  overlap it, rather than the pad applying only at group creation.
- **Containers auto-grow** when a child is dragged toward an edge, instead of letting it escape.
- **Container resize reflows children**, clamping them inside with the buffer preserved.
- **Alternating fills re-derive on reparent**, so nesting depth stays visually correct after a drag.
- Live position/dimension readout during a gesture.
- Space+drag and middle-drag panning.

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
