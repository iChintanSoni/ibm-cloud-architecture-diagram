# @icad/desktop

The native desktop shell: a [Tauri](https://tauri.app) wrapper around the same web build, so
macOS/Windows/Linux get real native file dialogs and OS file associations for `.icad` while
reusing `apps/web`'s File System Access + autosave layer rather than reimplementing it
([D22](../../docs/decision-log.md#d22--desktop-shell-reuses-webs-file-system-access--autosave-layer-unlike-vs-code--locked-v3)).

> **Preview build.** Installers published from CI are unsigned and un-notarized — expect
> Gatekeeper (macOS) / SmartScreen (Windows) warnings. Not the IBM-Design-sign-off-gated release
> ([D17](../../docs/decision-log.md#d17--official--ibm-internal-tool--locked)).

## Docs

- [The desktop app](./docs/desktop-app.md) — what's native, how to build it, current
  **Limitations**

## Running it

```bash
pnpm --filter @icad/core build
pnpm --filter @icad/desktop dev     # native shell in dev mode
```

Requires the Rust toolchain and Tauri's platform prerequisites — see the Tauri docs for your OS.

## Layout

```
src-tauri/
  src/            Rust entrypoint, file-association and window handling
  capabilities/   Tauri permission scopes (fs write, dialog, ...)
  icons/          app icons per platform
scripts/          build/packaging helpers
```
