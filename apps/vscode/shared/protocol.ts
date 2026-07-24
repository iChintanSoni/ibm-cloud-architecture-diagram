/**
 * The only contract between the extension host (Node, no DOM) and the webview (the actual editor,
 * mounting @icad/core + @icad/ui-web). Both sides import this file directly; it never crosses a
 * serialization boundary other than `postMessage`, so keep every payload JSON-safe.
 */

// Carbon's <Theme> only has two visual tokens (white/g100), so VS Code's four color-theme kinds
// (light, dark, high-contrast dark, high-contrast light) collapse to these two — see themeKindOf
// in icadEditorProvider.ts.
export type ThemeKind = "light" | "dark";

export type HostMessage =
  /** Sent once, after the webview announces "ready" — the document's current content. */
  | { type: "init"; content: string }
  /** The file changed out from under the open document (revert / external reload). */
  | { type: "revert"; content: string }
  /** VS Code's own Ctrl+Z / Ctrl+Shift+Z (or Edit menu) resolved to our CustomDocument's
   *  undo/redo — replay it against the engine's own command stack. */
  | { type: "undo" }
  | { type: "redo" }
  | { type: "themeKind"; kind: ThemeKind };

export type WebviewMessage =
  /** The webview finished mounting and is ready to receive "init". */
  | { type: "ready" }
  /** A genuine new user action (CommandBus.dispatch, never fired by undo()/redo() replay) — the
   *  host records this as one entry on VS Code's own undo stack, bridged via
   *  onDidChangeCustomDocument. */
  | { type: "edit"; content: string; label: string }
  /** The engine's own commands.undo()/redo() (replayed in response to a host "undo"/"redo"
   *  message) settled on this content. The host updates its bookkeeping copy only — it must NOT
   *  push another entry onto VS Code's undo stack, or every Ctrl+Z would enqueue a spurious redo
   *  step instead of just moving the existing stack pointer. */
  | { type: "sync"; content: string }
  | { type: "exportSvg"; content: string }
  /** TopBar's New/Open/Save/Save As are required props (@icad/ui-web) but the webview has no
   *  direct access to VS Code commands — relay to native VS Code actions instead of reimplementing
   *  File System Access API / download-upload fallbacks that make no sense inside a webview.
   *  "new" is the one handled locally (editor.newDocument via the reused NewDiagramDialog) since
   *  resetting *this* open document to a template has no VS Code-native equivalent. */
  | { type: "requestOpen" }
  | { type: "requestSave" }
  | { type: "requestSaveAs" };
