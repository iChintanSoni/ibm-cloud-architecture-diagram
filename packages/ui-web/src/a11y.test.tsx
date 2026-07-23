// @vitest-environment jsdom

import { Catalog, type CatalogManifest } from "@icad/core";
import axe from "axe-core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette.js";
import { FindBar } from "./FindBar.js";
import { InspectorPanel } from "./InspectorPanel.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { NewDiagramDialog } from "./NewDiagramDialog.js";
import { TopBar, type TopBarProps } from "./TopBar.js";

/**
 * jsdom has no layout engine, so visual/layout-dependent rules (contrast,
 * target size, ...) can't be evaluated reliably here — those need a real
 * browser (docs/07-accessibility.md#testing--ci, tracked for M8.2's
 * Playwright + axe-core pass). Everything else — landmarks, labels, roles,
 * ARIA validity, duplicate ids — runs for real and must stay clean.
 */
const JSDOM_INCOMPATIBLE_RULES = ["color-contrast", "target-size"];

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: Object.fromEntries(JSDOM_INCOMPATIBLE_RULES.map((id) => [id, { enabled: false }]))
  });
  if (results.violations.length > 0) {
    const report = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
      .join("\n");
    throw new Error(`Accessibility violations:\n${report}`);
  }
}

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "a11y-fixtures",
    version: "1",
    categories: [{ id: "network", name: "Network" }],
    icons: [
      {
        id: "test/vpc",
        name: "Virtual Private Cloud",
        category: "network",
        semantic: "node",
        container: "square",
        asset: "vpc",
        keywords: ["vpc"],
        tier: "ibm-cloud"
      }
    ]
  };
  return new Catalog(manifest, new Map([["vpc", "<rect />"]]));
}

function topBarProps(): TopBarProps {
  return {
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onExport: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: true,
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
    onThemeChange: vi.fn()
  };
}

describe("accessibility smoke test (axe-core)", () => {
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

  it("TopBar has no structural a11y violations", async () => {
    act(() => root.render(<TopBar {...topBarProps()} />));
    await expectNoViolations(container);
  });

  it("LibraryPanel has no structural a11y violations", async () => {
    act(() => root.render(<LibraryPanel catalog={testCatalog()} onChoose={vi.fn()} />));
    await expectNoViolations(container);
  });

  it("InspectorPanel has no structural a11y violations", async () => {
    act(() =>
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
        />
      )
    );
    await expectNoViolations(container);
  });

  it("NewDiagramDialog has no structural a11y violations", async () => {
    act(() =>
      root.render(
        <NewDiagramDialog open hasExistingContent={false} onClose={vi.fn()} onCreate={vi.fn()} />
      )
    );
    await expectNoViolations(container);
  });

  it("CommandPalette has no structural a11y violations", async () => {
    act(() =>
      root.render(
        <CommandPalette
          open
          commands={[
            { id: "a", label: "New diagram", category: "File", run: vi.fn() },
            { id: "b", label: "Undo", category: "Edit", run: vi.fn() }
          ]}
          onClose={vi.fn()}
        />
      )
    );
    await expectNoViolations(container);
  });

  it("FindBar has no structural a11y violations", async () => {
    act(() =>
      root.render(
        <FindBar
          open
          query="server"
          matches={[{ id: "a", label: "Server", type: "iconNode", kind: "element" }]}
          activeIndex={0}
          onQueryChange={vi.fn()}
          onNext={vi.fn()}
          onPrevious={vi.fn()}
          onClose={vi.fn()}
        />
      )
    );
    await expectNoViolations(container);
  });
});
