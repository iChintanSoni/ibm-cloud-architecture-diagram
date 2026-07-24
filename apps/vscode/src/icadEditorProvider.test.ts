import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => await import("./testUtils/fakeVscode.js"));

const { Uri, createFakeWebviewPanel, resetFakeVscode, workspace } = await import("./testUtils/fakeVscode.js");
const { IcadEditorProvider } = await import("./icadEditorProvider.js");
const { IcadDocument } = await import("./icadDocument.js");

const encoder = new TextEncoder();

async function openDocument(content: string) {
  vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(encoder.encode(content));
  return IcadDocument.create(Uri.file("/diagrams/a.icad") as never);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetFakeVscode();
});

describe("IcadEditorProvider", () => {
  it("posts init + themeKind once the webview reports ready", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument('{"format":"icad"}');
    const panel = createFakeWebviewPanel();

    provider.resolveCustomEditor(document, panel as never);
    panel.emitMessage({ type: "ready" });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "init", content: '{"format":"icad"}' });
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "themeKind", kind: "light" });
  });

  it("bridges a genuine edit into VS Code's undo stack and forwards undo()/redo() to the webview", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    const panel = createFakeWebviewPanel();
    provider.resolveCustomEditor(document, panel as never);

    const editListener = vi.fn();
    provider.onDidChangeCustomDocument(editListener);

    panel.emitMessage({ type: "edit", content: '{"v":1}', label: "Add box" });

    expect(document.latestContent).toBe('{"v":1}');
    expect(editListener).toHaveBeenCalledTimes(1);
    const event = editListener.mock.calls[0][0];
    expect(event.document).toBe(document);
    expect(event.label).toBe("Add box");

    event.undo();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "undo" });

    event.redo();
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "redo" });
  });

  it("a 'sync' message updates content WITHOUT pushing another entry onto VS Code's undo stack", async () => {
    // This is the anti-feedback-loop guarantee the undo/redo bridge depends on: the webview posts
    // "sync" after replaying commands.undo()/redo() in response to a host-initiated "undo"/"redo"
    // message. If this fired onDidChangeCustomDocument too, every Ctrl+Z would enqueue a spurious
    // new edit instead of just moving VS Code's existing stack pointer.
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    const panel = createFakeWebviewPanel();
    provider.resolveCustomEditor(document, panel as never);

    const editListener = vi.fn();
    provider.onDidChangeCustomDocument(editListener);

    panel.emitMessage({ type: "sync", content: '{"v":2}' });

    expect(document.latestContent).toBe('{"v":2}');
    expect(editListener).not.toHaveBeenCalled();
  });

  it("saveCustomDocument writes latestContent to the document's own uri", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    document.applyEdit({ content: '{"v":3}', label: "Move" });

    await provider.saveCustomDocument(document, undefined as never);

    expect(workspace.fs.writeFile).toHaveBeenCalledWith(document.uri, encoder.encode('{"v":3}'));
  });

  it("saveCustomDocumentAs writes latestContent to the destination uri", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    document.applyEdit({ content: '{"v":4}', label: "Move" });
    const destination = Uri.file("/diagrams/copy.icad");

    await provider.saveCustomDocumentAs(document, destination as never, undefined as never);

    expect(workspace.fs.writeFile).toHaveBeenCalledWith(destination, encoder.encode('{"v":4}'));
  });

  it("backupCustomDocument writes to the backup destination and its delete() removes it", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    document.applyEdit({ content: '{"v":5}', label: "Move" });
    const destination = Uri.file("/backups/a-1.icad");

    const backup = await provider.backupCustomDocument(document, { destination } as never, undefined as never);

    expect(workspace.fs.writeFile).toHaveBeenCalledWith(destination, encoder.encode('{"v":5}'));
    backup.delete();
    expect(workspace.fs.delete).toHaveBeenCalledWith(destination);
  });

  it("revertCustomDocument re-reads the file and pushes the reverted content to the open panel", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    const panel = createFakeWebviewPanel();
    provider.resolveCustomEditor(document, panel as never);
    document.applyEdit({ content: '{"unsaved":true}', label: "Add box" });

    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(encoder.encode('{"onDisk":true}'));
    await provider.revertCustomDocument(document, undefined as never);

    expect(document.latestContent).toBe('{"onDisk":true}');
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "revert", content: '{"onDisk":true}' });
  });

  it("exportSvg prompts a save dialog and writes the chosen file", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    const panel = createFakeWebviewPanel();
    provider.resolveCustomEditor(document, panel as never);

    const { window: fakeWindow } = await import("./testUtils/fakeVscode.js");
    const target = Uri.file("/diagrams/a.svg");
    vi.mocked(fakeWindow.showSaveDialog).mockResolvedValueOnce(target as never);

    panel.emitMessage({ type: "exportSvg", content: "<svg></svg>" });
    await flush();

    expect(fakeWindow.showSaveDialog).toHaveBeenCalled();
    expect(workspace.fs.writeFile).toHaveBeenCalledWith(target, encoder.encode("<svg></svg>"));
  });

  it("relays requestOpen/requestSave/requestSaveAs to the matching native VS Code command", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    const panel = createFakeWebviewPanel();
    provider.resolveCustomEditor(document, panel as never);

    const { commands } = await import("./testUtils/fakeVscode.js");

    panel.emitMessage({ type: "requestOpen" });
    panel.emitMessage({ type: "requestSave" });
    panel.emitMessage({ type: "requestSaveAs" });

    expect(commands.executeCommand).toHaveBeenNthCalledWith(1, "workbench.action.files.openFile");
    expect(commands.executeCommand).toHaveBeenNthCalledWith(2, "workbench.action.files.save");
    expect(commands.executeCommand).toHaveBeenNthCalledWith(3, "workbench.action.files.saveAs");
  });

  it("exportSvg does nothing if the user cancels the save dialog", async () => {
    const provider = new IcadEditorProvider(Uri.file("/ext") as never);
    const document = await openDocument("{}");
    const panel = createFakeWebviewPanel();
    provider.resolveCustomEditor(document, panel as never);

    const { window: fakeWindow } = await import("./testUtils/fakeVscode.js");
    vi.mocked(fakeWindow.showSaveDialog).mockResolvedValueOnce(undefined);

    panel.emitMessage({ type: "exportSvg", content: "<svg></svg>" });
    await flush();

    expect(workspace.fs.writeFile).not.toHaveBeenCalled();
  });
});
