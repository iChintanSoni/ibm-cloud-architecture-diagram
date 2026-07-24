import { useEffect, useState } from "react";
import type { ThemeKind } from "../../shared/protocol.js";
import { onHostMessage } from "./vscodeApi.js";

type CarbonTheme = "white" | "g100";

function initialThemeKind(): ThemeKind {
  const body = typeof document !== "undefined" ? document.body : undefined;
  const dark = body?.classList.contains("vscode-dark") || body?.classList.contains("vscode-high-contrast");
  return dark ? "dark" : "light";
}

function toCarbonTheme(kind: ThemeKind): CarbonTheme {
  return kind === "dark" ? "g100" : "white";
}

/**
 * VS Code drives this shell's theme entirely — no manual light/dark/auto picker like
 * apps/web/src/useResolvedTheme.ts, since a per-extension override would fight the user's
 * expectation that every VS Code surface matches the editor's active color theme. The extension
 * host (icadEditorProvider.ts) pushes {type:"themeKind"} once the webview reports "ready" and
 * again on every vscode.window.onDidChangeActiveColorTheme; the injected `vscode-dark`/
 * `vscode-high-contrast` body class only seeds the very first paint, before that first message
 * has had a chance to arrive.
 */
export function useVsCodeTheme(): { kind: ThemeKind; carbonTheme: CarbonTheme } {
  const [kind, setKind] = useState<ThemeKind>(initialThemeKind);

  useEffect(
    () =>
      onHostMessage((message) => {
        if (message.type === "themeKind") setKind(message.kind);
      }),
    []
  );

  return { kind, carbonTheme: toCarbonTheme(kind) };
}
