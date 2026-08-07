# Accessibility

Accessibility is a first-class v1 requirement, not a retrofit ([D19](../../../docs/decision-log.md#d19--full-ibm-equal-access--wcag-21-aa--locked)). Target: **IBM Equal
Access / WCAG 2.1 AA**. The hard part of a diagram editor is making a **canvas** accessible; we
plan for it from the start.

## Standards

- [IBM Equal Access Toolkit](https://www.ibm.com/able/toolkit/) as the working checklist.
- [WCAG 2.1 AA](https://www.w3.org/TR/WCAG21/) as the conformance bar.
- Carbon components give us accessible chrome (menus, dialogs, panels, forms) by default ([D18](../../../docs/decision-log.md#d18--carbon-design-system--ibm-plex-for-app-chrome--locked)).

## Chrome (the easy 80%)

- Carbon's accessible primitives for all menus, toolbars, dialogs, and the properties/validation
  panels.
- Visible focus rings, logical tab order, ESC/close semantics, ARIA roles from Carbon.
- IBM Plex + contrast tokens meet AA in light and dark.

## Canvas (the hard 20%)

The SVG DOM choice ([D3](../../../docs/decision-log.md#d3--svg-dom-rendering--locked)) pays off here: elements are real DOM nodes we can annotate,
focus, and expose to assistive tech.

- **Keyboard operation of everything.** Create, select, move, resize, connect, label, group, and
  delete — all reachable without a pointer. Arrow keys nudge; Tab/Shift+Tab walk elements in a
  meaningful order (containers then children, west→east).
- **An accessible object tree.** In parallel with the visual canvas, maintain an ARIA-annotated
  structure so a screen reader can navigate the diagram as a list/tree of elements with roles,
  names, and relationships ("VPC box, contains 3 elements; connector from API Gateway to VSI").
- **Named elements.** Every icon has an accessible name from the [catalog](../../catalog-build/docs/icon-catalog.md);
  boxes/groups/zones/actors use their labels; connectors announce endpoints + type.
- **Selection & focus.** A single roving focus model shared by keyboard and pointer; focus is
  always visible and announced.
- **Live regions.** Announce meaningful changes (element added, connected, validation fixed).

## Connectors & relationships

Because connectors bind to ports and carry semantic type, screen-reader output can be relational,
not just geometric: "Actor _Customer_ connects to _API Gateway_ (request flow)."

## Color & contrast

- Never rely on color alone: box vs. group distinguished by **border style** (solid/dashed), not
  just hue; validation severity uses icon + text, not only color.
- IBM color tokens are chosen/verified for AA contrast in both themes.

## The linter serves a11y too

Some [linter](./ibm-spec-conformance.md) rules double as accessibility guards — e.g. **missing
label** is both a spec violation and an accessible-name gap. Fixing spec issues improves SR output.

## Testing & CI

- **Automated:** axe-core / IBM Equal Access checker on the web shell in CI; fail the build on new
  violations.
- **Keyboard E2E:** Playwright flows that build and edit a diagram using only the keyboard.
- **Manual:** periodic screen-reader passes (VoiceOver / NVDA) on core flows.
- **Design sign-off:** IBM Design + accessibility review gates releases ([D17](../../../docs/decision-log.md#d17--official--ibm-internal-tool--locked)).

## Scope note

Full canvas a11y is real, budgeted work and lands **incrementally within v1** — chrome and
keyboard operation first, then the screen-reader object tree and live regions, all before GA.

## Manual screen-reader script (VoiceOver / NVDA)

CI (axe-core, keyboard E2E) catches structural violations and verifies every action is
keyboard-reachable, but it can't judge whether the _spoken result_ actually makes sense to a
screen-reader user — phrasing, timing, double-announcements, or a stale name. That judgment needs
a human at a real screen reader. Run this on **VoiceOver** (macOS: Cmd+F5) or **NVDA** (Windows,
free) before a release; ~20 minutes.

**What to listen for at every step**, beyond "did it do the right thing":

- The name spoken is current and correct — never a stale label, an internal ID, or literally the
  word "unknown".
- A live-region announcement fires once, is timely (not delayed past your next action), and
  doesn't collide with or repeat another announcement.
- Nothing is announced as a `button`/`group`/etc. with no accessible name.
- Verbosity is reasonable — a container announces its child count once, not per keystroke.

**Script** (start a Blank diagram):

1. **Insert a container** (Insert menu → Box). Confirm it's announced added and focus lands on it
   (not left in the menu).
2. **Place a catalog icon two ways**: click one in the Library panel, then arm and click a canvas
   point (mouse flow) — _and separately_ Tab to a different icon button and press Enter/Space
   (keyboard flow, no mouse). Both must place the icon and announce it; the keyboard path must not
   require a follow-up click to complete.
3. **Tab across the canvas.** Confirm the order is sensible (containers before children, west→east,
   connectors last) and each stop's name is meaningful on its own, without seeing the screen.
4. **Connect two elements by keyboard**: focus one, press `c`, Tab to a target, Enter. Confirm the
   "Connecting from X — Tab to a target..." prompt is spoken, and the result is announced as
   "Connected A to B", not just a geometry description.
5. **Build a multi-selection** (Enter, then Tab + Shift+Enter to a second element) and group it
   (Ctrl/Cmd+G). Confirm "Grouped N elements" and that the container's spoken name updates to
   reflect its new child count.
6. **Ungroup, delete, undo.** Confirm each is announced, and — this is the one jsdom/axe cannot
   check — that deleting a container never leaves a connector behind whose endpoints don't
   resolve (it would read as something like "unknown element to unknown element"; there should be
   nothing at all instead).
7. **Find on canvas** (Ctrl/Cmd+F) and the **Command palette** (Ctrl/Cmd+K): confirm typing filters
   audibly sane results, arrow-key navigation is announced per item, and closing either returns
   focus exactly where it was.
8. **Frames + Present mode**: jump to a frame from the Frames tab, enter Present, step with
   arrow/PageUp/PageDown, confirm each frame's name is announced on entry.
9. **Validation panel**: trigger a rule (e.g. leave an element unlabeled), confirm the panel
   announces the new count and each finding reads as a complete sentence a non-visual user could
   act on, not just a rule ID.
10. **Export dialog**: confirm the compliance summary and format options are all announced with
    working labels.

File anything that fails this as a normal bug — the accessible name, role, or live-region wiring is
almost always a small, local fix (see `accessibleName()` in `packages/core/src/scene/accessibleName.ts`
and the `announce()` calls in `apps/web/src/App.tsx`), not a redesign.

**Known, accepted gap, not a blocker:** Undo/Redo (Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z) has no live-region
announcement — the canvas updates silently. Every other mutating action announces; this one was
never in scope per M8.2's committed list (insert/delete/connect/group/ungroup/quick-fix). Worth a
follow-up if the manual pass finds it disorienting in practice, but it shouldn't block sign-off on
its own.
