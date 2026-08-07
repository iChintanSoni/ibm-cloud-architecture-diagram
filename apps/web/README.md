# @icad/web

The web shell: a Vite app that mounts [`@icad/core`](../../packages/core) and
[`@icad/ui-web`](../../packages/ui-web) and adds the browser-specific pieces — File System Access
Open/Save/Save-As with a download/upload fallback
([D9](../../docs/decision-log.md#d9--file-system-access-api--fallback--locked)) and IndexedDB
autosave with crash recovery
([D10](../../docs/decision-log.md#d10--autosave-draft--crash-recovery--locked)).

This is the reference surface — the one the other three shells are compared against.

## Docs

- [The web editor](./docs/web-editor.md) — every element, interaction, panel, and menu, plus the
  current **Limitations**
- [Getting started](../../docs/guide/getting-started.md) — install, run, first diagram

## Running it

```bash
pnpm --filter @icad/core build     # required first
pnpm --filter @icad/web dev        # http://localhost:5173
```

## Testing

```bash
pnpm --filter @icad/web test                                   # unit (jsdom)
pnpm --filter @icad/web exec playwright install --with-deps chromium
pnpm --filter @icad/web test:e2e                               # real-browser a11y + keyboard
```

`e2e/` covers accessibility (axe-core) and keyboard traversal in a real browser — the
layout-dependent and focus-dependent checks jsdom can't evaluate. Real-mouse gesture coverage is
still an open gap ([I17](../../docs/improvement-plan.md#i17--real-browser-interaction-e2e--visual-baselines)).

## Layout

```
src/
  App.tsx           the shell: wiring, dialogs, canvas modes, keyboard
  catalog.ts        loads the bundled IBM catalog and injects it into core
  placement.ts      library-click → element placement
  persistence/      File System Access, IndexedDB autosave, Tauri bridge, preferences
```
