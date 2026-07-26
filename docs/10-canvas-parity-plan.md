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

🟡 **In progress** — steps 1–6 landed and tested; step 7 (golden fixtures) remains. Renderer +
catalog only; no interaction changes.

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
7. ⬜ **Golden fixtures.** Import the four IBM-authored templates (`iks_sr_mz_vpc.drawio` and
   siblings) as reference renders, so IBM's own diagrams become the visual regression suite.

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

⬜ **Not started.** No user-visible features. Everything after this depends on it.

1. **Ephemeral interaction layer (D26, C12).** `Editor.beginInteraction(ids)` returns a handle with
   `update(delta)` / `commit()` / `abort()`. `update()` writes a `transform="translate(dx,dy)"` onto
   the affected `<g>` nodes — one attribute per node, no `innerHTML` rebuild, no lint run. `commit()`
   dispatches a single command. `abort()` (Escape) discards.
2. **Partial + ordered rendering (C10).** Add `renderer.renderElements(ids)` for resize previews,
   and make `render()` reorder existing nodes to match `scene.all()` — guarded by a cached order
   signature so the common case stays O(1) in DOM writes.
3. **Unified hit-testing (C9).** One module serving `hitTest(point)`, `hitTestAll(point)` (for
   alt-click cycling), and `hitTestRect(rect)` (for marquee). Connectors get real polyline geometry
   with a zoom-scaled tolerance band; containment resolution prefers the deepest child over its
   container. Deletes the divergent DOM-based path in `App.tsx`.
4. **Pointer state machine (D27).** `core/interaction/CanvasController` on Pointer Events with
   `setPointerCapture`, so a drag survives leaving the canvas and touch/pen work for free. Modes:
   idle, pan, marquee, drag, resize, rotate, connect, place. `App.tsx` shrinks to wiring.
5. **Snapping engine.** `core/interaction/snapping.ts`: grid snap against the live
   `scene.canvas.grid` (finally reading C11's dead field), the 16px parent inset as a hard
   constraint, and sibling edge/center alignment candidates. Returns an adjusted delta plus the
   guide segments for the overlay to draw.
6. **De-fork `apps/vscode` (D27).** Its `webview/src` currently duplicates the web shell and has
   drifted before. It moves onto `@icad/ui-web` and `CanvasController` directly, as `apps/web` and
   `apps/desktop` already do. Done here rather than later: this is the milestone already
   restructuring the interaction layer, and deferring it means hand-porting five milestones of
   gestures into a fork.
7. **Benchmark harness.** Frame-time guard for drag/resize at 500/1000/2000 elements, absorbing the
   intent of [M12](09-roadmap.md#m12--performance-at-scale) so performance is measured before it
   regresses rather than after.

**Done when:** a scripted 200-frame drag of a 40-element subtree holds frame budget, produces
exactly one undo entry, and runs the linter exactly once; and all three shells drive the canvas
through the same `CanvasController` with no shell-local interaction code.

---

## M16 — The core loop

⬜ **Not started.** The first milestone a user can feel.

- Drag-to-move with a drag threshold, Shift to axis-lock, Escape to abort, and move-with semantics
  (already correct in `moveElements`).
- 8-handle resize — 4 corner, 4 mid-edge — with Shift for aspect lock and Alt to resize from center.
- Marquee selection (fully-enclosed only, per Decisions taken) and Ctrl/Cmd+A.
- **Double-click to drill into a nested container**, Escape to step back out, with **both bounding
  boxes rendered** — the parent faint, the child active (IBM's prescribed model).
- Clipboard: copy / cut / paste / duplicate, Alt+drag to clone, paste-at-cursor.
- Right-click context menus, contextual to the hit target.
- Alt+click to select through to an occluded element.

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
