import { JSDOM } from "jsdom";

const GLYPH_VIEWBOX = 20;
const SOURCE_CANVAS = 48;
const SCALE = GLYPH_VIEWBOX / SOURCE_CANVAS;
const SHAPE_TAGS = new Set(["rect", "polygon"]);

export interface NormalizedIcon {
  /** SVG fragment (no outer <svg>), scaled into a 0..20 viewBox, ready to inline. */
  fragment: string;
  /** Accent color extracted from the icon's background tile, if any. */
  color?: string;
  /** True when the background tile is a full circle/pill (rx present) — actor-style. */
  rounded: boolean;
}

// jsdom's querySelectorAll does not return matches for a comma-separated selector
// list in document order (it groups by selector) — walk manually instead, since the
// *first* canvas-covering shape in true document order is always the background tile.
function collectInOrder(root: Element, tags: Set<string>, out: Element[] = []): Element[] {
  for (const child of Array.from(root.children)) {
    if (tags.has(child.tagName.toLowerCase())) out.push(child);
    collectInOrder(child, tags, out);
  }
  return out;
}

function isCanvasCovering(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "rect") {
    const w = parseFloat(el.getAttribute("width") ?? "0");
    const h = parseFloat(el.getAttribute("height") ?? "0");
    const x = parseFloat(el.getAttribute("x") ?? "0");
    const y = parseFloat(el.getAttribute("y") ?? "0");
    return w >= 46 && h >= 46 && x <= 1 && y <= 1;
  }
  if (tag === "polygon") {
    const nums = (el.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length < 8) return false;
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return maxX - minX >= 46 && maxY - minY >= 46 && minX <= 1 && minY <= 1;
  }
  return false;
}

function isWhite(color: string | null): boolean {
  if (!color) return false;
  const c = color.trim().toLowerCase();
  return c === "white" || c === "#fff" || c === "#ffffff";
}

// These invisible hit-area rects carry no fill/stroke; stripping them is cosmetic only.
function isTransparentHitbox(el: Element): boolean {
  const id = el.getAttribute("id") ?? "";
  return /transparent_rectangle/i.test(id);
}

function recolorWhite(root: Element, accent: string): void {
  for (const el of Array.from(root.querySelectorAll("*")) as Element[]) {
    for (const attr of ["fill", "stroke"]) {
      if (isWhite(el.getAttribute(attr))) el.setAttribute(attr, accent);
    }
  }
}

/**
 * Converts one upstream IBM icon SVG (48x48 container, colored tile + white glyph)
 * into a 20x20 glyph fragment recolored to render on ICAD's white icon container
 * (packages/core/src/render/svgRenderer.ts always draws a white 48x48 box).
 *
 * Returns undefined for files with no detectable background tile (non-icon artifacts).
 */
export function normalizeIcon(xml: string): NormalizedIcon | undefined {
  const dom = new JSDOM();
  const doc = new dom.window.DOMParser().parseFromString(xml, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return undefined;

  const shapesInOrder = collectInOrder(svg, SHAPE_TAGS);
  const bg = shapesInOrder.find(isCanvasCovering);
  if (!bg) return undefined;

  const rawColor = bg.getAttribute("fill") ?? bg.parentElement?.getAttribute("fill") ?? undefined;
  const rounded = !!bg.getAttribute("rx") && parseFloat(bg.getAttribute("rx")!) > 0;

  const bgWrapper = bg.parentElement as Element | null;
  bg.remove();
  // Sketch/Figma exports sometimes wrap the background in a `<g fill="...">` that has
  // no other purpose; drop it once it's empty so it doesn't linger in the fragment.
  if (bgWrapper && bgWrapper !== svg && bgWrapper.children.length === 0) {
    bgWrapper.remove();
  }

  const allElements = Array.from(svg.querySelectorAll("*")) as Element[];
  for (const hitbox of allElements.filter(isTransparentHitbox)) {
    hitbox.remove();
  }

  const color = rawColor && !isWhite(rawColor) ? rawColor.toUpperCase() : undefined;
  if (color) recolorWhite(svg, color);

  // Serialize the whole <svg> (so it emits exactly one xmlns declaration) and strip
  // the outer tag, rather than serializing each child separately — which would force
  // a redundant xmlns onto every top-level child.
  const serialized = new dom.window.XMLSerializer().serializeToString(svg);
  const inner = serialized.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

  return {
    fragment: `<g transform="scale(${SCALE})">${inner}</g>`,
    rounded,
    ...(color ? { color } : {})
  };
}
