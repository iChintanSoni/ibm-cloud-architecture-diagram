import type { HostMessage, WebviewMessage } from "../../shared/protocol.js";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

// Real inside a VS Code webview; undefined when this bundle is opened as a plain page (e.g. a
// local `vite preview` for visual debugging) — every call below no-ops gracefully in that case.
const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

export function postToHost(message: WebviewMessage): void {
  vscode?.postMessage(message);
}

/** Subscribes to messages from the extension host. Returns an unsubscribe function. */
export function onHostMessage(listener: (message: HostMessage) => void): () => void {
  const handler = (event: MessageEvent<HostMessage>) => listener(event.data);
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}
