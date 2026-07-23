/**
 * Continuous autosave + crash recovery (D10): working state is persisted to
 * IndexedDB on every scene change (debounced), independent of the explicit
 * Save that writes the `.icad` file. `loadDraft` on startup is how the app
 * offers to restore after a crash/reload with unsaved changes.
 */

const DB_NAME = "icad-autosave";
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Persists the current document as the recovery draft, replacing any previous one. */
export async function saveDraft(doc: unknown): Promise<void> {
  await withStore("readwrite", (store) => store.put(doc, DRAFT_KEY));
}

/** Returns the last autosaved document, or null if there is none. */
export async function loadDraft(): Promise<unknown | null> {
  const result = await withStore("readonly", (store) => store.get(DRAFT_KEY));
  return result ?? null;
}

/** Clears the draft — call after an explicit Save or when the user discards a recovered draft. */
export async function clearDraft(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(DRAFT_KEY));
}

/** Debounces autosave writes so every keystroke/drag doesn't hit IndexedDB. */
export function debounceAutosave(save: (doc: unknown) => void, delayMs = 800): (doc: unknown) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (doc: unknown) => {
    clearTimeout(timer);
    timer = setTimeout(() => save(doc), delayMs);
  };
}
