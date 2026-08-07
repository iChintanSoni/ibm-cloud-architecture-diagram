/**
 * Persists the background-grid visibility preference across sessions (M17.2,
 * packages/core/docs/canvas-parity-plan.md), independent of any one `.icad` document — mirrors
 * themePreference.ts's own shape.
 */
const STORAGE_KEY = "icad:grid-visible";

export function loadGridPreference(): boolean | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

export function saveGridPreference(visible: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(visible));
  } catch {
    // Storage may be unavailable (private browsing quota, disabled cookies); the
    // in-memory preference for this session still works, it just won't persist.
  }
}
