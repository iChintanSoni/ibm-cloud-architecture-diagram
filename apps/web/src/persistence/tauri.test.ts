import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const mockSetTheme = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: mockSetTheme }),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  consumeStartupFile,
  isTauri,
  onNativeFileOpen,
  openIcadFileNative,
  saveExportNative,
  saveIcadFileNative,
  setNativeTheme,
} from "./tauri";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("isTauri", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("is false in a plain browser environment", () => {
    expect(isTauri()).toBe(false);
  });

  it("is true once the Tauri IPC bridge is present", () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(true);
  });
});

describe("openIcadFileNative", () => {
  it("returns the picked path and its contents", async () => {
    vi.mocked(open).mockResolvedValue("/Users/me/diagram.icad");
    vi.mocked(readTextFile).mockResolvedValue("{}");

    const result = await openIcadFileNative();

    expect(result).toEqual({ path: "/Users/me/diagram.icad", text: "{}" });
    expect(readTextFile).toHaveBeenCalledWith("/Users/me/diagram.icad");
  });

  it("returns null when the user cancels the picker", async () => {
    vi.mocked(open).mockResolvedValue(null);
    expect(await openIcadFileNative()).toBeNull();
  });
});

describe("saveIcadFileNative", () => {
  it("writes directly to an existing path without prompting", async () => {
    const result = await saveIcadFileNative(
      "{}",
      "/Users/me/diagram.icad",
      "diagram.icad",
    );

    expect(save).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith("/Users/me/diagram.icad", "{}");
    expect(result).toBe("/Users/me/diagram.icad");
  });

  it("prompts a Save-As dialog when no path is given", async () => {
    vi.mocked(save).mockResolvedValue("/Users/me/new.icad");

    const result = await saveIcadFileNative("{}", null, "new.icad");

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "new.icad" }),
    );
    expect(writeTextFile).toHaveBeenCalledWith("/Users/me/new.icad", "{}");
    expect(result).toBe("/Users/me/new.icad");
  });

  it("returns null and writes nothing when the Save-As dialog is canceled", async () => {
    vi.mocked(save).mockResolvedValue(null);

    const result = await saveIcadFileNative("{}", null, "new.icad");

    expect(writeTextFile).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe("consumeStartupFile", () => {
  it("returns null when the process wasn't launched with a file", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await consumeStartupFile()).toBeNull();
  });

  it("reads and returns the startup file when one was passed", async () => {
    vi.mocked(invoke).mockResolvedValue("/Users/me/startup.icad");
    vi.mocked(readTextFile).mockResolvedValue("{}");

    expect(await consumeStartupFile()).toEqual({
      path: "/Users/me/startup.icad",
      text: "{}",
    });
  });
});

describe("onNativeFileOpen", () => {
  it("reads the file at the emitted path and forwards it to the handler", async () => {
    let emit: ((event: { payload: string }) => void) | undefined;
    vi.mocked(listen).mockImplementation((_event, cb) => {
      emit = cb as (event: { payload: string }) => void;
      return Promise.resolve(vi.fn());
    });
    vi.mocked(readTextFile).mockResolvedValue("{}");

    const handler = vi.fn();
    await onNativeFileOpen(handler);
    expect(emit).toBeDefined();

    await emit!({ payload: "/Users/me/relaunched.icad" });

    expect(readTextFile).toHaveBeenCalledWith("/Users/me/relaunched.icad");
    expect(handler).toHaveBeenCalledWith({
      path: "/Users/me/relaunched.icad",
      text: "{}",
    });
  });
});

describe("setNativeTheme", () => {
  it("forwards an explicit light/dark choice to the native window", async () => {
    await setNativeTheme("dark");
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("passes null for 'auto', handing theming back to the OS", async () => {
    await setNativeTheme(null);
    expect(mockSetTheme).toHaveBeenCalledWith(null);
  });
});

describe("saveExportNative", () => {
  const filters = [{ name: "PNG image", extensions: ["png"] }];

  it("writes the blob's bytes to the chosen path", async () => {
    vi.mocked(save).mockResolvedValue("/Users/me/diagram.png");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const result = await saveExportNative(blob, "diagram.png", filters);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "diagram.png", filters }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/me/diagram.png",
      new Uint8Array([1, 2, 3]),
    );
    expect(result).toBe("/Users/me/diagram.png");
  });

  it("returns null and writes nothing when the dialog is canceled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const result = await saveExportNative(blob, "diagram.png", filters);

    expect(writeFile).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
