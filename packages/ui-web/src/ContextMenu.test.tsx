// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu.js";
import type { CommandItem } from "./commandPaletteModel.js";

describe("ContextMenu", () => {
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

  function menuItem(label: string): HTMLElement {
    const item = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.includes(label),
    );
    if (!item) throw new Error(`menu item "${label}" not found`);
    return item as HTMLElement;
  }

  it("renders nothing when closed", () => {
    act(() => {
      root.render(
        <ContextMenu open={false} x={0} y={0} items={[]} onClose={vi.fn()} />,
      );
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("renders each item's label and shortcut, runs it, and closes on click", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const items: CommandItem[] = [
      { id: "copy", label: "Copy", shortcut: "Ctrl+C", run },
    ];
    act(() => {
      root.render(
        <ContextMenu open x={10} y={20} items={items} onClose={onClose} />,
      );
    });

    const item = menuItem("Copy");
    expect(item.textContent).toContain("Ctrl+C");

    act(() => item.click());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("marks an item disabled and never runs it on click", () => {
    const run = vi.fn();
    const items: CommandItem[] = [
      { id: "paste", label: "Paste", disabled: true, run },
    ];
    act(() => {
      root.render(
        <ContextMenu open x={0} y={0} items={items} onClose={vi.fn()} />,
      );
    });

    const item = menuItem("Paste");
    expect(item.getAttribute("aria-disabled")).toBe("true");

    act(() => item.click());
    expect(run).not.toHaveBeenCalled();
  });

  it("renders a danger item (e.g. Delete) with Carbon's danger styling", () => {
    const items: CommandItem[] = [
      { id: "delete", label: "Delete", danger: true, run: vi.fn() },
    ];
    act(() => {
      root.render(
        <ContextMenu open x={0} y={0} items={items} onClose={vi.fn()} />,
      );
    });

    expect(menuItem("Delete").className).toContain("--menu-item--danger");
  });
});
