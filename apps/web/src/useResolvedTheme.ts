import { useEffect, useState } from "react";

export type ThemePreference = "auto" | "light" | "dark";
type CarbonTheme = "white" | "g100";

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Resolves the auto/light/dark preference (packages/core/docs/editor-ux.md#themes) to a Carbon theme token. */
export function useResolvedTheme(preference: ThemePreference): CarbonTheme {
  const [systemPrefersDark, setSystemPrefersDark] = useState(prefersDark);

  useEffect(() => {
    if (preference !== "auto") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent) =>
      setSystemPrefersDark(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [preference]);

  if (preference === "light") return "white";
  if (preference === "dark") return "g100";
  return systemPrefersDark ? "g100" : "white";
}
