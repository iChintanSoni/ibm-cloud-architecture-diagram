// @vitest-environment jsdom

import type { IconNodeElement, SceneElement } from "@icad/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorPanel, type InspectorPanelProps } from "./InspectorPanel.js";
import { buildLayerTree } from "./inspectorModel.js";

const elements: SceneElement[] = [
  {
    id: "vpc",
    type: "box",
    semantic: "deployedOn",
    x: 10,
    y: 20,
    w: 300,
    h: 180,
    label: { text: "VPC" },
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
    label: { text: "Application" },
  },
  {
    id: "conn",
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: "vpc", port: "e" },
    to: { elementId: "app", port: "w" },
    connectorType: "tunneling-connection",
    routing: "manual",
    waypoints: [],
  },
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
        dispatchEvent: vi.fn(),
      })),
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
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={onUpdate}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    expect(
      [...container.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["Properties", "Layers", "Frames (0)", "Validation (2)"]);
    expect(container.querySelector("h2")?.textContent).toBe("VPC");

    const label = container.querySelector<HTMLInputElement>(
      "#icad-property-label-vpc",
    )!;
    label.value = "Production VPC";
    act(() =>
      label.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );

    expect(onUpdate).toHaveBeenCalledWith("vpc", {
      label: { text: "Production VPC" },
    });
  });

  it("commits an X/Y/W/H edit from the stepper +/- buttons, not just on blur", () => {
    // Regression test: the stepper buttons already have focus when clicked (they never move focus
    // away from the text input, since it was never focused to begin with), so they never fire the
    // input's onBlur — only NumberInput's own dedicated onClick prop fires for a stepper click.
    // Wiring only onBlur (as this used to) left the displayed number updating with nothing ever
    // committed to the element.
    const onUpdate = vi.fn();

    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={["vpc"]}
          validationCount={0}
          validationContent={<p>Validation content</p>}
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={onUpdate}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    const xInput = container.querySelector<HTMLInputElement>(
      "#icad-property-x-vpc",
    )!;
    const incrementButton = xInput
      .closest(".cds--number")!
      .querySelector<HTMLButtonElement>(".up-icon")!;
    act(() => incrementButton.click());

    expect(onUpdate).toHaveBeenCalledWith("vpc", { x: 11 });
  });

  it("shows IBM's own connector names in the type selector, not the raw kebab-case schema value", () => {
    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={["conn"]}
          validationCount={0}
          validationContent={<p>No issues</p>}
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={vi.fn()}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      "#icad-property-connector-type-conn",
    )!;
    const optionText = [...select.options].map((option) => option.textContent);
    expect(optionText).toContain("Traffic Through Tunnel/Encapsulation");
    expect(optionText).toContain("Logical Connection / Link");
    expect(optionText).not.toContain("tunneling-connection");
    expect(select.value).toBe("tunneling-connection");
  });

  it("commits a connector's sequence badge from the Properties tab on blur", () => {
    const onUpdate = vi.fn();
    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={["conn"]}
          validationCount={0}
          validationContent={<p>No issues</p>}
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={onUpdate}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    const sequence = container.querySelector<HTMLInputElement>(
      "#icad-property-sequence-conn",
    )!;
    sequence.value = "2a";
    act(() =>
      sequence.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );

    expect(onUpdate).toHaveBeenCalledWith("conn", { sequence: "2a" });
  });

  it("labels the annotation name field for a tunnel type, and merges partial edits into the existing annotation", () => {
    const onUpdate = vi.fn();
    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={["conn"]}
          validationCount={0}
          validationContent={<p>No issues</p>}
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={onUpdate}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    // "conn" is a tunneling-connection — the name field reads "Encapsulation name", not
    // "Protocol/Application name".
    const nameField = container.querySelector(
      "#icad-property-annotation-name-conn",
    );
    expect(
      nameField?.closest(".cds--form-item")?.querySelector("label")
        ?.textContent,
    ).toBe("Encapsulation name");

    const port = container.querySelector<HTMLInputElement>(
      "#icad-property-annotation-port-conn",
    )!;
    port.value = "4789";
    act(() =>
      port.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );

    expect(onUpdate).toHaveBeenCalledWith("conn", {
      annotation: { name: "", port: "4789" },
    });
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
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={onSelect}
          onUpdate={vi.fn()}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    const layersTab = [
      ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === "Layers")!;
    act(() => layersTab.click());

    const appLayer = container.querySelector<HTMLElement>(
      '[role="treeitem"][id="app"]',
    )!;
    expect(appLayer.getAttribute("aria-selected")).toBe("true");
    act(() => appLayer.click());
    expect(onSelect).toHaveBeenCalledWith("app");
  });

  it("lists frames in presentation order, jumps on click, and toggles presenting", () => {
    const onJumpToFrame = vi.fn();
    const onTogglePresent = vi.fn();
    const onPresentStep = vi.fn();

    act(() => {
      root.render(
        <InspectorPanel
          elements={elements}
          selectedIds={[]}
          validationCount={0}
          validationContent={<p>No issues</p>}
          frames={[
            {
              id: "frame-2",
              type: "frame",
              semantic: "boundary",
              name: "Second",
              order: 2,
              x: 0,
              y: 0,
              w: 800,
              h: 500,
            },
            {
              id: "frame-1",
              type: "frame",
              semantic: "boundary",
              name: "First",
              order: 1,
              x: 0,
              y: 0,
              w: 800,
              h: 500,
            },
          ]}
          presentingFrameId="frame-1"
          onJumpToFrame={onJumpToFrame}
          onTogglePresent={onTogglePresent}
          onPresentStep={onPresentStep}
          onSelect={vi.fn()}
          onUpdate={vi.fn()}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    const framesTab = [
      ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === "Frames (2)")!;
    act(() => framesTab.click());

    const items = [
      ...container.querySelectorAll<HTMLButtonElement>(".icad-frames__item"),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "1First",
      "2Second",
    ]);
    expect(items[0]?.dataset.active).toBe("true");

    act(() => items[1]?.click());
    expect(onJumpToFrame).toHaveBeenCalledWith("frame-2");

    const presentButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Exit presentation",
    )!;
    act(() => presentButton.click());
    expect(onTogglePresent).toHaveBeenCalled();

    const toolbarButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".icad-frames__toolbar button",
      ),
    ];
    act(() => toolbarButtons[2]?.click()); // [toggle, previous, next]
    expect(onPresentStep).toHaveBeenCalledWith(1);
  });

  it("shows an empty state when there are no frames", () => {
    act(() => {
      root.render(
        <InspectorPanel
          elements={[]}
          selectedIds={[]}
          validationCount={0}
          validationContent={<p>No issues</p>}
          frames={[]}
          onJumpToFrame={vi.fn()}
          onTogglePresent={vi.fn()}
          onPresentStep={vi.fn()}
          onSelect={vi.fn()}
          onUpdate={vi.fn()}
          onReparent={vi.fn()}
          onToggleLockElement={vi.fn()}
          onToggleHideElement={vi.fn()}
        />,
      );
    });

    const framesTab = [
      ...container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === "Frames (0)")!;
    act(() => framesTab.click());

    expect(
      container.querySelector(
        '[role="tabpanel"]:not([hidden]) .icad-inspector__empty h2',
      )?.textContent,
    ).toBe("No frames yet");
  });
});

// ---------------------------------------------------------------------------
// buildLayerTree — row order (M18.5)
// ---------------------------------------------------------------------------

describe("buildLayerTree — descending z-order (M18.5)", () => {
  function icon(id: string, z = 0): IconNodeElement {
    return {
      id,
      type: "iconNode",
      semantic: "node",
      catalogRef: "test/vpc",
      x: 0,
      y: 0,
      w: 48,
      h: 48,
      z,
    };
  }

  it("returns roots in descending z-order (frontmost first)", () => {
    const els = [icon("a", 0), icon("b", 1), icon("c", 2)];
    const tree = buildLayerTree(els);
    expect(tree.map((n) => n.element.id)).toEqual(["c", "b", "a"]);
  });

  it("returns children in descending z-order (frontmost child first)", () => {
    const parent = {
      ...icon("parent", 0),
      type: "box" as const,
      semantic: "deployedOn" as const,
    };
    const childA = { ...icon("child-a", 0), parentId: "parent" };
    const childB = { ...icon("child-b", 1), parentId: "parent" };
    const els = [parent, childA, childB];
    const tree = buildLayerTree(els);
    const parentNode = tree.find((n) => n.element.id === "parent");
    expect(parentNode).toBeDefined();
    expect(parentNode!.children.map((c) => c.element.id)).toEqual([
      "child-b",
      "child-a",
    ]);
  });

  it("a single root element returns a list of length 1", () => {
    const tree = buildLayerTree([icon("only")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.element.id).toBe("only");
  });

  it("empty input returns empty array", () => {
    expect(buildLayerTree([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// InspectorPanel — lock/hide toggle buttons in Layers tab (M18.5)
// ---------------------------------------------------------------------------

function baseInspectorProps(
  overrides: Partial<InspectorPanelProps> = {},
): InspectorPanelProps {
  return {
    elements: [],
    selectedIds: [],
    validationCount: 0,
    validationContent: <></>,
    frames: [],
    onJumpToFrame: vi.fn(),
    onTogglePresent: vi.fn(),
    onPresentStep: vi.fn(),
    onSelect: vi.fn(),
    onUpdate: vi.fn(),
    onReparent: vi.fn(),
    onToggleLockElement: vi.fn(),
    onToggleHideElement: vi.fn(),
    ...overrides,
  };
}

function iconEl(
  id: string,
  opts: { locked?: boolean; hidden?: boolean; z?: number } = {},
): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef: "test/vpc",
    x: 0,
    y: 0,
    w: 48,
    h: 48,
    ...opts,
  };
}

describe("InspectorPanel Layers tab — lock/hide buttons (M18.5)", () => {
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

  /** Switch to the Layers tab by clicking the tab button. */
  function clickLayersTab() {
    const tabs = container.querySelectorAll<HTMLElement>("button[role='tab']");
    const layersTab = [...tabs].find((t) => t.textContent?.trim() === "Layers");
    if (!layersTab) throw new Error("Layers tab button not found");
    act(() => layersTab.click());
  }

  it("renders a hide-toggle button for each element in the Layers tab", () => {
    const el = iconEl("a");
    act(() =>
      root.render(
        <InspectorPanel {...baseInspectorProps({ elements: [el] })} />,
      ),
    );
    clickLayersTab();
    const hideBtn = container.querySelector(
      "button[aria-label='Hide element']",
    );
    expect(hideBtn).toBeTruthy();
  });

  it("renders a lock-toggle button for each element in the Layers tab", () => {
    const el = iconEl("a");
    act(() =>
      root.render(
        <InspectorPanel {...baseInspectorProps({ elements: [el] })} />,
      ),
    );
    clickLayersTab();
    const lockBtn = container.querySelector(
      "button[aria-label='Lock element']",
    );
    expect(lockBtn).toBeTruthy();
  });

  it("calls onToggleHideElement with the element id when the hide button is clicked", () => {
    const onToggleHideElement = vi.fn();
    const el = iconEl("a");
    act(() =>
      root.render(
        <InspectorPanel
          {...baseInspectorProps({ elements: [el], onToggleHideElement })}
        />,
      ),
    );
    clickLayersTab();
    const hideBtn = container.querySelector<HTMLElement>(
      "button[aria-label='Hide element']",
    );
    act(() => hideBtn?.click());
    expect(onToggleHideElement).toHaveBeenCalledWith("a");
  });

  it("calls onToggleLockElement with the element id when the lock button is clicked", () => {
    const onToggleLockElement = vi.fn();
    const el = iconEl("a");
    act(() =>
      root.render(
        <InspectorPanel
          {...baseInspectorProps({ elements: [el], onToggleLockElement })}
        />,
      ),
    );
    clickLayersTab();
    const lockBtn = container.querySelector<HTMLElement>(
      "button[aria-label='Lock element']",
    );
    act(() => lockBtn?.click());
    expect(onToggleLockElement).toHaveBeenCalledWith("a");
  });

  it("shows 'Show element' aria-label for a hidden element", () => {
    const el = iconEl("a", { hidden: true });
    act(() =>
      root.render(
        <InspectorPanel {...baseInspectorProps({ elements: [el] })} />,
      ),
    );
    clickLayersTab();
    const showBtn = container.querySelector(
      "button[aria-label='Show element']",
    );
    expect(showBtn).toBeTruthy();
  });

  it("shows 'Unlock element' aria-label for a locked element", () => {
    const el = iconEl("a", { locked: true });
    act(() =>
      root.render(
        <InspectorPanel {...baseInspectorProps({ elements: [el] })} />,
      ),
    );
    clickLayersTab();
    const unlockBtn = container.querySelector(
      "button[aria-label='Unlock element']",
    );
    expect(unlockBtn).toBeTruthy();
  });
});
