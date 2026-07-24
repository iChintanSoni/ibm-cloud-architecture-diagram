/**
 * A hand-rolled fake of the small slice of the `vscode` namespace this extension touches. The real
 * `vscode` module only exists inside a running VS Code extension host process (not a plain Node/
 * vitest run), so tests intercept the bare "vscode" import via `vi.mock("vscode", ...)` and resolve
 * it to this instead — the same reasoning packages/mcp/vitest.config.ts documents for staying off
 * jsdom: exercise the real code path standalone rather than mask it with an ambient environment.
 */
import { vi } from "vitest";

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  };
  fire(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class Uri {
  private constructor(readonly scheme: string, readonly fsPath: string) {}
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  static parse(value: string): Uri {
    return new Uri("file", value.replace(/^file:\/\//, ""));
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath, ...segments].join("/"));
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4
} as const;

export const workspace = {
  fs: {
    readFile: vi.fn(async (_uri: Uri): Promise<Uint8Array> => new Uint8Array()),
    writeFile: vi.fn(async (_uri: Uri, _content: Uint8Array): Promise<void> => undefined),
    delete: vi.fn(async (_uri: Uri): Promise<void> => undefined)
  },
  asRelativePath: vi.fn((uri: Uri) => uri.fsPath)
};

export const commands = {
  executeCommand: vi.fn(async (_command: string) => undefined)
};

export const window = {
  activeColorTheme: { kind: ColorThemeKind.Light },
  onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: () => undefined })),
  registerCustomEditorProvider: vi.fn(() => ({ dispose: () => undefined })),
  showSaveDialog: vi.fn(async (): Promise<Uri | undefined> => undefined),
  showInformationMessage: vi.fn(async () => undefined)
};

/**
 * A fake WebviewPanel. VS Code itself constructs the real one and hands it to
 * resolveCustomEditor — nothing in this extension ever calls `vscode.window.createWebviewPanel`
 * directly — so tests build this shape themselves rather than sourcing it from the fake module's
 * `window` object.
 */
export function createFakeWebviewPanel() {
  let messageHandler: ((message: unknown) => void) | undefined;
  let disposeHandler: (() => void) | undefined;
  const postMessage = vi.fn(async (_message: unknown) => true);

  return {
    webview: {
      cspSource: "vscode-webview:",
      options: {} as unknown,
      html: "",
      postMessage,
      asWebviewUri: (uri: Uri) => uri,
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        messageHandler = handler;
        return { dispose: () => (messageHandler = undefined) };
      }
    },
    onDidDispose: (handler: () => void) => {
      disposeHandler = handler;
      return { dispose: () => (disposeHandler = undefined) };
    },
    /** Test helper: simulate the webview posting `message` to the extension host. */
    emitMessage(message: unknown): void {
      messageHandler?.(message);
    },
    /** Test helper: simulate VS Code disposing the panel (tab closed). */
    simulateDispose(): void {
      disposeHandler?.();
    }
  };
}

/** Resets every mock's recorded calls/return-value overrides between tests. */
export function resetFakeVscode(): void {
  workspace.fs.readFile.mockReset();
  workspace.fs.writeFile.mockReset();
  workspace.fs.delete.mockReset();
  workspace.asRelativePath.mockReset();
  window.onDidChangeActiveColorTheme.mockReset();
  window.registerCustomEditorProvider.mockReset();
  window.showSaveDialog.mockReset();
  window.showInformationMessage.mockReset();
  window.activeColorTheme = { kind: ColorThemeKind.Light };
  commands.executeCommand.mockReset();
}
