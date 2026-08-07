# The VS Code extension

`apps/vscode` registers a custom editor for `.icad` files inside VS Code, so you can open and
edit diagrams without leaving your editor. It reuses the same `@icad/core` engine and
`@icad/ui-web` Carbon UI as the web app — same canvas, same Library/Properties/Layers/Validation
panels, same keyboard model.

## Running it today

There's no Marketplace listing yet, but a preview `.vsix` is published to the [GitHub Releases
page](https://github.com/iChintanSoni/ibm-cloud-architecture-diagram/releases) on tagged pushes
(unsigned, see the root README's positioning note) — download it and, in VS Code, use the
Extensions view's `...` menu → **Install from VSIX...**.

To build from source instead:

```bash
pnpm install
pnpm --filter icad-vscode build
```

Then in VS Code: open the repo, open the Run panel, and launch **"Run ICAD Extension"** (the
`.vscode/launch.json` config that ships with the repo). That opens a second, isolated
**Extension Development Host** window with the extension active. Open any `.icad` file — or
create one — and it opens in the custom editor by default.

## What's different from the web app

Most of [the web editor](../../web/docs/web-editor.md) works identically inside VS Code. A few things are
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
  ([M11](../../../docs/roadmap.md#m11--appsdesktop-tauri-shell)); the VS Code webview is a separately
  built package and hasn't picked that change up yet.

Everything else — element types, connectors, templates, the linter, find, the command palette —
behaves the same as the [web editor](../../web/docs/web-editor.md).

## Limitations

- **No Marketplace listing** — install via the downloadable `.vsix` (unsigned preview build) or
  build from source.
- **No PNG export** in this shell (SVG only).
- **No manual theme toggle** — it always follows VS Code's theme.
- Verified in a real interactive VS Code session that installing the packaged `.vsix` and opening
  a `.icad` file loads the custom diagram editor correctly. The rest of the end-to-end flow
  (edit, undo, save, simulated-crash recovery) is still only confirmed by build/unit tests, not a
  hands-on pass.
