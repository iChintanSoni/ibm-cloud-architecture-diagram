# @icad/core

The ICAD engine: the scene model, the command bus, the SVG renderer, the orthogonal connector
router, the interaction state machine, the conformance linter, and `.icad` I/O — all in
framework-agnostic TypeScript with **no UI-framework dependency**
([D2](../../docs/decision-log.md#d2--framework-agnostic-typescript-core--thin-shells--locked)).

This package is the product. `apps/web`, `apps/vscode`, `apps/desktop`, and `packages/mcp` are
shells that mount it — a capability added here reaches all four at once.

## Design docs

| Doc                                                    | What's inside                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [File format](./docs/file-format.md)                   | The `.icad` schema, versioning, the migration registry, and the load-time repair pass  |
| [IBM spec conformance](./docs/ibm-spec-conformance.md) | The IBM semantics the engine encodes: element meanings, connector nomenclature, layout |
| [Editor UX](./docs/editor-ux.md)                       | The interaction model — gestures, modes, keyboard, selection, drill                    |
| [Accessibility](./docs/accessibility.md)               | WCAG 2.1 AA on the canvas itself: roles, the `aria-owns` object tree, roving tabindex  |
| [Canvas parity plan](./docs/canvas-parity-plan.md)     | The M14–M20 audit against draw.io/Excalidraw and its numbered findings (C1–C15)        |

Cross-cutting context lives at the repo root: [Architecture](../../docs/architecture.md),
[Decision log](../../docs/decision-log.md), [Roadmap](../../docs/roadmap.md),
[Improvement plan](../../docs/improvement-plan.md).

## Layout

```
src/
  scene/         document model, elements, containment, bounds, z-order, align/distribute
  commands/      command bus + every mutation (undo/redo)
  render/        SVG DOM renderer, viewport, text metrics, ports
  interaction/   hit-testing, selection, snapping, resize, tab order, canvas controller
  routing/       port picking + grid-based orthogonal (Manhattan) router
  linter/        conformance rules + quick-fixes
  io/            .icad read/write/migrate/repair, SVG + PNG export
  catalog/       runtime API over the bundled icon catalog (injected, never imported)
  templates/     IBM diagram levels + reference architectures
  api/           createEditor — the public imperative surface used by every shell
```

The catalog is **injected** by the shell, never imported here — core has no build-time dependency
on `packages/catalog`.

## Development

```bash
pnpm --filter @icad/core build
pnpm --filter @icad/core test
pnpm --filter @icad/core typecheck
```

Other workspace packages typecheck against this package's built `dist/`, so build it before
running checks elsewhere.
