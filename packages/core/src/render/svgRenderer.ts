import type { Catalog } from "../catalog/catalog.js";
import type { Scene } from "../scene/scene.js";
import type { SceneElement } from "../scene/types.js";
import { createSvgElement, setAttrs } from "./dom.js";
import { portPoint } from "./port.js";

const ICON_CONTAINER = 48;
const ICON_GLYPH = 20;
const ICON_OFFSET = (ICON_CONTAINER - ICON_GLYPH) / 2;

export type ResolvedTheme = "light" | "dark";

interface Palette {
  stroke: string;
  zone: string;
  frame: string;
}

const PALETTES: Record<ResolvedTheme, Palette> = {
  light: { stroke: "#161616", zone: "#8d8d8d", frame: "#a8a8a8" },
  dark: { stroke: "#f4f4f4", zone: "#a8a8a8", frame: "#6f6f6f" }
};

/**
 * Renders a Scene to a live SVG DOM tree (docs/02-architecture.md#rendering-svg-dom).
 * Reconciliation is keyed by element id: existing nodes are updated in place,
 * stale nodes (removed from the scene) are dropped. Stroke/text colors follow
 * the resolved light/dark theme (docs/06-editor-ux.md#themes); icon containers
 * stay white-on-black per the IBM icon spec regardless of theme.
 */
export class SvgRenderer {
  readonly svg: SVGSVGElement;
  private layer: SVGGElement;
  private nodes = new Map<string, SVGElement>();
  private arrowHead: SVGPathElement;
  private palette: Palette;

  constructor(
    private container: HTMLElement,
    private catalog: Catalog,
    theme: ResolvedTheme = "light"
  ) {
    this.palette = PALETTES[theme];

    this.svg = createSvgElement("svg");
    setAttrs(this.svg, { width: "100%", height: "100%" });
    this.svg.setAttribute("data-icad-root", "true");

    const defs = createSvgElement("defs");
    const marker = createSvgElement("marker");
    setAttrs(marker, {
      id: "icad-arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse"
    });
    this.arrowHead = createSvgElement("path");
    setAttrs(this.arrowHead, { d: "M0,0 L10,5 L0,10 z", fill: this.palette.stroke });
    marker.appendChild(this.arrowHead);
    defs.appendChild(marker);
    this.svg.appendChild(defs);

    this.layer = createSvgElement("g");
    this.layer.setAttribute("data-icad-layer", "elements");
    this.svg.appendChild(this.layer);

    this.container.appendChild(this.svg);
  }

  /** Updates the resolved theme; call render(scene) afterwards to repaint. */
  setTheme(theme: ResolvedTheme): void {
    this.palette = PALETTES[theme];
    this.arrowHead.setAttribute("fill", this.palette.stroke);
  }

  render(scene: Scene): void {
    const elements = scene.all();
    const seen = new Set<string>();

    for (const el of elements) {
      seen.add(el.id);
      const node = this.renderElement(el, scene);
      if (!this.nodes.has(el.id)) {
        this.layer.appendChild(node);
      }
      this.nodes.set(el.id, node);
    }

    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
  }

  nodeFor(id: string): SVGElement | undefined {
    return this.nodes.get(id);
  }

  destroy(): void {
    this.svg.remove();
    this.nodes.clear();
  }

  private renderElement(el: SceneElement, scene: Scene): SVGElement {
    const existing = this.nodes.get(el.id);
    const g = (existing as SVGGElement) ?? createSvgElement("g");
    g.setAttribute("data-icad-id", el.id);
    g.setAttribute("data-icad-type", el.type);
    g.innerHTML = "";

    switch (el.type) {
      case "box":
        g.appendChild(this.rect(el, { stroke: this.palette.stroke, dashed: false }));
        break;
      case "group":
        g.appendChild(this.rect(el, { stroke: this.palette.stroke, dashed: true }));
        break;
      case "zone":
        g.appendChild(this.rect(el, { stroke: this.palette.zone, dashed: true, strokeWidth: 2 }));
        break;
      case "frame":
        g.appendChild(this.rect(el, { stroke: this.palette.frame, dashed: true, strokeWidth: 1 }));
        break;
      case "actor": {
        const rect = this.rect(el, { stroke: this.palette.stroke, dashed: false });
        rect.setAttribute("rx", String(el.h / 2));
        rect.setAttribute("ry", String(el.h / 2));
        g.appendChild(rect);
        if (el.catalogRef) g.appendChild(this.iconGlyph(el));
        break;
      }
      case "iconNode": {
        // White fill + dark outline is part of the IBM icon spec itself
        // (docs/05-ibm-spec-conformance.md), not theme-dependent.
        const rect = createSvgElement("rect");
        setAttrs(rect, {
          x: el.x,
          y: el.y,
          width: ICON_CONTAINER,
          height: ICON_CONTAINER,
          fill: "white",
          stroke: "#161616",
          "stroke-width": 1
        });
        g.appendChild(rect);
        g.appendChild(this.iconGlyph(el));
        break;
      }
      case "text": {
        const text = createSvgElement("text");
        setAttrs(text, { x: el.x, y: el.y, fill: this.palette.stroke });
        text.textContent = el.text;
        g.appendChild(text);
        break;
      }
      case "connector": {
        g.appendChild(this.connectorPath(el, scene));
        break;
      }
    }

    if ("label" in el && el.label?.text && el.type !== "text") {
      g.appendChild(this.labelText(el));
    }

    return g;
  }

  private rect(
    el: SceneElement,
    opts: { stroke: string; dashed: boolean; strokeWidth?: number }
  ): SVGRectElement {
    const rect = createSvgElement("rect");
    setAttrs(rect, {
      x: el.x,
      y: el.y,
      width: el.w,
      height: el.h,
      fill: el.style?.fill ?? "none",
      stroke: el.style?.stroke ?? opts.stroke,
      "stroke-width": el.style?.strokeWidth ?? opts.strokeWidth ?? 1,
      "stroke-dasharray": opts.dashed ? "6 4" : undefined
    });
    return rect;
  }

  private iconGlyph(el: SceneElement & { catalogRef?: string }): SVGSVGElement {
    const nested = createSvgElement("svg");
    setAttrs(nested, {
      x: el.x + ICON_OFFSET,
      y: el.y + ICON_OFFSET,
      width: ICON_GLYPH,
      height: ICON_GLYPH,
      viewBox: `0 0 ${ICON_GLYPH} ${ICON_GLYPH}`
    });
    const fragment = el.catalogRef ? this.catalog.svg(el.catalogRef) : undefined;
    nested.innerHTML = fragment ?? "";
    return nested;
  }

  private labelText(el: SceneElement): SVGTextElement {
    const text = createSvgElement("text");
    const position = el.label?.position ?? "s";
    const point = { x: el.x + el.w / 2, y: position === "s" ? el.y + el.h + 14 : el.y - 6 };
    setAttrs(text, { x: point.x, y: point.y, fill: this.palette.stroke, "text-anchor": "middle" });
    text.textContent = el.label?.text ?? "";
    return text;
  }

  private connectorPath(
    el: Extract<SceneElement, { type: "connector" }>,
    scene: Scene
  ): SVGPolylineElement {
    const fromEl = scene.get(el.from.elementId);
    const toEl = scene.get(el.to.elementId);
    const start = fromEl ? portPoint(fromEl, el.from.port) : { x: el.x, y: el.y };
    const end = toEl ? portPoint(toEl, el.to.port) : { x: el.x + el.w, y: el.y + el.h };
    const points = [start, ...(el.waypoints ?? []), end].map((p) => `${p.x},${p.y}`).join(" ");

    const line = createSvgElement("polyline");
    setAttrs(line, {
      points,
      fill: "none",
      stroke: el.style?.stroke ?? this.palette.stroke,
      "stroke-width": el.style?.strokeWidth ?? 1.5,
      "stroke-dasharray": el.connectorType === "dependency" ? "4 3" : undefined,
      "marker-end": "url(#icad-arrow)"
    });
    return line;
  }
}
