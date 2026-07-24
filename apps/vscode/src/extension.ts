import * as vscode from "vscode";
import { IcadEditorProvider } from "./icadEditorProvider.js";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(IcadEditorProvider.register(context));
}

export function deactivate(): void {
  // Nothing to clean up beyond what context.subscriptions already disposes.
}
