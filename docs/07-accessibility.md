# Accessibility

Accessibility is a first-class v1 requirement, not a retrofit ([D19](00-decision-log.md#d19--full-ibm-equal-access--wcag-21-aa--locked)). Target: **IBM Equal
Access / WCAG 2.1 AA**. The hard part of a diagram editor is making a **canvas** accessible; we
plan for it from the start.

## Standards

- [IBM Equal Access Toolkit](https://www.ibm.com/able/toolkit/) as the working checklist.
- [WCAG 2.1 AA](https://www.w3.org/TR/WCAG21/) as the conformance bar.
- Carbon components give us accessible chrome (menus, dialogs, panels, forms) by default ([D18](00-decision-log.md#d18--carbon-design-system--ibm-plex-for-app-chrome--locked)).

## Chrome (the easy 80%)

- Carbon's accessible primitives for all menus, toolbars, dialogs, and the properties/validation
  panels.
- Visible focus rings, logical tab order, ESC/close semantics, ARIA roles from Carbon.
- IBM Plex + contrast tokens meet AA in light and dark.

## Canvas (the hard 20%)

The SVG DOM choice ([D3](00-decision-log.md#d3--svg-dom-rendering--locked)) pays off here: elements are real DOM nodes we can annotate,
focus, and expose to assistive tech.

- **Keyboard operation of everything.** Create, select, move, resize, connect, label, group, and
  delete — all reachable without a pointer. Arrow keys nudge; Tab/Shift+Tab walk elements in a
  meaningful order (containers then children, west→east).
- **An accessible object tree.** In parallel with the visual canvas, maintain an ARIA-annotated
  structure so a screen reader can navigate the diagram as a list/tree of elements with roles,
  names, and relationships ("VPC box, contains 3 elements; connector from API Gateway to VSI").
- **Named elements.** Every icon has an accessible name from the [catalog](04-icon-catalog.md);
  boxes/groups/zones/actors use their labels; connectors announce endpoints + type.
- **Selection & focus.** A single roving focus model shared by keyboard and pointer; focus is
  always visible and announced.
- **Live regions.** Announce meaningful changes (element added, connected, validation fixed).

## Connectors & relationships

Because connectors bind to ports and carry semantic type, screen-reader output can be relational,
not just geometric: "Actor *Customer* connects to *API Gateway* (request flow)."

## Color & contrast

- Never rely on color alone: box vs. group distinguished by **border style** (solid/dashed), not
  just hue; validation severity uses icon + text, not only color.
- IBM color tokens are chosen/verified for AA contrast in both themes.

## The linter serves a11y too

Some [linter](05-ibm-spec-conformance.md) rules double as accessibility guards — e.g. **missing
label** is both a spec violation and an accessible-name gap. Fixing spec issues improves SR output.

## Testing & CI

- **Automated:** axe-core / IBM Equal Access checker on the web shell in CI; fail the build on new
  violations.
- **Keyboard E2E:** Playwright flows that build and edit a diagram using only the keyboard.
- **Manual:** periodic screen-reader passes (VoiceOver / NVDA) on core flows.
- **Design sign-off:** IBM Design + accessibility review gates releases ([D17](00-decision-log.md#d17--official--ibm-internal-tool--locked)).

## Scope note

Full canvas a11y is real, budgeted work and lands **incrementally within v1** — chrome and
keyboard operation first, then the screen-reader object tree and live regions, all before GA.
