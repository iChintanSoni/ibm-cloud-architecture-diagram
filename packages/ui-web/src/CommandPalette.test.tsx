// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette.js";
import type { CommandItem } from "./commandPaletteModel.js";

/** Controlled Carbon inputs need the native setter so React's change-event plugin fires onChange. */
function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CommandPalette", () => {
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

  function commands(): CommandItem[] {
    return [
      { id: "new", label: "New diagram", category: "File", run: vi.fn() },
      { id: "save", label: "Save .icad", category: "File", run: vi.fn() },
      { id: "undo", label: "Undo", category: "Edit", run: vi.fn() },
    ];
  }

  it("renders nothing when closed", () => {
    act(() => {
      root.render(
        <CommandPalette open={false} commands={commands()} onClose={vi.fn()} />,
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("lists all commands and runs the clicked one, then closes", () => {
    const onClose = vi.fn();
    const items = commands();

    act(() => {
      root.render(<CommandPalette open commands={items} onClose={onClose} />);
    });

    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual([
      "New diagramFile",
      "Save .icadFile",
      "UndoEdit",
    ]);

    act(() => (options[1] as HTMLButtonElement).click());
    expect(items[1]?.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("filters commands as the query changes", () => {
    act(() => {
      root.render(
        <CommandPalette open commands={commands()} onClose={vi.fn()} />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => setNativeInputValue(input, "save"));

    expect(
      [...container.querySelectorAll('[role="option"]')].map(
        (o) => o.textContent,
      ),
    ).toEqual(["Save .icadFile"]);
  });

  it("runs the active command on Enter and supports arrow-key navigation", () => {
    const items = commands();
    const dialog = () =>
      container.querySelector('[role="dialog"]') as HTMLElement;

    act(() => {
      root.render(<CommandPalette open commands={items} onClose={vi.fn()} />);
    });

    act(() =>
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    act(() =>
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );

    expect(items[1]?.run).toHaveBeenCalled();
    expect(items[0]?.run).not.toHaveBeenCalled();
  });

  it("closes on Escape and on backdrop click, without running anything", () => {
    const onClose = vi.fn();
    const items = commands();

    act(() => {
      root.render(<CommandPalette open commands={items} onClose={onClose} />);
    });

    act(() =>
      container
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      items.every(
        (c) => (c.run as ReturnType<typeof vi.fn>).mock.calls.length === 0,
      ),
    ).toBe(true);

    act(() =>
      (
        container.querySelector(
          ".icad-command-palette__backdrop",
        ) as HTMLElement
      ).click(),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores focus to whatever opened it once closed", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    act(() =>
      root.render(
        <CommandPalette open commands={commands()} onClose={vi.fn()} />,
      ),
    );
    expect(document.activeElement).not.toBe(trigger);

    act(() =>
      root.render(
        <CommandPalette open={false} commands={commands()} onClose={vi.fn()} />,
      ),
    );
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it("resets the query when reopened", () => {
    const { rerender } = {
      rerender: (open: boolean) =>
        act(() =>
          root.render(
            <CommandPalette
              open={open}
              commands={commands()}
              onClose={vi.fn()}
            />,
          ),
        ),
    };

    rerender(true);
    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => setNativeInputValue(input, "undo"));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);

    rerender(false);
    rerender(true);
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
  });
});
