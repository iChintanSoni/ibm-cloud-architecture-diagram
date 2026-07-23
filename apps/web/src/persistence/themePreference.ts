import type { ThemePreference } from "../useResolvedTheme.js";

/**
 * Persists the auto/light/dark chrome preference across sessions
 * (docs/06-editor-ux.md#themes), independent of any one `.icad` document.
 */
const STORAGE_KEY = "icad:theme-preference";
const VALID: ReadonlySet<string> = new Set(["auto", "light", "dark"]);

export function loadThemePreference(): ThemePreference | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && VALID.has(value) ? (value as ThemePreference) : undefined;
  } catch {
    return undefined;
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private browsing quota, disabled cookies); the
    // in-memory preference for this session still works, it just won't persist.
  }
}
