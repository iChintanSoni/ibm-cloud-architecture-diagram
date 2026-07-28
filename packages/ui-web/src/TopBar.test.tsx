// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar, type TopBarProps } from "./TopBar.js";

function findByText(
  container: HTMLElement,
  tag: string,
  text: string,
): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>(tag)].find(
    (el) => el.textContent === text,
  );
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
    onGroup: vi.fn(),
    onUngroup: vi.fn(),
    canGroup: false,
    canUngroup: false,
    onBringToFront: vi.fn(),
    onSendToBack: vi.fn(),
    onBringForward: vi.fn(),
    onSendBackward: vi.fn(),
    canChangeZOrder: false,
    onAlignLeft: vi.fn(),
    onAlignCenterHorizontal: vi.fn(),
    onAlignRight: vi.fn(),
    onAlignTop: vi.fn(),
    onAlignMiddle: vi.fn(),
    onAlignBottom: vi.fn(),
    canAlign: false,
    onDistributeHorizontal: vi.fn(),
    onDistributeVertical: vi.fn(),
    canDistribute: false,
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
    gridVisible: true,
    onToggleGrid: vi.fn(),
    ...overrides,
  };
}

describe("TopBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the File/Edit/View/Insert/Help menus and the zoom indicator", () => {
    act(() => {
      root.render(<TopBar {...baseProps({ zoomPercent: 137.6 })} />);
    });

    for (const label of ["File", "Edit", "View", "Insert", "Help"]) {
      expect(findByText(container, "a", label)).toBeTruthy();
    }
    expect(container.querySelector(".icad-zoom-indicator")?.textContent).toBe(
      "138%",
    );
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

  it("disables Group/Ungroup until enabled, then invokes them", () => {
    const onGroup = vi.fn();
    const onUngroup = vi.fn();
    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onGroup,
            onUngroup,
            canGroup: false,
            canUngroup: true,
          })}
        />,
      );
    });

    const groupItem = findByText(container, "a", "Group") as HTMLAnchorElement;
    expect(groupItem.getAttribute("aria-disabled")).toBe("true");
    act(() => groupItem.click());
    expect(onGroup).not.toHaveBeenCalled();

    const ungroupItem = findByText(
      container,
      "a",
      "Ungroup",
    ) as HTMLAnchorElement;
    expect(ungroupItem.getAttribute("aria-disabled")).toBeNull();
    act(() => ungroupItem.click());
    expect(onUngroup).toHaveBeenCalled();
  });

  it("disables all four z-order actions until enabled, then invokes each", () => {
    const onBringToFront = vi.fn();
    const onSendToBack = vi.fn();
    const onBringForward = vi.fn();
    const onSendBackward = vi.fn();
    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onBringToFront,
            onSendToBack,
            onBringForward,
            onSendBackward,
            canChangeZOrder: false,
          })}
        />,
      );
    });

    const bringToFrontItem = findByText(
      container,
      "a",
      "Bring to front",
    ) as HTMLAnchorElement;
    expect(bringToFrontItem.getAttribute("aria-disabled")).toBe("true");
    act(() => bringToFrontItem.click());
    expect(onBringToFront).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onBringToFront,
            onSendToBack,
            onBringForward,
            onSendBackward,
            canChangeZOrder: true,
          })}
        />,
      );
    });

    for (const [label, handler] of [
      ["Bring to front", onBringToFront],
      ["Bring forward", onBringForward],
      ["Send backward", onSendBackward],
      ["Send to back", onSendToBack],
    ] as const) {
      const item = findByText(container, "a", label) as HTMLAnchorElement;
      expect(item.getAttribute("aria-disabled")).toBeNull();
      act(() => item.click());
      expect(handler).toHaveBeenCalled();
    }
  });

  it("disables all six align actions until enabled, then invokes each", () => {
    const onAlignLeft = vi.fn();
    const onAlignCenterHorizontal = vi.fn();
    const onAlignRight = vi.fn();
    const onAlignTop = vi.fn();
    const onAlignMiddle = vi.fn();
    const onAlignBottom = vi.fn();
    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onAlignLeft,
            onAlignCenterHorizontal,
            onAlignRight,
            onAlignTop,
            onAlignMiddle,
            onAlignBottom,
            canAlign: false,
          })}
        />,
      );
    });

    const alignLeftItem = findByText(
      container,
      "a",
      "Align left",
    ) as HTMLAnchorElement;
    expect(alignLeftItem.getAttribute("aria-disabled")).toBe("true");
    act(() => alignLeftItem.click());
    expect(onAlignLeft).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onAlignLeft,
            onAlignCenterHorizontal,
            onAlignRight,
            onAlignTop,
            onAlignMiddle,
            onAlignBottom,
            canAlign: true,
          })}
        />,
      );
    });

    for (const [label, handler] of [
      ["Align left", onAlignLeft],
      ["Align center", onAlignCenterHorizontal],
      ["Align right", onAlignRight],
      ["Align top", onAlignTop],
      ["Align middle", onAlignMiddle],
      ["Align bottom", onAlignBottom],
    ] as const) {
      const item = findByText(container, "a", label) as HTMLAnchorElement;
      expect(item.getAttribute("aria-disabled")).toBeNull();
      act(() => item.click());
      expect(handler).toHaveBeenCalled();
    }
  });

  it("disables both distribute actions until enabled, then invokes each", () => {
    const onDistributeHorizontal = vi.fn();
    const onDistributeVertical = vi.fn();
    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onDistributeHorizontal,
            onDistributeVertical,
            canDistribute: false,
          })}
        />,
      );
    });

    const distributeHItem = findByText(
      container,
      "a",
      "Distribute horizontal",
    ) as HTMLAnchorElement;
    expect(distributeHItem.getAttribute("aria-disabled")).toBe("true");
    act(() => distributeHItem.click());
    expect(onDistributeHorizontal).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <TopBar
          {...baseProps({
            onDistributeHorizontal,
            onDistributeVertical,
            canDistribute: true,
          })}
        />,
      );
    });

    for (const [label, handler] of [
      ["Distribute horizontal", onDistributeHorizontal],
      ["Distribute vertical", onDistributeVertical],
    ] as const) {
      const item = findByText(container, "a", label) as HTMLAnchorElement;
      expect(item.getAttribute("aria-disabled")).toBeNull();
      act(() => item.click());
      expect(handler).toHaveBeenCalled();
    }
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

  it("switches theme from the overflow menu in the global bar", () => {
    const onThemeChange = vi.fn();
    act(() => {
      root.render(
        <TopBar {...baseProps({ onThemeChange, themePreference: "auto" })} />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".icad-theme-menu button",
    )!;
    act(() => trigger.click());

    const darkItem = findByText(
      document.body,
      "button",
      "Dark",
    ) as HTMLButtonElement;
    act(() => darkItem.click());
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("reflects the current theme preference in the overflow menu's accessible name", () => {
    act(() => {
      root.render(<TopBar {...baseProps({ themePreference: "dark" })} />);
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".icad-theme-menu button",
    )!;
    const labelledBy = trigger.getAttribute("aria-labelledby");
    expect(document.getElementById(labelledBy!)?.textContent).toBe(
      "Theme: Dark",
    );
  });

  it("opens find and the command palette from the global bar", () => {
    const onOpenFind = vi.fn();
    const onOpenCommandPalette = vi.fn();
    act(() => {
      root.render(
        <TopBar {...baseProps({ onOpenFind, onOpenCommandPalette })} />,
      );
    });

    const findButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Find on canvas (Ctrl+F)"]',
    )!;
    act(() => findButton.click());
    expect(onOpenFind).toHaveBeenCalled();

    const paletteButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Command palette (Ctrl+K)"]',
    )!;
    act(() => paletteButton.click());
    expect(onOpenCommandPalette).toHaveBeenCalled();
  });

  it("toggles the grid from the View menu, labeled by its current state (M17.2)", () => {
    const onToggleGrid = vi.fn();
    act(() => {
      root.render(
        <TopBar {...baseProps({ onToggleGrid, gridVisible: true })} />,
      );
    });

    const hideItem = findByText(
      container,
      "a",
      "Hide grid",
    ) as HTMLAnchorElement;
    act(() => hideItem.click());
    expect(onToggleGrid).toHaveBeenCalled();

    act(() => {
      root.render(
        <TopBar {...baseProps({ onToggleGrid, gridVisible: false })} />,
      );
    });
    expect(findByText(container, "a", "Show grid")).toBeTruthy();
  });
});
