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
- **Center — Canvas:** SVG viewport with pan (scroll) and zoom (Ctrl/Cmd+scroll, or the View menu
  zoom commands). No visible grid and no rulers.
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
- **Selection:** click, shift-click, or keyboard Enter/Shift+Enter. No marquee selection, no
  Ctrl/Cmd+select-all, and no align/distribute/z-order commands yet.
- **Snapping:** connector ports only — no grid or alignment-guide snapping.
- **Undo/redo:** unlimited within a session, backed by the command bus.

## Nesting & spacing

- A newly created Group (from grouping a multi-selection) is sized to fit its contents plus a
  **16px pad** on every side — that's the one place the 16px buffer is actively applied today,
  not a general snap/pad rule enforced on every container edit.
- Alternate white and light-tint fills between nesting levels (parent vs. child container) for
  readability, using the category's secondary color ([Spec Conformance → Color usage](05-ibm-spec-conformance.md#color-usage)).
- There's no drag-to-resize yet — width and height are set via typed W/H fields in the Properties
  tab, and resizing a container doesn't reflow its children.

Source: *IBM_IT Architecture diagrams kit* v1.1, "Prescribed location / Scaling elements" slide.

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
