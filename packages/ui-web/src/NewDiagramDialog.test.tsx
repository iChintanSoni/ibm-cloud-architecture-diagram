// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewDiagramDialog } from "./NewDiagramDialog.js";

describe("NewDiagramDialog", () => {
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
      }
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

  it("offers all templates and confirms replacement with the chosen level", () => {
    const onCreate = vi.fn();
    act(() => {
      root.render(
        <NewDiagramDialog
          open
          hasExistingContent
          onClose={vi.fn()}
          onCreate={onCreate}
        />
      );
    });

    expect(document.body.textContent).toContain("replaces the current document");
    expect(document.body.querySelectorAll('input[name="icad-diagram-template"]')).toHaveLength(4);

    const detailed = document.body.querySelector<HTMLInputElement>("#icad-template-detailed")!;
    act(() => detailed.click());
    const createButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Create diagram"
    )!;
    act(() => createButton.click());

    expect(onCreate).toHaveBeenCalledWith("detailed");
  });
});
