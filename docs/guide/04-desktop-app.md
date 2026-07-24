# The desktop app

`apps/desktop` is a native [Tauri](https://tauri.app) shell around the same `apps/web` build —
there's no separate frontend package to maintain; Tauri just points at `apps/web`'s own dev
server / build output and adds a native window, native file dialogs, and OS-level `.icad` file
associations on top.

## Running it today

There's no signed, downloadable installer yet — build it from source:

```bash
pnpm install
pnpm --filter @icad/desktop dev     # development, with hot reload
# or
pnpm --filter @icad/desktop build   # produces a local, unsigned bundle
```

`build` runs `tauri build`, which on macOS produces a `.app` bundle (DMG packaging is not yet
confirmed working in every environment — see [Limitations](#limitations)); on other platforms it
produces the platform-appropriate bundle formats Tauri supports.

## What's native

Compared to the browser, the desktop build (same `apps/web` source, gated behind a Tauri
detection check) gets:

- **Native `.icad` file associations** — double-clicking a `.icad` file, or "Open With", launches
  or focuses the app and loads it, on macOS, Windows, and Linux.
- **Native Open / Save / Save As dialogs**, via Tauri's file-system and dialog plugins, ahead of
  the browser's File System Access API fallback.
- **Native window theme sync** — the OS window chrome follows your Auto/Light/Dark choice from
  the app's own theme setting, not just the in-canvas colors.
- **Native export saving** — both SVG and PNG export go through a real native Save dialog instead
  of dropping into your Downloads folder.

Everything else — element types, connectors, templates, the linter, file format — is identical to
[the web editor](02-web-editor.md), since it's literally the same build.

## Limitations

This shell is functional but not yet a shippable product:

- **No signed or notarized build.** Every build today is self-built and unsigned; there's no
  distributable installer.
- **`.dmg` packaging is unconfirmed** — only the raw `.app` bundle (`--bundles app`) has been
  verified to build successfully; full DMG packaging needs a real interactive session to test.
- **App identifier and icon are placeholders**, pending a real IBM-issued identifier and IBM
  Design sign-off before any real distribution.
- **File-system permissions are intentionally broad** (`fs:allow-read-text-file` /
  `allow-write-text-file` grant access to any path, since a file-associated editor needs to open
  files anywhere) — flagged as needing a dedicated security review before real distribution.
- Not yet verified in a real interactive session end-to-end (double-click-to-open, native
  Open/Save/Save-As, offline launch) — what's here is confirmed by build/unit tests, not a
  hands-on pass.
