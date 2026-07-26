// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveRegion } from "./LiveRegion.js";

describe("LiveRegion", () => {
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

  it("renders the message inside a polite, atomic status region by default", () => {
    act(() => root.render(<LiveRegion message="Box added" />));
    const region = container.querySelector('[role="status"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("aria-atomic")).toBe("true");
    expect(region.textContent).toBe("Box added");
  });

  it("supports an assertive politeness level", () => {
    act(() =>
      root.render(
        <LiveRegion message="Export blocked" politeness="assertive" />,
      ),
    );
    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-live"),
    ).toBe("assertive");
  });

  it("is visually hidden but present in the DOM", () => {
    act(() => root.render(<LiveRegion message="Connected A to B" />));
    expect(container.querySelector(".icad-visually-hidden")?.textContent).toBe(
      "Connected A to B",
    );
  });
});
