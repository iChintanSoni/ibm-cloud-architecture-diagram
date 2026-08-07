# Improvement plan — engine hardening, canvas ergonomics, agent safety

Plan of record for the next work cycle, from a full-repo audit (2026-08-07) of the engine, the
shells, the MCP surface, and the docs, benchmarked against draw.io and Excalidraw the same way
[Canvas parity plan](../packages/core/docs/canvas-parity-plan.md) did for direct manipulation.

That plan closed the "the canvas has no drag, resize, marquee, or clipboard" gap. This one closes
three different ones:

1. **Structural** (I1–I6) — the scene index, the command model, and the render/lint hot paths are
   O(n²)-shaped and snapshot-based. They work at today's scale and are the ceiling on every
   milestone after it.
2. **Ergonomic** (I7–I12) — the highest-frequency human interaction in a diagramming tool (edit a
   label) still requires leaving the canvas.
3. **Safety & trust** (I13–I17) — the MCP server writes anywhere on disk, `.icad` loading has no
   schema validation, and two shipped claims (re-editable SVG, one-engine parity) aren't true yet.

Sequenced so the cheap, high-confidence fixes land first and the one large refactor (I3) is taken
deliberately rather than discovered mid-milestone.

## Status

**M34 shipped (2026-08-07):** I18, I13, I14, I5, I16. See each item below for what actually landed
— in three cases (I18, I5, I16) the fix surfaced a second, related bug caught and fixed in the
same pass, not just the item as originally scoped.

---

## Ranked shortlist

If only six things get done, these six, in this order:

| Rank | Item                                                                        | Why first                                                                                         | Size | Status |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---- | ------ |
| 1    | [I7 — Inline canvas text editing](#i7--inline-canvas-text-editing)          | Highest-frequency interaction in the product; changes how it _feels_ more than anything else here | M    | open   |
| 2    | [I13 — MCP filesystem confinement](#i13--mcp-filesystem-confinement)        | Arbitrary file write reachable from a prompt-injected `.icad`                                     | S    | ✅ M34 |
| 3    | [I5 — Drag/rotate transform collision](#i5--dragrotate-transform-collision) | Live, user-visible, persistent visual desync; no test covers it                                   | S    | ✅ M34 |
| 4    | [I1 — Scene child + z-order indexes](#i1--scene-child--z-order-indexes)     | Unblocks every other perf item; contained to one file                                             | S    | open   |
| 5    | [I2 — Incremental / deferred lint](#i2--incremental--deferred-lint)         | Cheapest large latency win on the interactive path                                                | S    | open   |
| 6    | [I14 — `.icad` schema validation](#i14--icad-schema-validation)             | Untrusted input reaches the engine from two shells and an LLM                                     | S    | ✅ M34 |

Sizes: **S** ≈ 1 sub-milestone, **M** ≈ 1 milestone, **L** ≈ multi-milestone.

---

## Confirmed defects

Each verified by reading the code, not inferred. Line references are as of `3361916`.

| #   | Defect                                                                                                                                                                                                         | Evidence                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `Scene.all()` sorts the whole element map on every call; `childrenOf` calls it; `descendantsOf` BFS's calling `childrenOf` per node → O(k·n log n)                                                             | [scene.ts:86–111](../packages/core/src/scene/scene.ts#L86)                                                                                                                                             |
| A2  | Full-scene lint runs synchronously inside the `scene.on()` subscription — every nudge, every drag commit, no debounce or scoping                                                                               | [createEditor.ts:584](../packages/core/src/api/createEditor.ts#L584)                                                                                                                                   |
| A3  | `attachedAutoConnectors` is captured at command _construction_ time; inside a `batch()` it misses connectors a prior sub-command added or retargeted                                                           | [commands.ts:145](../packages/core/src/commands/commands.ts#L145)                                                                                                                                      |
| A4  | Undo stack is unbounded and each entry holds full element snapshots                                                                                                                                            | [commandBus.ts:9](../packages/core/src/commands/commandBus.ts#L9)                                                                                                                                      |
| A5  | `previewTransform` writes `transform="translate(…)"` over the same attribute `renderElement` uses for `rotate(…)`; abort/zero-delta commit strip it with no repaint following                                  | [svgRenderer.ts:692](../packages/core/src/render/svgRenderer.ts#L692), [:963](../packages/core/src/render/svgRenderer.ts#L963), [createEditor.ts:1090](../packages/core/src/api/createEditor.ts#L1090) |
| A6  | Canvas drag-resize reflows children; the Properties panel's W/H fields and MCP `element_update` do not — same operation, three behaviours                                                                      | [createEditor.ts:1151](../packages/core/src/api/createEditor.ts#L1151) vs [:786](../packages/core/src/api/createEditor.ts#L786)                                                                        |
| A7  | `.icad` load validates `format`, `version`, and `Array.isArray(elements)`, then casts. No element-shape, discriminant, finite-number, or duplicate-id checks                                                   | [icad.ts:75](../packages/core/src/io/icad.ts#L75)                                                                                                                                                      |
| A8  | MCP `resolvePath` resolves against `process.cwd()` with no root confinement, extension allow-list, or overwrite guard — `doc_open` reads and `doc_save`/`export_diagram` write anywhere                        | [document.ts:19](../packages/mcp/src/tools/document.ts#L19)                                                                                                                                            |
| A9  | Autosave uses one global IndexedDB key; two tabs silently overwrite each other's crash-recovery draft                                                                                                          | [autosave.ts:10](../apps/web/src/persistence/autosave.ts#L10)                                                                                                                                          |
| A10 | `renderElement` rebuilds each node's whole subtree via `innerHTML = ""` on every repaint — no attribute diffing                                                                                                | [svgRenderer.ts:911](../packages/core/src/render/svgRenderer.ts#L911)                                                                                                                                  |
| A11 | [D8](./decision-log.md#d8--re-editable-svg-via-embedded-icad-copy--locked)'s embedded `icad:source` is written but never read anywhere — no importer exists                                                    | [export.ts:212](../packages/core/src/io/export.ts#L212), no reader in any shell                                                                                                                        |
| A12 | Double-click drills into containers; there is no inline label editing anywhere on the canvas                                                                                                                   | [canvasController.ts:420](../packages/core/src/interaction/canvasController.ts#L420)                                                                                                                   |
| A13 | No E2E test drives a real mouse drag, resize, rotate, marquee, or connector edit — the exact class where C14/C15/A5 all live                                                                                   | [apps/web/e2e](../apps/web/e2e/) is a11y + keyboard only                                                                                                                                               |
| A14 | The perf benchmark fails under `pnpm -r test` — it shares a machine with five other suites running in parallel, but its budgets assume an idle one. Passes in isolation, fails every time in the recursive run | [benchmark.test.ts:80](../packages/core/src/perf/benchmark.test.ts#L80); reproduced on a clean tree, all three sizes, `loadMs` only                                                                    |

---

## Workstream 1 — Structural (engine)

### I1 — Scene child + z-order indexes

**Problem:** A1. Every containment walk re-sorts the document.

**Fix:** Maintain inside `Scene`, updated in `_put`/`_remove`/`_replaceAll`:

- `childIndex: Map<ElementId, Set<ElementId>>` — `childrenOf` becomes a lookup.
- A memoized z-sorted array for `all()`, invalidated on `_mutationCount` change. That hook already
  exists and is already used this way by [`portGroupsFor`](../packages/core/src/routing/routeConnector.ts#L88) —
  this generalises the same pattern.

Keep `all()`'s current return contract (a fresh sorted array) at first; hand out a frozen shared
array only once callers are audited for mutation.

**Acceptance:** `descendantsOf` on a 200-child container is O(k), not O(k·n log n); benchmark
`dispatchMs` at 2,000 elements drops materially; no behavioural test changes.

**Size:** S · **Risk:** low, contained to one file

---

### I2 — Incremental / deferred lint

**Problem:** A2, compounded by `siblingOverlapRule` being O(siblings²) per parent
([rules.ts:591](../packages/core/src/linter/rules.ts#L591)) and
`connectorCrossesObstacleRule` rebuilding obstacle sets per connector
([rules.ts:767](../packages/core/src/linter/rules.ts#L767)).

**Fix, in two steps:**

1. Debounce the lint pass off the synchronous change handler (idle callback / short timer), so a
   drag commit paints immediately and diagnostics settle after. Keeps the linter advisory, which
   [D12](./decision-log.md#d12--advisory-linter--quick-fixes--optional-export-gate--locked)
   already establishes it as.
2. Give `Rule` an optional scoped form — `(scene, ctx, dirtyIds?)` — and let rules that can, run
   against the dirty set. Rules that can't declare themselves whole-scene and run on the debounce
   only.

**Acceptance:** a sustained arrow-key nudge at 2,000 elements never blocks a frame on lint; export
gate and diagnostics content are unchanged.

**Size:** S (step 1) + M (step 2) · **Risk:** low; step 2 needs care that a scoped rule can't miss
a diagnostic whose cause is outside the dirty set (containment/connector rules especially).

---

### I3 — Commands become serializable patches

**Problem:** A3 and A4, and the ceiling they impose. `Command` is `{ label, do(scene), undo(scene) }` —
opaque closures. Everything downstream pays for it:

- `quickfix_apply` can't accept a fix over the wire and must keep a live server-side
  `Map<string, Diagnostic>` and match by id, because
  _"`Diagnostic.quickFix` is a `Command` (closures) that can't survive JSON-RPC"_
  ([state.ts:23](../packages/mcp/src/state.ts#L23)). That comment is the architecture reporting the
  constraint.
- The VS Code host can't participate in undo semantically; it relays whole documents.
- No session log, no replay, no "what did the agent just change," no diff view.
- Real-time collaboration — deferred by [D4](./decision-log.md#d4--local-first-single-user-files--locked),
  not designed against — becomes a core rewrite rather than a feature.
- The stale-snapshot bug class (A3) keeps recurring. It has already been hand-fixed three times,
  each with a paragraph of archaeology in the doc comment: `reparentElement`, `autoGrowContainer`,
  and `setZOrder` all read fresh state in `do()` _because they were caught_. `attachedAutoConnectors`
  still has the bug.

**Fix:** Introduce a data representation — `{ op, ids, before, after }` patches — as the real
command payload, with the current closure-returning builders kept as a thin façade so call sites
don't churn. `do`/`undo` become "apply patch forward / apply patch inverse" against the live scene,
which structurally eliminates A3: there is no construction-time snapshot left to go stale.

Cap history length while here (A4), and drop the oldest entries rather than growing unbounded.

**Acceptance:** every command round-trips through `JSON.stringify` and replays to an identical
scene; `attachedAutoConnectors` is derived at apply time; `quickfix_apply` can take a fix by value.

**Size:** L · **Risk:** high — this touches every command and every test that asserts on undo. Take
it as its own milestone with a green test suite before and after, not folded into feature work.

**This is the item that gets more expensive every milestone it's deferred.** The core is ~8k lines
today.

---

### I4 — Spatial index for hit-testing and layout rules

**Problem:** `hitTestAll` is O(n) with a `connectorPathPoints` recomputation per connector and an
`ancestorsOf` walk per candidate ([hitTest.ts:116](../packages/core/src/interaction/hitTest.ts#L116));
`hitTestRect` is O(n); the overlap and containment lint rules are O(n²) in the worst case.

**Fix:** A coarse uniform grid (bucket by cell, rebuild on `_mutationCount`) is almost certainly
enough — an R-tree is more than this workload needs. Feed it from `hitTestAll`, `hitTestRect`,
`siblingOverlapRule`, and `childOutsideParentBoundsRule`.

**Acceptance:** `hitTestMs` at 2,000 elements drops by an order of magnitude; hit-test ordering
semantics (deepest, then topmost) are bit-identical to today's.

**Size:** M · **Risk:** medium — the ordering contract in `hitTestAll` is subtle and well-tested;
the index must feed candidates into the _existing_ comparator, not replace it.

**Depends on:** I1

---

### I5 — Drag/rotate transform collision

✅ **Done (M34, 2026-08-07).** Composed `translate(dx, dy) rotate(deg cx cy)` in `previewTransform`
(the compose approach, not the wrapper `<g>` — smaller diff, same fix) — translate-outermost so
the shape rotates about its own center exactly as `renderElement` does, then the whole result
slides by `(dx, dy)` in screen space. Added 3 regression tests in `createEditor.test.ts` covering
all three symptoms below; confirmed each one fails without the fix by temporarily reverting it and
re-running (a real red/green check, not just a passing test written against already-fixed code).

**Problem:** A5. Three user-visible symptoms:

1. Dragging a rotated element makes it visually snap to 0° for the whole gesture.
2. `abort()` (Escape mid-drag) calls `previewTransform(ids, 0, 0)` → `removeAttribute("transform")`,
   dispatches no command, fires no scene change, so nothing repaints. The rotation stays visually
   gone until something unrelated triggers a render.
3. A net-zero-delta commit does the same: transform stripped, `commitMove` skipped by the
   `dx !== 0 || dy !== 0` guard, no repaint.

**Fix:** Stop sharing one attribute between two concerns. Either compose both into a single
transform string in `previewTransform` (reading the element's committed rotation), or wrap each
element's `<g>` in a preview `<g>` that owns the translate. The wrapper is cleaner and also fixes
the selection-outline case, which has the same collision.

**Acceptance:** a test that rotates an element, runs a preview cycle (`update` → `abort`, and
`update` → zero-delta `commit`), and asserts the `rotate(` transform survives both. No such test
exists today, which is why this is live.

**Size:** S · **Risk:** low

---

### I6 — Renderer attribute diffing

**Problem:** A10. A 200-element move commit is 200 full subtree teardowns and rebuilds. `innerHTML = ""`
also destroys focus inside the node — the adjacent problem `syncDomOrder` already carries explicit
focus-restoration code for (C14/C15).

**Fix:** Diff at the attribute level for the common case (geometry/label/style changed, structure
did not); fall back to full rebuild when the element's shape genuinely changed (type, catalogRef,
container-vs-leaf).

**Acceptance:** repainting an unchanged-structure element issues no `innerHTML` write and preserves
a focused descendant node.

**Size:** M · **Risk:** medium — this is where visual regressions hide. Pair with I17.

---

## Workstream 2 — Ergonomic (canvas & shells)

### I7 — Inline canvas text editing

**Problem:** A12. Labels — which every element has — are editable only via the right-hand
Properties panel, on blur. Select shape → move eyes to panel → click field → type → blur. In both
stated inspirations, double-click-to-edit-label is the primary text interaction; in Excalidraw,
double-click on empty canvas creates text.

This is the highest-frequency interaction in the product and currently costs a full context switch.

**Fix:** An overlay text editor on the canvas — a positioned HTML `<input>`/`<textarea>` over the
element's label rect (not SVG `<foreignObject>`, which is inconsistent across export and print
paths and would leak into the export clone). Commit on Enter/blur as the existing
`updateElementProperties` command, so undo granularity and MCP parity are unchanged.

Scope:

- Double-click a shape → edit its label. Double-click a connector → edit its label.
- `F2` on a selected element → same.
- Type-to-replace on a selected element (printable key starts an edit with the field cleared).
- `Escape` cancels, `Enter` commits, `Tab` commits and moves to the next element in tab order.
- Respect `locked`.

Interaction conflict to resolve: double-click currently drills into containers
([canvasController.ts:420](../packages/core/src/interaction/canvasController.ts#L420)). Proposal —
double-click on a container's **label or chrome** edits; double-click on its **empty interior**
drills. That keeps M16.4's drill gesture discoverable while giving the label the more direct
affordance. Needs a decision entry.

**Acceptance:** a keyboard-only user and a mouse-only user can each rename any element without
touching the Properties panel; every edit is one undo step; the a11y live-region announces the
edit the same way panel edits do.

**Size:** M · **Risk:** medium — new focus/IME/a11y surface on a canvas that is currently a clean
roving-tabindex model. Must not regress
[Accessibility](../packages/core/docs/accessibility.md#canvas-the-hard-20).

---

### I8 — Drag and drop from the Library

**Problem:** No `draggable`, `dragstart`, or `dataTransfer` anywhere in `packages/ui-web` or
`apps/web`. Placement is a modal two-step: click the stencil, then click the canvas.

**Fix:** HTML5 drag from the Library panel onto the canvas, with a live drop-target highlight
reusing `setDropTarget` (already built for M17.6 drag-to-reparent), so dropping onto a container
parents in one gesture. Keep click-to-place as-is for keyboard parity.

**Acceptance:** dragging a stencil onto a container both places and parents it in one undo step;
keyboard placement is unchanged.

**Size:** S · **Risk:** low

---

### I9 — Hover quick-connect

**Problem:** Creating a connector requires entering connect mode. Both inspirations offer
hover-arrows/handles directly on a shape, which is the fastest way to build a graph.

**Fix:** On hover, the port markers already rendered by `setHoveredElement` become drag sources:
drag from a port to a target element (or to empty canvas, which creates and immediately
label-edits a new node — pairs with I7).

**Size:** M · **Risk:** medium — interacts with resize handles and marquee start; the mode machine
in `CanvasController` needs a clean precedence rule.

---

### I10 — Per-document autosave slots

**Problem:** A9.

**Fix:** Key the IndexedDB draft by document identity (file handle name / path / a stable doc id),
and keep a small ring of the last N drafts rather than one. Recovery banner offers the matching
draft, not "the" draft.

**Size:** S · **Risk:** low

---

### I11 — Canvas ergonomics backlog

Not yet scoped into milestones; listed so the gap is recorded rather than rediscovered.

| Gap                                  | Note                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Copy/paste style ("format painter")  | High-frequency during cleanup passes                                                                                                  |
| Search **and replace** across labels | Find exists; replace doesn't                                                                                                          |
| Multi-page documents                 | Frames are presentation sections, not pages; draw.io users expect pages                                                               |
| User-defined templates / stencils    | Teams have house patterns; ships with 4 + 4 fixed                                                                                     |
| Real layers                          | The Layers tab is a containment tree; visibility layers orthogonal to containment are a different, expected feature                   |
| Minimap                              | 1,000,000-unit grid extent with no orientation aid                                                                                    |
| Touch / pen                          | `pointerType` is never inspected; tablet review is a real internal use case                                                           |
| Review comments                      | [D5](./decision-log.md#d5--crisp--professional-visual-style--locked) calls these stakeholder deliverables; there's no review workflow |

---

### I12 — Decompose `apps/web/App.tsx`

**Problem:** 1,782 lines, 25 `useState` hooks — every dialog, canvas mode, find state, and export
option in one component. Least testable file in the repo.

**Fix:** Extract per-concern hooks (`useExportDialog`, `useFindState`, `useCanvasMode`,
`useDocumentLifecycle`) and lift the dialog components into `packages/ui-web` alongside their
existing siblings. The shell should be composition, per
[D2](./decision-log.md#d2--framework-agnostic-typescript-core--thin-shells--locked).

**Size:** M · **Risk:** low, mechanical — but do it _after_ I7, which will add state to this file.

---

## Workstream 3 — Safety & trust

### I13 — MCP filesystem confinement

✅ **Done (M34, 2026-08-07).** `packages/mcp/src/workspace.ts`: two-stage confinement (a cheap
lexical check on the un-resolved root, then a `realpath`-based check on the resolved target —
comparing like-for-like on each side, since a `realpath`'d root compared against an un-resolved
candidate would reject legitimate paths whenever the root itself sits under a symlinked ancestor,
which OS temp directories on macOS always are). Extension allow-lists (`.icad` for
`doc_open`/`doc_save`, `.svg` for `export_diagram` — not `.png` too, since PNG export doesn't
exist server-side yet and allow-listing it would promise a capability that isn't real), a `.git`-
segment reject, and an overwrite guard (`assertOverwritable`, tracking which paths this session
itself opened or wrote) all landed as specified. `ICAD_MCP_WORKSPACE_ROOT` env var, defaulting to
the server's own `cwd` (unchanged from before). 19 new unit tests in `workspace.test.ts` cover
every acceptance criterion below directly against the real filesystem (temp dirs, real symlinks),
not mocked.

Also fixed, found wiring this through: `apps/agent`'s `McpSession` spawns the MCP subprocess with
no workspace root at all, so its own tests (writing to `os.tmpdir()`) and — more importantly —
`runDiagramTask`'s real production path (whose `outputIcadPath`/`outputSvgPath`/`existingIcadPath`
are supplied directly by the human/A2A caller, never invented by the LLM sub-agents) would have
started failing under the new confinement. Fixed by having `runDiagramTask` compute the workspace
root as the common ancestor directory of its own input paths and pass it through
`McpSession.start({ workspaceRoot })` → `ICAD_MCP_WORKSPACE_ROOT` — confining the subprocess to
exactly what the caller already authorized, no wider.

**Problem:** A8. `doc_save` and `export_diagram`'s `path` write JSON/SVG anywhere the process can
reach — `../../../.git/hooks/pre-commit`, `~/.ssh/config`, a mounted share. `doc_open` reads
anything. An LLM acting on a prompt-injected `.icad` file in a cloned repo is a plausible path to
arbitrary file overwrite.

**Fix:**

- A configurable workspace root (CLI flag / env var, defaulting to `process.cwd()`).
- Confine after `realpath` resolution, so symlinks can't escape.
- Extension allow-list on writes: `.icad`, `.svg`, `.png`.
- Refuse to overwrite an existing file that this session didn't create or open, unless `force`.
- Reject paths in a `.git/` directory outright.

**Acceptance:** tests covering `..` traversal, absolute paths outside the root, symlink escape, and
a disallowed extension.

**Size:** S · **Risk:** low. Do this before any wider distribution of the MCP tarball.

---

### I14 — `.icad` schema validation

✅ **Done (M34, 2026-08-07).** `packages/core/src/io/icadSchema.ts`: a `zod` discriminated union
mirroring `SceneElement` exactly, one arm per element type, each `.strict()`. Added as core's
**first-ever runtime dependency** (previously zero — a deliberate note, not an oversight: `zod` is
a pure, zero-dependency validator with no UI-framework coupling, so it doesn't compromise D2's
"framework-agnostic" core, but it does end an 8k-line streak worth flagging explicitly rather than
adding quietly).

Deliberately _not_ validated: whether `catalogRef` resolves against a real catalog (needs a live
`Catalog`, which `io/icad.ts` has no access to by design — already covered live by the linter's
`catalogIconRule`). `w`/`h` deliberately accept a non-finite/non-positive number (a custom
`typeof value === "number"` check, not plain `z.number()`, which zod's own default already rejects
`NaN`/`Infinity` for) — confirmed empirically, not assumed, and preserved on purpose so the
pre-existing `clampSize` repair step keeps handling that class of garbage exactly as before,
verified against the original test asserting a `w: 0, h: NaN` element survives clamped to `1`
rather than getting dropped.

`RepairReport` (new): every category `migrate()`/`repair()` fixes or drops —
`invalidElementsDropped` (I14's own contribution), plus `duplicateIdsDropped` (new: first
occurrence kept, later ones dropped — a deliberate policy change from `Scene._replaceAll`'s
previous silent `Map` "last wins" semantics), and the four pre-existing repair categories
(`danglingParentsCleared`, `cyclesBroken`, `danglingConnectorsDropped`, `geometryClamped`), now
actually reported instead of silently applied. `fromIcad`/`applyIcad` keep their exact prior
signatures (report discarded) — no caller needed to change; `fromIcadWithReport`/
`applyIcadWithReport` are additive siblings for a caller that wants to surface "3 elements were
dropped" to a user (not yet wired into any shell's UI — the mechanism exists, the UI surfacing is
still open, noted under I14's own scope as something intentionally not done here).

Found and fixed in the process: a genuine pre-existing bug in `applyIcad` — assigning
`scene.meta = doc.meta` directly crashed on a legacy schema-v1 document with no `meta` object at
all (`scene.meta.updatedAt` on the next `_replaceAll`, `undefined` has no properties), a case
`fromIcad` already handled correctly via `Scene`'s own constructor defaulting. `applyIcadWithReport`
now goes through a throwaway `Scene` for the same defaulting, so the two entry points agree.

45 new tests (`icadSchema.test.ts` + additions to `icad.test.ts`), including one confirming a
`__proto__` key never survives into parsed output or the real prototype chain (zod's `.strict()`
doesn't flag `__proto__` as an unrecognized key — a confirmed zod quirk, not a vulnerability: the
key never reaches the parsed result either way).

**Problem:** A7. The VS Code extension opens arbitrary `.icad` files from any cloned repo; the MCP
server `JSON.parse`s any path an LLM names. `repair()` fixes dangling parents, cycles, orphan
connectors, and degenerate `w`/`h` — and nothing else.

Not currently validated: `type` being a known discriminant, `semantic` matching `type`, `x`/`y`
being finite, `catalogRef` resolving, port sides being valid, **duplicate ids** (`_replaceAll` uses
a Map — later wins, so elements vanish silently), unknown keys, prototype-pollution keys.

**Fix:** A real element schema in core. `zod` is already a workspace dependency
(`packages/mcp`), so hoisting it is not a new dependency decision. Validate in `migrate()` before
the cast; route recoverable problems through the existing `repair()` channel (drop the element,
record a diagnostic) and only throw for a document that isn't an `.icad` at all — preserving the
current "never throw on a repairable file" contract.

Surface repairs to the user rather than silently: a load-time diagnostics list, so "3 elements were
dropped" is visible instead of mysterious.

**Acceptance:** fuzz/property test that no arbitrary JSON object reaching `fromIcad` can produce a
scene that fails an internal invariant; duplicate ids are reported, not silently collapsed.

**Size:** S · **Risk:** low

---

### I15 — Agent visual feedback (MCP)

**Problem:** No MCP tool returns a rendering. `doc_get` returns JSON, `lint` returns diagnostics,
`export_diagram` returns an SVG _string_ an LLM can't see, and PNG is explicitly unsupported
server-side. The agent's entire feedback loop on **layout quality** — which the linter can only
partially proxy — is: emit coordinates, hope.

`apps/agent/src/pngExport.ts` exists precisely because this hurts. That capability belongs in the
MCP server so _any_ multimodal agent benefits, not only the Deep Agent runtime.

**Fix:** `render_preview` returning an MCP image content block. Then, in rough value order:

- `element_get` / `scene_describe` — inspect one element without pulling the whole document.
- `layout_auto` / `layout_tidy` — agents are bad at coordinates and good at structure. Pair
  `scene_apply` for structure with a deterministic layout pass for geometry.
- `undo` / `redo` tools — an agent that makes a bad batch currently has no cheap retreat.
- A dry-run mode on `scene_apply`.

**Acceptance:** an agent can author, look at what it drew, and self-correct without leaving the MCP
surface.

**Size:** M · **Risk:** low, additive. Note the server currently runs headless via jsdom, so PNG
rasterization needs a real decision (headless browser vs. shipping SVG-only preview).

---

### I16 — Honour or retract the shipped claims

✅ **Done (M34, 2026-08-07)** for web and desktop; **VS Code explicitly not done** (see below —
a genuinely separate implementation, not a follow-up oversight).

Two claims are currently made and not met:

1. **Re-editable SVG (A11).** [D8](./decision-log.md#d8--re-editable-svg-via-embedded-icad-copy--locked)
   says _"our tool can reopen and edit it"_; the README says _"SVGs embed a re-editable copy."_
   `id="icad:source"` is written and never read — no `atob`, no importer, in any shell.
   **Fix:** ~40 lines — parse the SVG, read the `metadata` node, base64-decode, hand to
   `applyIcad`. Wire into Open in web/desktop/VS Code. Or retract the claim from the README and
   mark D8 as unimplemented. Building it is cheaper than the credibility cost of the gap.

   **Shipped:** `readIcadFromSvg` in `packages/core/src/io/export.ts` — `DOMParser`, find
   `metadata#icad:source`, base64-decode, `JSON.parse`, return `unknown` for the caller to hand to
   `fromIcad`/`fromIcadWithReport` (so I14's validation applies to a re-imported SVG exactly as it
   does to a `.icad` file — verified with a test that tampers the embedded source and confirms the
   malformed element is dropped, not the whole load rejected). Throws a distinct
   `IcadSourceCorruptError` when `icad:source` exists but can't be decoded, vs. returning
   `undefined` (not an error) when there's no embedded source at all — a plain SVG, or one exported
   with `embedSource: false`, was never meant to round-trip. Confirmed `DOMParser` (including its
   `<parsererror>` failure-reporting convention) works identically in jsdom — `packages/mcp`
   already copies it onto the headless Node runtime for exactly this kind of use — and in a real
   browser, empirically, not assumed.

   Wired into `apps/web`'s Open flow (`loadIntoEditor`, the single choke point all three of its own
   open paths — File System Access picker, Tauri native dialog, `<input>` fallback — funnel
   through), which **also covers `apps/desktop`** since it reuses `apps/web`'s own build and
   persistence layer (D22). File picker types/filters widened to accept `.svg` for Open only, never
   Save. Verified end-to-end in a real headless Chromium session (not just unit tests): placed a
   box, exported it through the real Export dialog, re-opened the real downloaded SVG through the
   real file input, confirmed the box reappeared with identical geometry and zero console errors;
   separately confirmed both failure paths (no embedded source; corrupted embedded source) each
   throw their own distinct, correctly-worded error.

   **VS Code not wired**, and deliberately excluded from this pass's scope: its "Open" only ever
   triggers VS Code's own generic `workbench.action.files.openFile` command, which has no
   knowledge of ICAD at all — a `.svg` opened this way lands in VS Code's default viewer, not the
   ICAD custom editor. Adding SVG import there needs a new, ICAD-specific VS Code command, not a
   picker-filter tweak — real, separate follow-up work.

   **Found in the process, not previously known:** opening _any_ file through this app — a corrupt
   `.icad` (bad JSON) today, or now a bad SVG — throws uncaught, with **no visible UI feedback** to
   the user; the app just silently stays on the current canvas. Confirmed this is genuinely
   pre-existing (reproduced the identical silent-failure shape for a corrupt `.icad`, not something
   this change introduced) and left it alone rather than building a notification system unprompted
   — but it's a real, user-facing gap worth its own small item: wrap `loadIntoEditor` in a
   try/catch and surface _something_ (a toast, at minimum an `alert`) instead of a silent no-op.

2. **One engine, three surfaces (A6).** Container resize reflows children on canvas drag, but not
   from the Properties panel or MCP `element_update`.
   **Fix:** move `reflowChildren` into the shared command path so all three agree. While there:
   `reflowChildren` only takes `childrenOf` (direct children) — a grandchild can be left outside
   the resized bounds.

   **Shipped:** `updateElementProperties` (the one method both the Properties panel and MCP's
   `element_update` already route through) now reflows direct children on a `w`/`h` change, same
   as `beginResizeInteraction`'s canvas-drag commit. Caught and fixed a real staleness bug of
   exactly I3's own catalogued shape before it shipped: computing the reflow clamp against
   `scene.childrenOf(id)`'s _current_ (pre-dispatch) child position, while a combined x/y+w/h patch
   also queues a real `moveElements` cascade that will shift that same child by `(dx, dy)` once the
   batch actually applies — comparing a pre-move child against a post-move container. Fixed by
   translating each child's coordinates by `(dx, dy)` before handing them to `reflowChildren`.
   Verified the fix actually matters (not just passes against already-correct code) the same way as
   I5: temporarily reverted the translation and confirmed the regression test then fails with the
   exact wrong coordinates the stale read would have produced. 4 new tests in `createEditor.test.ts`
   plus one MCP-level test in `authoring.test.ts` proving `element_update` itself reflows through
   the real tool, not just the underlying editor method. The grandchild gap noted above is
   unchanged — still open, still applies equally to the pre-existing canvas-resize path too, not
   newly introduced by this fix.

**Size:** S each · **Risk:** low

---

### I17 — Real-browser interaction E2E + visual baselines

**Problem:** A13. `apps/web/e2e` is a11y + keyboard only. No test drives a real mouse drag, resize,
rotate, marquee, or connector edit — and the code comments repeatedly note that this is exactly
where the bugs live: _"invisible to jsdom, only surfaced with a real mouse"_ (C14, C15, the
`user-select` fix). I5/A5 is that same class, still live today.

Separately, `svgRenderer.visual.test.ts` asserts attributes, not pixels. For a product whose
central claim is IBM-Design fidelity, there are no screenshot baselines.

**Fix:**

1. Playwright specs for the real gestures: drag, drag-to-reparent, resize with reflow, rotate,
   marquee, connector waypoint drag, endpoint retarget — each asserting the committed scene _and_
   that no transform/focus state is left stranded after abort.
2. Screenshot baselines for the golden fixtures already enumerated in
   `svgRenderer.goldenFixtures.test.ts`, run in the existing `e2e` CI job.

**Acceptance:** I5 would have failed CI before the fix.

**Size:** M · **Risk:** low; screenshot flake is the usual cost — pin the browser and mask the grid.

---

### I18 — Isolate the perf benchmark from parallel load

✅ **Done (M34, 2026-08-07).** Split into `vitest.config.ts` (excludes `src/perf/benchmark.test.ts`)
and a new `vitest.perf.config.ts` (only that file, `fileParallelism: false`, single forked
process), wired to a new `test:perf` script at both the core-package and root level. Added a
dedicated `perf` job to `ci.yml` — its own GitHub Actions runner, not a step inside
`build-and-test`, so it's never sharing a machine with the other five suites. `pnpm -r test` no
longer touches the benchmark at all; confirmed clean on an otherwise-unmodified tree (the exact
"broken signal" scenario this item describes) before making any other change this session, so
every fix after this one could be measured against a suite that was actually telling the truth.
Optional "assert operation counts instead of wall clock" follow-up not done — the isolation alone
already restored the signal; that's a separate, independent hardening step, not required to close
this item.

**Problem:** A14. `pnpm -r test` runs six package suites concurrently; the benchmark measures wall
clock against budgets calibrated on an idle machine. It fails all three sizes on `loadMs` in the
recursive run and passes every one in isolation (2,000 elements: 1325ms isolated vs. 2105ms under
load, against a 1500ms budget).

This is worse than a flake — it's a **broken signal**. A benchmark that fails for reasons unrelated
to the code trains everyone to ignore it, which is exactly backwards for the one test guarding
against I1/I4's O(n²) shapes creeping back.

**Fix:** Give the benchmark its own serialized run rather than loosening the budgets (which would
destroy the signal it exists to provide):

- Move it behind its own script (`test:perf`) excluded from the default `test` run.
- Run it as a separate, serial CI job.
- Optionally assert on operation counts rather than wall clock where a proxy exists — a count is
  load-independent and a stronger regression guard than a timing threshold.

**Acceptance:** `pnpm -r test` is green on an unmodified tree; a genuine O(n) regression in a hot
path still fails `test:perf`.

**Size:** S · **Risk:** low. Worth doing **before** M35/M39, since those are the milestones whose
whole purpose is moving these numbers.

---

## Proposed sequencing

Milestone numbers continue from M33.

| Milestone | Contents                                       | Rationale                                                                                                                                                   |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M34**   | ✅ I13, I14, I5, I16, I18 — shipped 2026-08-07 | Small, high-confidence, safety-and-truth. Shipped in one pass. I18 restored the perf signal before anything else in this milestone was measured against it. |
| **M35**   | I1, I2 (step 1), I10                           | Perf floor + autosave correctness. Unblocks I4.                                                                                                             |
| **M36**   | I7, I8                                         | The ergonomics milestone. The one users will notice.                                                                                                        |
| **M37**   | I17                                            | Lock the gestures down before I3 rewrites what's under them.                                                                                                |
| **M38**   | I3                                             | The command-model refactor, on a green suite, alone.                                                                                                        |
| **M39**   | I4, I6, I2 (step 2)                            | The remaining perf work, on top of the new command model.                                                                                                   |
| **M40+**  | I15, I9, I12, I11 backlog                      | Agent surface and remaining ergonomics.                                                                                                                     |

M37 before M38 is deliberate: I3 changes the machinery under every gesture, and I17 is the only
thing that would catch a regression there.

---

## Open strategic questions

These need a decision, not an implementation. Each would change the plan above.

1. **What is the real target diagram size?** The benchmark tops out at 2,000 elements with an
   800ms `dispatchMs` budget. Is 2,000 validated against IBM's largest reference architectures, or
   is it where the current implementation stopped being embarrassing? The answer decides whether
   I1/I4 are sufficient or whether the renderer needs virtualization too.

2. **Is [D7](./decision-log.md#d7--export-only-interop-svgpng-no-drawio-import--locked) (no
   `.drawio` import) still right?** [Vision & Scope](./vision-and-scope.md) states the sanctioned
   path today _is_ draw.io + the IBM stencil library — so every diagram the target users own is in
   that format, and adoption currently requires redrawing an estate by hand. "Full mxGraph mapping
   is large and fragile" is true, but a one-way importer covering IBM stencil shapes, containers,
   and orthogonal edges — the small subset these diagrams actually use — with everything unmapped
   becoming a Text placeholder plus a lint warning, is a different proposition. If D7 holds, what
   is the adoption path instead?

3. **Is collaboration genuinely deferred, or foreclosed?**
   [D4](./decision-log.md#d4--local-first-single-user-files--locked) says revisit later, but the
   closure-command model makes "later" a core rewrite. I3 keeps the door open at today's ~8k-line
   core. Deferring I3 closes it quietly.

4. **Human-first or agent-first?** Four shells and a full Deep Agents + A2A runtime (M29–M33)
   landed while the canvas still can't edit a label. If human-first, M36 should move ahead of the
   agent backlog. If agent-first, say so explicitly and I15 leads instead.

5. **What is "done" for the [D17](./decision-log.md#d17--official--ibm-internal-tool--locked)
   IBM Design sign-off?** Several decisions are explicitly pending Design confirmation (D24's
   subnet icon, the double-tunnel band's Yellow 30 placeholder, the inferred container presets),
   but there is no checklist, named reviewer, or tracked ask. Without one, "sign-off gates the
   release" keeps the project in preview indefinitely.

6. **Should `reason` be derived rather than declared?** `reparentElement` and `setZOrder` each
   carry multi-paragraph comments explaining why they must report `"replace"` instead of
   `"update"`. That much prose usually means the design isn't expressing the constraint. If the
   change reason were derived from what the command actually touched (containment? z? fields
   only?), the comments — and the bug class behind them — would be unnecessary. Fold into I3.

7. **Do quick-fixes converge?** 25 rules, and no test that `quickfix_apply_all` terminates or that
   one rule's fix can't create another rule's violation. Worth a property test regardless of the
   answer.
