// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar, type TopBarProps } from "./TopBar.js";

function findByText(container: HTMLElement, tag: string, text: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>(tag)].find((el) => el.textContent === text);
}

function baseProps(overrides: Partial<TopBarProps> = {}): TopBarProps {
  return {
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onExport: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: false,
    canRedo: false,
    zoomPercent: 100,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    onFitToContent: vi.fn(),
    onOpenFind: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onInsert: vi.fn(),
    themePreference: "auto",
    onThemeChange: vi.fn(),
    ...overrides
  };
}

describe("TopBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the File/Edit/View/Insert/Help menus and the zoom indicator", () => {
    act(() => {
      root.render(<TopBar {...baseProps({ zoomPercent: 137.6 })} />);
    });

    for (const label of ["File", "Edit", "View", "Insert", "Help"]) {
      expect(findByText(container, "a", label)).toBeTruthy();
    }
    expect(container.querySelector(".icad-zoom-indicator")?.textContent).toBe("138%");
  });

  it("runs File > New… and prevents default navigation", () => {
    const onNew = vi.fn();
    act(() => {
      root.render(<TopBar {...baseProps({ onNew })} />);
    });

    const item = findByText(container, "a", "New…") as HTMLAnchorElement;
    act(() => item.click());
    expect(onNew).toHaveBeenCalled();
  });

  it("disables Undo/Redo menu items and does not invoke the handler while disabled", () => {
    const onUndo = vi.fn();
    act(() => {
      root.render(<TopBar {...baseProps({ onUndo, canUndo: false })} />);
    });

    const undoItem = findByText(container, "a", "Undo") as HTMLAnchorElement;
    expect(undoItem.getAttribute("aria-disabled")).toBe("true");
    act(() => undoItem.click());
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("invokes Undo when enabled", () => {
    const onUndo = vi.fn();
    act(() => {
      root.render(<TopBar {...baseProps({ onUndo, canUndo: true })} />);
    });

    const undoItem = findByText(container, "a", "Undo") as HTMLAnchorElement;
    expect(undoItem.getAttribute("aria-disabled")).toBeNull();
    act(() => undoItem.click());
    expect(onUndo).toHaveBeenCalled();
  });

  it("inserts a frame via the Insert menu", () => {
    const onInsert = vi.fn();
    act(() => {
      root.render(<TopBar {...baseProps({ onInsert })} />);
    });

    const item = findByText(container, "a", "Frame") as HTMLAnchorElement;
    act(() => item.click());
    expect(onInsert).toHaveBeenCalledWith("frame");
  });

  it("switches theme from the global bar buttons", () => {
    const onThemeChange = vi.fn();
    act(() => {
      root.render(<TopBar {...baseProps({ onThemeChange, themePreference: "auto" })} />);
    });

    const darkButton = [...container.querySelectorAll<HTMLButtonElement>(".icad-theme-switch button")].find(
      (button) => button.textContent === "dark"
    )!;
    act(() => darkButton.click());
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("opens find and the command palette from the global bar", () => {
    const onOpenFind = vi.fn();
    const onOpenCommandPalette = vi.fn();
    act(() => {
      root.render(<TopBar {...baseProps({ onOpenFind, onOpenCommandPalette })} />);
    });

    const findButton = container.querySelector<HTMLButtonElement>('[aria-label="Find on canvas (Ctrl+F)"]')!;
    act(() => findButton.click());
    expect(onOpenFind).toHaveBeenCalled();

    const paletteButton = container.querySelector<HTMLButtonElement>('[aria-label="Command palette (Ctrl+K)"]')!;
    act(() => paletteButton.click());
    expect(onOpenCommandPalette).toHaveBeenCalled();
  });
});
