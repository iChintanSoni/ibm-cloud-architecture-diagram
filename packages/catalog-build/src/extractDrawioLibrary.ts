import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { normalizeIcon, type NormalizedIcon } from "./extract.js";

const GLYPH_VIEWBOX = 20;
const DEFAULT_FLAT_SIZE = 32;
const DRAWABLE_TAGS = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);

interface StencilEntry {
  xml?: string;
  title?: string;
}

export interface ExtractedGroupIcon {
  title: string;
  normalized: NormalizedIcon;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#xa;/gi, "\n")
    .replace(/&amp;/g, "&");
}

// Same document-order caveat as extract.ts's collectInOrder: jsdom's querySelectorAll
// groups matches by selector for a comma-separated list rather than returning them in
// true document order, so shape/color lookups that care about "the first one" walk
// the tree manually instead.
function collectInOrder(root: Element, tags: Set<string>, out: Element[] = []): Element[] {
  for (const child of Array.from(root.children) as Element[]) {
    if (tags.has(child.tagName.toLowerCase())) out.push(child);
    collectInOrder(child, tags, out);
  }
  return out;
}

function hasDirectDrawableChild(el: Element): boolean {
  return Array.from(el.children).some((c) => DRAWABLE_TAGS.has((c as Element).tagName.toLowerCase()));
}

function clearAncestorTransforms(from: Element, root: Element): void {
  let el = from.parentElement as Element | null;
  while (el && el !== root) {
    el.removeAttribute("transform");
    el = el.parentElement as Element | null;
  }
}

function isWhiteOrNone(color: string | null): boolean {
  if (!color) return true;
  const c = color.trim().toLowerCase();
  return c === "none" || c === "white" || c === "#fff" || c === "#ffffff";
}

/**
 * Normalizes a flat, already-colored glyph with its own viewBox (e.g. `0 0 32 32`) — the
 * format most `not_released_in_drawio.xml` glyphs use, unlike the 48x48
 * colored-tile-plus-white-glyph convention `extract.ts#normalizeIcon` expects. There's no
 * background tile to strip and no white glyph to recolor: the artwork is already the
 * final color. This mirrors `reframeGlyph`'s cancelling-ancestor-transform handling
 * (`<g transform="translate(-a,-b)"><g transform="translate(a,b)">...`), just scaled from
 * the SVG's own declared viewBox instead of a hardcoded 24x24 local frame.
 */
function normalizeFlatGlyph(xml: string): NormalizedIcon | undefined {
  const dom = new JSDOM();
  const doc = new dom.window.DOMParser().parseFromString(xml, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return undefined;

  const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  const size = viewBox && viewBox.length === 4 && viewBox[2] ? Math.max(viewBox[2]!, viewBox[3]!) : DEFAULT_FLAT_SIZE;

  const frame = collectInOrder(svg, new Set(["g"])).find(hasDirectDrawableChild);
  if (!frame) return undefined;

  clearAncestorTransforms(frame, svg);
  const scale = GLYPH_VIEWBOX / size;
  frame.setAttribute("transform", `scale(${scale})`);

  // Best-effort accent color for manifest metadata only — not load-bearing for rendering,
  // since (unlike the tile format) there's no single background fill to treat as canonical.
  const firstDrawable = collectInOrder(frame, DRAWABLE_TAGS)[0];
  const rawColor = firstDrawable?.getAttribute("fill");
  const color = !isWhiteOrNone(rawColor ?? null) ? rawColor!.toUpperCase() : undefined;

  const serialized = new dom.window.XMLSerializer().serializeToString(svg);
  const fragment = serialized.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

  return { fragment, rounded: false, ...(color ? { color } : {}) };
}

/**
 * Extracts node glyphs embedded in IBM's "not released in drawio" stencil library
 * (`drawio/stencils/2.0/not_released_in_drawio.xml`, per D23) — an `<mxlibrary>`-wrapped
 * JSON array of drawio shape definitions, each carrying its own icon as a base64
 * `data:image/svg+xml` URI buried inside its HTML-entity-escaped `xml` field. Most entries
 * use the flat-glyph format `normalizeFlatGlyph` handles, but a minority (confirmed: one of
 * the two "Network ACL Rules" stencils) still use the old 48x48 tile format — so
 * `extract.ts#normalizeIcon` is tried first, with `normalizeFlatGlyph` as the fallback.
 *
 * Only titled entries are real stencils (untitled entries are internal/orphan shapes).
 * When the same title repeats (confirmed: "Network ACL Rules" appears twice with different
 * glyph formats), the first occurrence wins — the same convention `build.ts` already uses
 * for duplicate slugs from the plain `svg/` tree.
 */
export function extractDrawioLibraryIcons(xmlPath: string): ExtractedGroupIcon[] {
  const raw = readFileSync(xmlPath, "utf8");
  const match = raw.match(/<mxlibrary[^>]*>(\[[\s\S]*\])\s*<\/mxlibrary>/);
  if (!match) return [];

  const entries = JSON.parse(match[1]!) as StencilEntry[];
  const seenTitles = new Set<string>();
  const out: ExtractedGroupIcon[] = [];

  for (const entry of entries) {
    if (!entry.title || !entry.xml) continue;
    if (seenTitles.has(entry.title)) continue;
    seenTitles.add(entry.title);

    const decodedXml = decodeEntities(entry.xml);
    const imageMatch = decodedXml.match(/image=data:image\/svg\+xml,([^&"]+)/);
    if (!imageMatch) continue;

    const glyphXml = Buffer.from(imageMatch[1]!, "base64").toString("utf8");
    const normalized = normalizeIcon(glyphXml) ?? normalizeFlatGlyph(glyphXml);
    if (!normalized) continue;

    out.push({ title: entry.title, normalized });
  }

  return out;
}
