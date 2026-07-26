import * as vscode from "vscode";
import type {
  HostMessage,
  ThemeKind,
  WebviewMessage,
} from "../shared/protocol.js";
import { IcadDocument } from "./icadDocument.js";
import { getHtmlForWebview } from "./webviewHtml.js";

function themeKindOf(theme: vscode.ColorTheme): ThemeKind {
  // Carbon only has two visual tokens (white/g100) — fold both high-contrast kinds into the
  // closer of the two rather than introducing a third chrome mode this shell doesn't have.
  if (
    theme.kind === vscode.ColorThemeKind.Light ||
    theme.kind === vscode.ColorThemeKind.HighContrastLight
  ) {
    return "light";
  }
  return "dark";
}

/**
 * A CustomEditorProvider (own CustomDocument), not a CustomTextEditorProvider: @icad/core already
 * owns a real command-granularity undo/redo model (packages/core/src/commands/commandBus.ts), so
 * we bridge that into VS Code's undo stack explicitly instead of routing through VS Code's
 * text-edit undo model. The extension host never touches `.icad` semantics (parsing, migration,
 * rendering) at all — the real Editor runs entirely inside the webview; the host is a thin file-I/O
 * and undo/redo relay (docs/02-architecture.md#shells).
 */
export class IcadEditorProvider implements vscode.CustomEditorProvider<IcadDocument> {
  static readonly viewType = "icad.editor";

  private readonly editEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<IcadDocument>
  >();
  readonly onDidChangeCustomDocument = this.editEmitter.event;

  private readonly panels = new Map<IcadDocument, vscode.WebviewPanel>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      IcadEditorProvider.viewType,
      new IcadEditorProvider(context.extensionUri),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
  ): Promise<IcadDocument> {
    return IcadDocument.create(uri, openContext.backupId);
  }

  resolveCustomEditor(
    document: IcadDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    this.panels.set(document, webviewPanel);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };
    webviewPanel.webview.html = getHtmlForWebview(
      webviewPanel.webview,
      this.extensionUri,
    );

    const post = (message: HostMessage) =>
      void webviewPanel.webview.postMessage(message);

    const themeListener = vscode.window.onDidChangeActiveColorTheme((theme) =>
      post({ type: "themeKind", kind: themeKindOf(theme) }),
    );

    const messageListener = webviewPanel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message.type === "ready") {
          post({ type: "init", content: document.latestContent });
          post({
            type: "themeKind",
            kind: themeKindOf(vscode.window.activeColorTheme),
          });
          return;
        }

        if (message.type === "edit") {
          document.applyEdit({
            content: message.content,
            label: message.label,
          });
          this.editEmitter.fire({
            document,
            label: message.label,
            undo: () => post({ type: "undo" }),
            redo: () => post({ type: "redo" }),
          });
          return;
        }

        if (message.type === "sync") {
          // Post-undo/redo settlement: update our bookkeeping copy only. Deliberately does NOT fire
          // onDidChangeCustomDocument — see the "sync" doc comment in shared/protocol.ts.
          document.latestContent = message.content;
          return;
        }

        if (message.type === "exportSvg") {
          void this.exportSvg(document, message.content);
          return;
        }

        if (message.type === "requestOpen") {
          void vscode.commands.executeCommand(
            "workbench.action.files.openFile",
          );
          return;
        }

        if (message.type === "requestSave") {
          void vscode.commands.executeCommand("workbench.action.files.save");
          return;
        }

        if (message.type === "requestSaveAs") {
          void vscode.commands.executeCommand("workbench.action.files.saveAs");
        }
      },
    );

    webviewPanel.onDidDispose(() => {
      themeListener.dispose();
      messageListener.dispose();
      this.panels.delete(document);
    });
  }

  async saveCustomDocument(document: IcadDocument): Promise<void> {
    await document.writeTo(document.uri);
  }

  async saveCustomDocumentAs(
    document: IcadDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    await document.writeTo(destination);
  }

  async revertCustomDocument(document: IcadDocument): Promise<void> {
    const content = await document.revert();
    this.panels
      .get(document)
      ?.webview.postMessage({ type: "revert", content } satisfies HostMessage);
  }

  async backupCustomDocument(
    document: IcadDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    await document.writeTo(context.destination);
    return {
      id: context.destination.toString(),
      delete: () => void vscode.workspace.fs.delete(context.destination),
    };
  }

  private async exportSvg(document: IcadDocument, svg: string): Promise<void> {
    const defaultUri = vscode.Uri.file(
      document.uri.fsPath.replace(/\.icad$/, ".svg"),
    );
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "SVG image": ["svg"] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(svg));
    void vscode.window.showInformationMessage(
      `Exported ${vscode.workspace.asRelativePath(target)}`,
    );
  }
}
