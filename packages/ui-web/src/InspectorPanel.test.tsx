// @vitest-environment jsdom

import type { SceneElement } from "@icad/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorPanel } from "./InspectorPanel.js";

const elements: SceneElement[] = [
  {
    id: "vpc",
    type: "box",
    semantic: "deployedOn",
    x: 10,
    y: 20,
    w: 300,
    h: 180,
    label: { text: "VPC" }
  },
  {
    id: "app",
    type: "iconNode",
    semantic: "node",
    catalogRef: "ibm-cloud/virtual-server",
    parentId: "vpc",
    x: 40,
    y: 60,
    w: 48,
    h: 48,
    label: { text: "Application" }
  }
];

describe("InspectorPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders all inspector views and commits property edits on blur", () => {
    const onUpdate = vi.fn();

    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={["vpc"]}
          validationCount={2}
          validationContent={<p>Validation content</p>}
          onSelect={vi.fn()}
          onUpdate={onUpdate}
          onReparent={vi.fn()}
        />
      );
    });

    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "Properties",
      "Layers",
      "Validation (2)"
    ]);
    expect(container.querySelector("h2")?.textContent).toBe("VPC");

    const label = container.querySelector<HTMLInputElement>("#icad-property-label-vpc")!;
    label.value = "Production VPC";
    act(() => label.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

    expect(onUpdate).toHaveBeenCalledWith("vpc", { label: { text: "Production VPC" } });
  });

  it("shows nested layers, reflects selection, and selects a layer row", () => {
    const onSelect = vi.fn();

    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={["app"]}
          validationCount={0}
          validationContent={<p>No issues</p>}
          onSelect={onSelect}
          onUpdate={vi.fn()}
          onReparent={vi.fn()}
        />
      );
    });

    const layersTab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (tab) => tab.textContent === "Layers"
    )!;
    act(() => layersTab.click());

    const appLayer = container.querySelector<HTMLElement>('[role="treeitem"][id="app"]')!;
    expect(appLayer.getAttribute("aria-selected")).toBe("true");
    act(() => appLayer.click());
    expect(onSelect).toHaveBeenCalledWith("app");
  });
});
