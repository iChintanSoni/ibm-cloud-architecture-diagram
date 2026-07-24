import * as vscode from "vscode";

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}

/**
 * Builds the CSP-safe HTML shell for the webview. The actual editor (React + Carbon + @icad/core)
 * is a single bundle Vite produces at `dist/webview/assets/*` (webview/vite.config.ts sets
 * `base: "./"` so its own internal asset references stay relative); this only wires that bundle up
 * under VS Code's `vscode-webview:` origin and content-security-policy.
 */
export function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const webviewDistUri = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, "assets", "index.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDistUri, "assets", "index.css"));
  const csp = nonce();

  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${csp}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri.toString()}" rel="stylesheet" />
    <title>ICAD Diagram</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${csp}" type="module" src="${scriptUri.toString()}"></script>
  </body>
</html>`;
}
