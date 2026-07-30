import { JSDOM } from "jsdom";

// IBM's own glyph occupies a 24x24 local box (D25, docs/00-decision-log.md) — matching
// DEFAULT_LOCAL_SIZE below, so the common case reframes at scale(1) rather than shrinking to fit
// an arbitrary smaller box. packages/core/src/render/svgRenderer.ts's glyph viewBoxes must agree
// with this constant, since both draw the same normalized asset into their own coordinate space.
const GLYPH_VIEWBOX = 24;
const SHAPE_TAGS = new Set(["rect", "polygon"]);
const DRAWABLE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
]);

// IBM's exports don't declare a glyph bounding box explicitly; most wrap the glyph in
// a `<g transform="translate(12, 12)">`-ish group sized so a `_Transparent_Rectangle_`
// hit-area rect (usually 24x24) sits at local (0,0). A minority bake that ~12,12 offset
// directly into the path coordinates instead of expressing it as a transform — those
// need an explicit compensating translate rather than relying on the (near-zero) transform
// their wrapper actually carries. See extract.test.ts for a case of each shape.
const DEFAULT_LOCAL_SIZE = 24;
const DEFAULT_OFFSET = 12;
const REAL_OFFSET_THRESHOLD = 5;

export interface NormalizedIcon {
  /** SVG fragment (no outer <svg>), scaled into a 0..24 viewBox (GLYPH_VIEWBOX), ready to inline. */
  fragment: string;
  /** Accent color extracted from the icon's background tile, if any. */
  color?: string;
  /** True when the background tile is a full circle/pill (rx present) — actor-style. */
  rounded: boolean;
}

// jsdom's querySelectorAll does not return matches for a comma-separated selector
// list in document order (it groups by selector) — walk manually instead, since the
// *first* canvas-covering shape in true document order is always the background tile.
function collectInOrder(
  root: Element,
  tags: Set<string>,
  out: Element[] = [],
): Element[] {
  for (const child of Array.from(root.children) as Element[]) {
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

function hasDirectDrawableChild(el: Element): boolean {
  return Array.from(el.children).some((c) =>
    DRAWABLE_TAGS.has((c as Element).tagName.toLowerCase()),
  );
}

function parseTranslate(
  transform: string | null,
): { x: number; y: number } | undefined {
  const m = transform?.match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/);
  if (!m) return undefined;
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
}

// Every ancestor between `frame` and the icon's outer style group exists only to
// position content within the original 48x48 Sketch/Figma artboard (often as a
// translate(-a,-b)/translate(a,b) pair that cancels to zero). Once `frame` gets its
// own self-contained transform into the 0..20 space, those ancestor transforms are
// meaningless — and if `frame` itself was one half of a cancelling pair (see
// object-storage-application, where the hit-area rect's parent *is* that half),
// leaving the other half in place would shift the glyph off-canvas entirely.
function clearAncestorTransforms(from: Element, root: Element): void {
  let el = from.parentElement as Element | null;
  while (el && el !== root) {
    el.removeAttribute("transform");
    el = el.parentElement as Element | null;
  }
}

/**
 * Re-frames the glyph so it fills the 0..24 viewBox (GLYPH_VIEWBOX) core's renderer expects,
 * replacing whatever transform positioned it inside the original 48x48 canvas. Returns false if
 * no glyph content was found at all (a background-only tile with nothing drawn on top of it) —
 * a genuine upstream artifact, not a valid icon (see e.g. Compute/Process.svg, which — unlike its
 * "Process Green"/"Process Gray" siblings — is just the colored tile with no glyph behind it).
 */
function reframeGlyph(svg: Element): boolean {
  const hitbox = collectInOrder(svg, new Set(["rect"])).find(
    isTransparentHitbox,
  );

  let frame: Element | undefined;
  let localSize = DEFAULT_LOCAL_SIZE;
  let offset = { x: 0, y: 0 };

  if (hitbox) {
    frame = hitbox.parentElement as Element | undefined;
    localSize = parseFloat(
      hitbox.getAttribute("width") ?? String(DEFAULT_LOCAL_SIZE),
    );
    // Usually (0,0), but not always — e.g. object-storage-application's hit-area
    // rect sits at (12,12) within its (untransformed) parent.
    offset = {
      x: parseFloat(hitbox.getAttribute("x") ?? "0"),
      y: parseFloat(hitbox.getAttribute("y") ?? "0"),
    };
    hitbox.remove();
  } else {
    frame = collectInOrder(svg, new Set(["g"])).find(hasDirectDrawableChild);
    if (frame) {
      const t = parseTranslate(frame.getAttribute("transform"));
      const isRealOffset =
        !!t &&
        (Math.abs(t.x) > REAL_OFFSET_THRESHOLD ||
          Math.abs(t.y) > REAL_OFFSET_THRESHOLD);
      if (!isRealOffset) offset = { x: DEFAULT_OFFSET, y: DEFAULT_OFFSET };
    }
  }

  if (!frame) return false; // no glyph content left (e.g. a flat color tile with no artwork)

  clearAncestorTransforms(frame, svg);
  const scale = GLYPH_VIEWBOX / localSize;
  frame.setAttribute(
    "transform",
    offset.x || offset.y
      ? `scale(${scale}) translate(${-offset.x}, ${-offset.y})`
      : `scale(${scale})`,
  );
  return true;
}

/**
 * Converts one upstream IBM icon SVG (48x48 canvas: a colored background tile plus a white
 * glyph) into a 24x24 white glyph fragment, plus the tile's own accent color as separate
 * metadata. The glyph is deliberately left white rather than recolored — per D25
 * (docs/00-decision-log.md), ICAD's renderer paints the solid category tile (or, for a rounded/
 * actor tile, a solid circle) behind the glyph itself, matching how IBM's own icon is
 * constructed, rather than inlining a colored glyph onto a white host container.
 *
 * Returns undefined for files with no detectable background tile, or a background tile with no
 * glyph drawn on top of it at all — both are non-icon artifacts, not valid icons.
 */
export function normalizeIcon(xml: string): NormalizedIcon | undefined {
  const dom = new JSDOM();
  const doc = new dom.window.DOMParser().parseFromString(xml, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return undefined;

  const shapesInOrder = collectInOrder(svg, SHAPE_TAGS);
  const bg = shapesInOrder.find(isCanvasCovering);
  if (!bg) return undefined;

  const rawColor =
    bg.getAttribute("fill") ??
    bg.parentElement?.getAttribute("fill") ??
    undefined;
  const rounded =
    !!bg.getAttribute("rx") && parseFloat(bg.getAttribute("rx")!) > 0;

  const bgWrapper = bg.parentElement as Element | null;
  bg.remove();
  // Sketch/Figma exports sometimes wrap the background in a `<g fill="...">` that has
  // no other purpose; drop it once it's empty so it doesn't linger in the fragment.
  if (bgWrapper && bgWrapper !== svg && bgWrapper.children.length === 0) {
    bgWrapper.remove();
  }

  if (!reframeGlyph(svg)) return undefined;

  const color =
    rawColor && !isWhite(rawColor) ? rawColor.toUpperCase() : undefined;

  // Serialize the whole <svg> (so it emits exactly one xmlns declaration) and strip
  // the outer tag, rather than serializing each child separately — which would force
  // a redundant xmlns onto every top-level child.
  const serialized = new dom.window.XMLSerializer().serializeToString(svg);
  const fragment = serialized
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");

  return {
    fragment,
    rounded,
    ...(color ? { color } : {}),
  };
}
