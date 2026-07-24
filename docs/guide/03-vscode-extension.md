# The VS Code extension

`apps/vscode` registers a custom editor for `.icad` files inside VS Code, so you can open and
edit diagrams without leaving your editor. It reuses the same `@icad/core` engine and
`@icad/ui-web` Carbon UI as the web app — same canvas, same Library/Properties/Layers/Validation
panels, same keyboard model.

## Running it today

There's no Marketplace listing and no `.vsix` package yet — this is a source build you run
yourself, from inside a clone of this repo:

```bash
pnpm install
pnpm --filter icad-vscode build
```

Then in VS Code: open the repo, open the Run panel, and launch **"Run ICAD Extension"** (the
`.vscode/launch.json` config that ships with the repo). That opens a second, isolated
**Extension Development Host** window with the extension active. Open any `.icad` file — or
create one — and it opens in the custom editor by default.

## What's different from the web app

Most of [the web editor](02-web-editor.md) works identically inside VS Code. A few things are
necessarily different because VS Code owns the window chrome and file lifecycle:

- **Undo/redo** is wired into VS Code's own undo stack (Ctrl/Cmd+Z routes through VS Code, not a
  separate in-app history), so it composes correctly with VS Code's tab/save UI.
- **Open / Save / Save As** go through VS Code's native file commands, not the File System Access
  API.
- **Crash recovery** uses VS Code's own hot-exit/backup mechanism instead of the web app's
  IndexedDB autosave banner.
- **Theme** follows VS Code's active color theme automatically; there's no manual Auto/Light/Dark
  picker in this shell.
- **Export** only offers **SVG** today. The web app gained a PNG format option later
  ([M11](../09-roadmap.md#m11--appsdesktop-tauri-shell)); the VS Code webview is a separately
  built package and hasn't picked that change up yet.

Everything else — element types, connectors, templates, the linter, find, the command palette —
behaves the same as the [web editor](02-web-editor.md).

## Limitations

- **Dev-only.** No Marketplace listing, no `.vsix` build step in this repo yet — running it means
  building from source and launching the Extension Development Host.
- **No PNG export** in this shell (SVG only).
- **No manual theme toggle** — it always follows VS Code's theme.
- Not yet verified in a real interactive VS Code session end-to-end (open-by-double-click,
  edit, undo, save, simulated-crash recovery) — what's here is confirmed by build/unit tests, not
  a hands-on pass.
