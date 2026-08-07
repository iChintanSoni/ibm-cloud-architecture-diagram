# @icad/ui-web

The React app chrome shared by the web and VS Code shells: Carbon Design System + IBM Plex
([D18](../../docs/decision-log.md#d18--carbon-design-system--ibm-plex-for-app-chrome--locked)).

Panels and surfaces only — **no engine logic**. Every mutation goes through `@icad/core`'s public
`Editor` API so undo, autosave, and the MCP surface all share one path.

## What's here

| Surface                                    | Notes                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| `LibraryPanel`                             | Searchable IBM icon catalog + container/element placement |
| `InspectorPanel`                           | Properties / Layers / Validation tabs                     |
| `TopBar`                                   | File, edit, view, export, theme                           |
| `CommandPalette`, `FindBar`, `ContextMenu` | Keyboard-first surfaces                                   |
| `NewDiagramDialog`                         | Template chooser                                          |
| `LiveRegion`                               | Screen-reader announcements                               |

Each panel is paired with a headless `*Model.ts` (`libraryModel`, `inspectorModel`, `findModel`,
`commandPaletteModel`) holding its logic, so behaviour is unit-tested without rendering.

## Related docs

- [Editor UX](../core/docs/editor-ux.md) — the interaction model these panels sit around
- [Accessibility](../core/docs/accessibility.md) — the AA requirements this chrome must meet
- [Architecture](../../docs/architecture.md) — where this sits relative to core and the shells

## Development

```bash
pnpm --filter @icad/core build     # required first
pnpm --filter @icad/ui-web test
```
