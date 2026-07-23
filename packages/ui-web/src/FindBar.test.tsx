// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindBar } from "./FindBar.js";
import type { FindMatch } from "./findModel.js";

/** Controlled Carbon inputs need the native setter so React's change-event plugin fires onChange. */
function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FindBar", () => {
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

  const matches: FindMatch[] = [
    { id: "a", label: "Payments", type: "box", kind: "element" },
    { id: "b", label: "Checkout flow", type: "frame", kind: "frame" }
  ];

  it("renders nothing when closed", () => {
    act(() => {
      root.render(
        <FindBar
          open={false}
          query=""
          matches={[]}
          activeIndex={0}
          onQueryChange={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });
    expect(container.querySelector('[role="search"]')).toBeNull();
  });

  it("shows a match counter and reports query changes", () => {
    const onQueryChange = vi.fn();
    act(() => {
      root.render(
        <FindBar
          open
          query="check"
          matches={matches}
          activeIndex={1}
          onQueryChange={onQueryChange}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });

    expect(container.querySelector(".icad-find-bar__count")?.textContent).toBe("2 / 2");

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => setNativeInputValue(input, "checkout"));
    expect(onQueryChange).toHaveBeenCalledWith("checkout");
  });

  it("shows 'No results' when there are no matches", () => {
    act(() => {
      root.render(
        <FindBar
          open
          query="zzz"
          matches={[]}
          activeIndex={0}
          onQueryChange={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });
    expect(container.querySelector(".icad-find-bar__count")?.textContent).toBe("No results");
  });

  it("steps forward and backward through matches on Enter/Shift+Enter", () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    act(() => {
      root.render(
        <FindBar
          open
          query="check"
          matches={matches}
          activeIndex={0}
          onQueryChange={vi.fn()}
          onNext={onNext}
          onPrevious={onPrevious}
          onClose={vi.fn()}
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onNext).toHaveBeenCalledTimes(1);

    act(() =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }))
    );
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and via the close button", () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <FindBar
          open
          query=""
          matches={[]}
          activeIndex={0}
          onQueryChange={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClose={onClose}
        />
      );
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to whatever opened it once closed", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const render = (open: boolean) =>
      act(() =>
        root.render(
          <FindBar
            open={open}
            query=""
            matches={[]}
            activeIndex={0}
            onQueryChange={vi.fn()}
            onNext={vi.fn()}
            onPrevious={vi.fn()}
            onClose={vi.fn()}
          />
        )
      );

    render(true);
    expect(document.activeElement).not.toBe(trigger);

    render(false);
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });
});
