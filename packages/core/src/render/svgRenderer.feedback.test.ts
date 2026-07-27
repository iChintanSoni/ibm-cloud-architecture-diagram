import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import type { SnapGuide } from "../interaction/snapping.js";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { SvgRenderer } from "./svgRenderer.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "fixtures",
    version: "1",
    categories: [],
    icons: [],
  };
  return new Catalog(manifest, new Map());
}

function box(id: string, x: number, y: number): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y,
    w: 100,
    h: 60,
    label: { text: id },
  };
}

describe("SvgRenderer feedback layer (M17.2, docs/10-canvas-parity-plan.md)", () => {
  let container: HTMLDivElement;
  let scene: Scene;
  let renderer: SvgRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    scene = new Scene();
    renderer = new SvgRenderer(container, testCatalog(), "light");
  });

  describe("background grid", () => {
    it("renders visible by default, tiled at the scene's own grid spacing", () => {
      renderer.render(scene);
      const rect = container.querySelector('rect[fill^="url(#"]')!;
      expect(rect).not.toBeNull();
      expect((rect as SVGRectElement).style.display).not.toBe("none");

      const pattern = container.querySelector("pattern")!;
      expect(pattern.getAttribute("width")).toBe(String(scene.canvas.grid));
      expect(pattern.getAttribute("height")).toBe(String(scene.canvas.grid));
    });

    it("toggles visibility via setGridVisible without needing a re-render", () => {
      renderer.render(scene);
      const rect = container.querySelector(
        'rect[fill^="url(#"]',
      ) as SVGRectElement;

      renderer.setGridVisible(false);
      expect(rect.style.display).toBe("none");

      renderer.setGridVisible(true);
      expect(rect.style.display).not.toBe("none");
    });

    it("sits behind every diagram element and never intercepts pointer events", () => {
      scene._put(box("a", 0, 0));
      renderer.render(scene);
      const rect = container.querySelector('rect[fill^="url(#"]')!;
      const elementsLayer = container.querySelector(
        '[data-icad-layer="elements"]',
      )!;
      // Grid comes before the elements layer in document order, so it paints underneath.
      expect(
        rect.compareDocumentPosition(elementsLayer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(rect.getAttribute("pointer-events")).toBe("none");
    });

    it("recolors immediately on theme change, with no render() call required", () => {
      const pattern = container.querySelector("pattern")!;
      const path = pattern.querySelector("path")!;
      const lightStroke = path.getAttribute("stroke");

      renderer.setTheme("dark");
      const darkStroke = path.getAttribute("stroke");

      expect(darkStroke).not.toBe(lightStroke);
    });

    it("re-tiles if a loaded document's own grid spacing differs", () => {
      const custom = new Scene({ canvas: { grid: 16 } });
      renderer.render(custom);
      const pattern = container.querySelector("pattern")!;
      expect(pattern.getAttribute("width")).toBe("16");
    });
  });

  describe("alignment guides", () => {
    it("renders and clears guide lines in the overlay layer", () => {
      const guides: SnapGuide[] = [
        { orientation: "vertical", position: 40, start: 0, end: 100 },
        { orientation: "horizontal", position: 20, start: 0, end: 100 },
      ];
      renderer.render(scene);
      renderer.setSnapGuides(guides);

      const lines = [
        ...container.querySelectorAll('[data-icad-layer="overlays"] line'),
      ];
      expect(lines).toHaveLength(2);
      const vertical = lines.find((l) => l.getAttribute("x1") === "40")!;
      expect(vertical.getAttribute("x2")).toBe("40");
      expect(vertical.getAttribute("y1")).toBe("0");
      expect(vertical.getAttribute("y2")).toBe("100");

      renderer.setSnapGuides([]);
      expect(
        container.querySelectorAll('[data-icad-layer="overlays"] line'),
      ).toHaveLength(0);
    });
  });

  describe("live gesture readout", () => {
    it("renders and clears a position/dimension HUD label", () => {
      renderer.render(scene);
      renderer.setGestureReadout({ text: "120, 84", at: { x: 120, y: 84 } });

      const readout = container.querySelector("[data-icad-gesture-readout]")!;
      expect(readout).not.toBeNull();
      expect(readout.querySelector("text")?.textContent).toBe("120, 84");

      renderer.setGestureReadout(undefined);
      expect(container.querySelector("[data-icad-gesture-readout]")).toBeNull();
    });
  });
});
