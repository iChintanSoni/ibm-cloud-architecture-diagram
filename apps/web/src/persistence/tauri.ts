/**
 * Native Open/Save/Save-As + file-association open handling for the Tauri
 * desktop shell (M11), layered on top of — not replacing — D9's File System
 * Access API path and D10's autosave/recovery (D22): `apps/web` stays the one
 * frontend for both web and desktop, and every export here is feature-detected
 * behind `isTauri()` and dynamically imported so a plain browser build never
 * touches `@tauri-apps/*`.
 */

/** Mirrors `@tauri-apps/api/core`'s own `isTauri()` check, kept synchronous. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenedNativeFile {
  path: string;
  text: string;
}

const ICAD_FILTER = [{ name: "ICAD diagram", extensions: ["icad"] }];

/** The explicit native Open dialog additionally accepts a `.icad`-exported SVG (I16,
 * docs/improvement-plan.md#i16--honour-or-retract-the-shipped-claims) — Save, and the
 * OS-file-association paths below (`consumeStartupFile`/`onNativeFileOpen`, which only ever fire
 * for a `.icad` double-click/"Open With", never an SVG), stay on {@link ICAD_FILTER} unchanged. */
const OPEN_FILTER = [
  ...ICAD_FILTER,
  { name: "ICAD-exported SVG", extensions: ["svg"] },
];

/** Prompts a native Open dialog. Null means the user canceled. */
export async function openIcadFileNative(): Promise<OpenedNativeFile | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({ multiple: false, filters: OPEN_FILTER });
  if (!path || Array.isArray(path)) return null;
  return { path, text: await readTextFile(path) };
}

/**
 * Writes `content` to `path` (silent overwrite) or, if `path` is null, prompts
 * a native Save-As dialog first. Returns the path now holding the content
 * (reuse it for the next silent Save), or null if the user canceled.
 */
export async function saveIcadFileNative(
  content: string,
  path: string | null,
  suggestedName: string,
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");

  let target = path;
  if (!target) {
    target = await save({ defaultPath: suggestedName, filters: ICAD_FILTER });
    if (!target) return null;
  }

  await writeTextFile(target, content);
  return target;
}

/**
 * Reads the `.icad` path this process launched with via OS file association
 * (double-click/"Open With"), if any — see `get_startup_file` in
 * `src-tauri/src/lib.rs`. Resolves to null on every call after the first, since
 * the host consumes it once.
 */
export async function consumeStartupFile(): Promise<OpenedNativeFile | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke<string | null>("get_startup_file");
  if (!path) return null;
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return { path, text: await readTextFile(path) };
}

/**
 * Subscribes to `.icad` paths opened while this process is already running: a
 * second launch caught by the single-instance plugin, or (on macOS) an "Open
 * With" request delivered after startup. Returns an unsubscribe function.
 */
export async function onNativeFileOpen(
  handler: (file: OpenedNativeFile) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  return listen<string>("icad://open-file", async (event) => {
    const path = event.payload;
    handler({ path, text: await readTextFile(path) });
  });
}

/**
 * Syncs the native window chrome (titlebar) to the app's resolved theme
 * (M7.4's persisted auto/light/dark preference), rather than leaving it at
 * whatever `tauri.conf.json` set once at launch. `null` means "auto": follow
 * the OS live, the same as an unset window `theme` config, but settable at
 * runtime so switching back to "auto" after an explicit choice un-forces it.
 */
export async function setNativeTheme(
  theme: "light" | "dark" | null,
): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTheme(theme);
}

/**
 * Prompts a native Save dialog for an exported SVG/PNG and writes it directly
 * to disk, rather than the browser download-to-Downloads-folder fallback
 * `downloadBlob` uses. Returns the chosen path, or null if the user canceled.
 */
export async function saveExportNative(
  blob: Blob,
  suggestedName: string,
  filters: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const path = await save({ defaultPath: suggestedName, filters });
  if (!path) return null;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return path;
}
