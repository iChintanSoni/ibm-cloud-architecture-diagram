# Editor UX

How the web shell looks and behaves. The chrome is Carbon + IBM Plex ([D18](00-decision-log.md#d18--carbon-design-system--ibm-plex-for-app-chrome--locked)); the canvas is the
custom SVG engine ([D3](00-decision-log.md#d3--svg-dom-rendering--locked)). Everything here is keyboard-operable and AA-accessible
([Accessibility](07-accessibility.md)).

## Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  Menu · File  Edit  View  Insert  Help    [Find] [⌘K] [Theme] [Export] │  Top bar (Carbon)
├──────────┬───────────────────────────────────────────────┬────────────┤
│ Library  │                                               │ Properties │
│ (icons)  │                   CANVAS                       │  Layers    │
│  search  │              (SVG, pan/zoom)                  │  Frames    │
│  ├ Groups│                                               │  Validation│
│  ├ Compute│                                              │            │
│  ├ Network│                                              │            │
│  └ …     │                                               │            │
└──────────┴───────────────────────────────────────────────┴────────────┘
```

- **Left — Library panel:** searchable IBM catalog, grouped by category
  ([Icon Catalog](04-icon-catalog.md)). Click an icon to arm it, then click the canvas to place
  it — there's no drag-and-drop from the panel today.
- **Center — Canvas:** SVG viewport with pan (scroll, or Space+drag/middle-click-drag, M17.1) and
  zoom (Ctrl/Cmd+scroll, or the View menu zoom commands). A toggleable background grid (View >
  Show/Hide grid, M17.2) — no rulers yet.
- **Right — Inspector:** four tabs — Properties (the selection), Layers (the containment tree),
  Frames (presentation order), and Validation (the [linter](05-ibm-spec-conformance.md)
  diagnostics).
- **No separate toolbar.** Every insert action lives in the Insert menu or the Library panel.

## Core interactions

- **Placing icons:** click an icon in the Library panel to arm it, then click the canvas — or
  press Enter/Space on a focused icon to place it at the viewport center. Placing inside a
  box/group/zone sets containment (`parentId`) automatically.
- **Containers:** insert a Box (solid, `deployedOn`) or Group (dashed, `deployedTo`) from the
  Insert menu or Library panel; child elements move with the container. Convert types via the
  linter quick-fix or Properties.
- **Connectors:** hover a shape to reveal ports; drag port→port to connect, or focus a source,
  press `c`, Tab to a target, and press Enter. Orthogonal auto-routing with obstacle avoidance;
  there's no gesture for manually editing a connector's waypoints yet. Pick the IBM connector type
  in Properties.
- **Selection:** click, shift-click, keyboard Enter/Shift+Enter, drag a marquee over empty canvas
  or a Frame's background (fully-enclosed elements only; Shift adds to the existing selection), or
  Ctrl/Cmd+A to select everything. A click always lands on the deepest element at that point;
  Alt+click cycles through every other element sharing it (repeated Alt+clicks at the same spot
  step deeper, wrapping back to the top), replacing the selection outright rather than extending
  it. No align/distribute/z-order commands yet.
- **Drilling into a container:** double-click a Box/Zone/Group that has children (or press Enter a
  second time on an already-selected one) to drill into it — its own bounding box, and every
  container above it, render a faint outline alongside the active selection (IBM's own prescribed
  "both bounding boxes visible" model). While drilled in, a press-drag on that container's own
  background rubber-bands its contents instead of moving it. Escape steps back out one level.
- **Snapping:** connector ports, plus grid/sibling-edge snapping live during a drag-to-move (M16.1),
  with alignment guide lines and a live position readout drawn during the drag (M17.2). A dragged
  child's parent grows to fit rather than clamping the drag itself (M17.4). Resize clamps to the
  parent's 16px inset and shows a live W×H readout (M17.3), but
  doesn't snap to the grid or siblings yet.
- **Clipboard:** Ctrl/Cmd+C/X/V/D copy/cut/paste/duplicate — a container brings its contents along
  (and any connector between two copied elements), Ctrl/Cmd+V pastes under the pointer if it's been
  over the canvas or cascades a small offset otherwise, and duplicate never disturbs a pending
  copy. Alt-drag an element to drop a moving clone and leave the original in place. Session-only —
  not the OS clipboard, so paste doesn't cross windows/tabs.
- **Right-click context menu**, contextual to the hit target (the Menu key or Shift+F10 opens the
  same menu at whatever's focused/selected): Cut/Copy/Paste/Duplicate/Delete/Group/Ungroup/Select
  All. Right-clicking an unselected element selects it first; a member of an existing
  multi-selection is left alone so the menu acts on the whole group; empty canvas or a Frame's
  background clears the selection instead. Paste lands exactly where you right-clicked.
- **Undo/redo:** unlimited within a session, backed by the command bus.

## Nesting & spacing

- A newly created Group (from grouping a multi-selection) is sized to fit its contents plus a
  **16px pad** on every side. Dragging a child keeps that same buffer too, but by growing the
  parent to fit rather than stopping the child at a wall (M17.4) — resizing a child, instead, is
  hard-clamped to the parent's existing inset (M17.3).
- Alternate white and light-tint fills between nesting levels (parent vs. child container) for
  readability, using the category's secondary color ([Spec Conformance → Color usage](05-ibm-spec-conformance.md#color-usage)).
- **Resizing:** drag any of a selected element's 8 handles (Shift for aspect lock on a corner
  handle, Alt to resize from center), or type exact W/H (and X/Y) into the Properties tab. Clamped
  to the resized element's own parent's 16px inset (M17.3) — grid/sibling snapping isn't wired into
  resize yet, only the buffer. Shrinking a container repositions (never resizes) any direct children
  that no longer keep their own 16px buffer inside it (M17.5).

Source: _IBM_IT Architecture diagrams kit_ v1.1, "Prescribed location / Scaling elements" slide.

## Themes

Auto / light / dark ([D14 theme](00-decision-log.md#d14--ibm-level-templates--frames--locked)). "Auto" follows the OS. Carbon supplies chrome tokens;
the canvas maps IBM color tokens per theme so icons and boundaries stay on-brand and meet contrast
in both modes.

## Find on canvas (⌘F)

Search across element labels, icon names, and **frame names**. Results highlight and the viewport
jumps to each match — including jumping directly to a section frame, the way Excalidraw's frame
search works.

## Frames, sections & presentation

- **Frames** ([D14](00-decision-log.md#d14--ibm-level-templates--frames--locked)) bound a region and give it a name + order.
- Use them to split a large diagram into sections, drive **Find**, and run a lightweight
  **presentation mode** that steps frame-to-frame (useful in reviews).

## Templates

New-diagram dialog offers the IBM diagram levels plus blank:

- **System context** — actors, external systems, the solution boundary.
- **High-level / logical** — zones, boxes, groups, key services, main flows (west→east seeded).
- **Detailed / deployment** — subnets, security groups, instances, concrete connectors.
- **Blank** — empty canvas with the library ready.

Templates encode the conventions so a newcomer starts on-spec.

## Persistence & recovery

- **Open/Save/Save As** via the File System Access API on Chromium; **download/upload** fallback on
  Safari/Firefox ([D9](00-decision-log.md#d9--file-system-access-api--fallback--locked)).
- **Autosave draft** to IndexedDB, debounced ~800ms after every change; on reload after a crash,
  offer **Restore** ([D10](00-decision-log.md#d10--autosave-draft--crash-recovery--locked)).
- ⌘S writes the `.icad` file.

## Export

From the Export menu ([File Format → Export](03-file-format.md#export)):

- **SVG** (canonical): transparent bg, embedded fonts, spec colors, always embeds a re-editable
  copy of the `.icad` source. The `core/io` export API accepts an `embedSource: false` option, but
  no UI surface currently exposes it as a toggle.
- **PNG**: 1×/2×/3×, transparent or white.
- The dialog shows a **compliance summary** from the linter; the export gate (warn/block) applies.
- No clipboard-copy option exists yet — exports save to disk.

## Keyboard-first

Every tool, panel, and command has a shortcut, plus a **command palette** (⌘/Ctrl+K) to run any
action by name. Full keyboard operation of the canvas is a hard requirement, not a convenience —
see [Accessibility](07-accessibility.md).
