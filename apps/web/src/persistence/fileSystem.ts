/**
 * Real Open/Save/Save-As via the File System Access API, with a fallback to
 * download/upload on browsers that don't support it (D9).
 */

const ICAD_PICKER_TYPES: FilePickerAcceptType[] = [
  { description: "ICAD diagram", accept: { "application/json": [".icad"] } },
];

/** Open additionally accepts a `.icad`-exported SVG (I16, docs/improvement-plan.md#i16--honour-or-retract-the-shipped-claims)
 * — Save never targets one, so this stays separate from {@link ICAD_PICKER_TYPES} rather than
 * widening it for both directions. */
const OPEN_PICKER_TYPES: FilePickerAcceptType[] = [
  ...ICAD_PICKER_TYPES,
  {
    description: "ICAD-exported SVG",
    accept: { "image/svg+xml": [".svg"] },
  },
];

export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showOpenFilePicker === "function"
  );
}

export interface OpenedIcadFile {
  handle: FileSystemFileHandle;
  name: string;
  text: string;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Prompts a native file picker. Null means unsupported or the user canceled. */
export async function openIcadFile(): Promise<OpenedIcadFile | null> {
  if (!supportsFileSystemAccess()) return null;
  try {
    const handles = await window.showOpenFilePicker!({
      types: OPEN_PICKER_TYPES,
    });
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    return { handle, name: handle.name, text: await file.text() };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/**
 * Writes `content` to `handle` (silent overwrite) or, if `handle` is null,
 * prompts a native Save-As picker first. Returns the handle now holding the
 * content (reuse it for the next silent Save), or null if unsupported or the
 * user canceled a Save-As prompt.
 */
export async function saveIcadFile(
  content: string,
  handle: FileSystemFileHandle | null,
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  if (!supportsFileSystemAccess()) return null;

  let target = handle;
  if (!target) {
    try {
      target = await window.showSaveFilePicker!({
        suggestedName,
        types: ICAD_PICKER_TYPES,
      });
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
  }

  const writable = await target.createWritable();
  await writable.write(content);
  await writable.close();
  return target;
}
