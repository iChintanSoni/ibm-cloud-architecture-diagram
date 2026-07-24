import * as vscode from "vscode";

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

export interface IcadEdit {
  content: string;
  label: string;
}

/**
 * Our CustomDocument. The extension host never parses or understands `.icad` — it just carries
 * the latest serialized JSON string between disk, the webview, and VS Code's save/backup APIs.
 * Everything with actual `.icad` semantics (migration/repair, validation, rendering) lives in the
 * webview, where the real @icad/core Editor runs.
 */
export class IcadDocument implements vscode.CustomDocument {
  private readonly changeEmitter = new vscode.EventEmitter<IcadEdit>();
  readonly onDidChangeContent = this.changeEmitter.event;

  private readonly disposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.disposeEmitter.event;

  latestContent: string;

  private constructor(
    readonly uri: vscode.Uri,
    initialContent: string
  ) {
    this.latestContent = initialContent;
  }

  static async create(uri: vscode.Uri, backupId?: string): Promise<IcadDocument> {
    const source = backupId ? vscode.Uri.parse(backupId) : uri;
    const bytes = await vscode.workspace.fs.readFile(source);
    return new IcadDocument(uri, decoder.decode(bytes));
  }

  /** Called when the webview posts a new "edit" message for a genuine (non-undo/redo) change. */
  applyEdit(edit: IcadEdit): void {
    this.latestContent = edit.content;
    this.changeEmitter.fire(edit);
  }

  async revert(): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(this.uri);
    this.latestContent = decoder.decode(bytes);
    return this.latestContent;
  }

  async writeTo(target: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.writeFile(target, encoder.encode(this.latestContent));
  }

  dispose(): void {
    this.disposeEmitter.fire();
    this.changeEmitter.dispose();
    this.disposeEmitter.dispose();
  }
}
