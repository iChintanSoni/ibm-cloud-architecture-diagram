# Editor UX

How the web shell looks and behaves. The chrome is Carbon + IBM Plex ([D18](00-decision-log.md#d18--carbon-design-system--ibm-plex-for-app-chrome--locked)); the canvas is the
custom SVG engine ([D3](00-decision-log.md#d3--svg-dom-rendering--locked)). Everything here is keyboard-operable and AA-accessible
([Accessibility](07-accessibility.md)).

## Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  Menu · File  Edit  View  Insert  Help          [Theme ☾]  [Export ▾]  │  Top bar (Carbon)
├──────────┬───────────────────────────────────────────────┬────────────┤
│ Library  │                                               │ Properties │
│ (icons)  │                   CANVAS                       │  + Layers  │
│  search  │           (SVG, pan/zoom, grid)               │            │
│  ├ Groups│                                               │  Validation│
│  ├ Compute│                                              │  panel     │
│  ├ Network│                                              │            │
│  └ …     │                                               │            │
├──────────┴───────────────────────────────────────────────┴────────────┤
│ Toolbar: select · box · group · boundary · icon · connector · text · frame │ Bottom/side tools
│  Zoom 100%  ·  Frames ▸  ·  Find (⌘F)  ·  Validation ▸                   │
└───────────────────────────────────────────────────────────────────────┘
```

- **Left — Library panel:** searchable IBM catalog, grouped by category/tier exactly like draw.io
  ([Icon Catalog](04-icon-catalog.md)). Drag onto canvas or click-to-place.
- **Center — Canvas:** SVG viewport with pan (space-drag / scroll), zoom, snap grid, rulers.
- **Right — Properties / Layers / Validation:** context panel for the selection, a layer/tree
  view, and the [linter](05-ibm-spec-conformance.md) diagnostics.
- **Toolbar:** the semantic tools (box, group, boundary, icon, connector, actor, text, frame).

## Core interactions

- **Placing icons:** drag from library or click the icon tool then click canvas; icons land at
  spec size (48×48 container). Dropping inside a box/group sets containment automatically.
- **Containers:** draw a Box (solid, `deployedOn`) or Group (dashed, `deployedTo`); child elements
  move with the container. Convert types via the linter quick-fix or Properties.
- **Connectors:** hover a shape to reveal ports; drag port→port to connect. Orthogonal
  auto-routing with obstacle avoidance; grab a segment to add a manual waypoint. Pick the IBM
  connector type in Properties.
- **Selection:** click, shift-click, marquee, ⌘/Ctrl+A. Group/ungroup, align, distribute, z-order.
- **Snapping:** grid + smart guides (edges/centers) + ports.
- **Undo/redo:** unlimited within a session, backed by the command bus.

## Nesting & spacing

- Nested elements keep a **16px buffer** on every side from their parent container's edge — the
  engine enforces this as a snap/pad default when dropping into a Box/Group/Boundary, not just a
  visual guideline.
- Alternate white and light-tint fills between nesting levels (parent vs. child container) for
  readability, using the category's secondary color ([Spec Conformance → Color usage](05-ibm-spec-conformance.md#color-usage)).
- Resizing a container drags from its corner handle; children reflow to keep the 16px buffer.

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
- **Autosave draft** to OPFS continuously; on reload after a crash, offer **Restore** ([D10](00-decision-log.md#d10--autosave-draft--crash-recovery--locked)).
- The title bar shows dirty state; ⌘S writes the `.icad` file and clears it.

## Export

From the Export menu ([File Format → Export](03-file-format.md#export)):

- **SVG** (canonical): transparent bg, embedded fonts, spec colors, **re-editable embedded
  `.icad`** by default (toggle off for public assets).
- **PNG**: 1×/2×/3×, transparent or white.
- **Copy to clipboard** (PNG/SVG) for quick paste into decks/docs/tickets.
- The dialog shows a **compliance summary** from the linter; the export gate (warn/block) applies.

## Keyboard-first

Every tool, panel, and command has a shortcut, plus a **command palette** (⌘/Ctrl+K) to run any
action by name. Full keyboard operation of the canvas is a hard requirement, not a convenience —
see [Accessibility](07-accessibility.md).
