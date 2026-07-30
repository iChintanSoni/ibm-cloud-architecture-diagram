import type { Rect } from "../routing/orthogonalRouter.js";
import { boundsOfElements } from "../scene/bounds.js";
import type { Scene } from "../scene/scene.js";
import type { SvgRenderer } from "../render/svgRenderer.js";
import { ICAD_VERSION, toIcad } from "./icad.js";

export interface SvgExportOptions {
  /** Embeds the full .icad JSON so the file can be reopened and re-edited (docs/03-file-format.md#svg-canonical). Default true. */
  embedSource?: boolean;
}

export interface PngExportOptions {
  scale?: 1 | 2 | 3;
  background?: "transparent" | "white";
}

/** Padding (scene units) around the diagram's own content bounds, so edges/labels flush against
 * an element aren't clipped against the image border. */
const EXPORT_PADDING = 20;
/** Fallback content size (scene units) for an empty scene, so export never produces a 0x0 image. */
const EMPTY_EXPORT_SIZE = { w: 400, h: 300 };

function base64Encode(input: string): string {
  if (typeof Buffer !== "undefined")
    return Buffer.from(input, "utf-8").toString("base64");
  // btoa() only accepts Latin1 text, so UTF-8 bytes have to be remapped to it one at a time —
  // the modern replacement for the deprecated escape/unescape(encodeURIComponent()) hack.
  let binary = "";
  for (const byte of new TextEncoder().encode(input))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Padded bounding box of every element in the scene, independent of the editor's current
 * pan/zoom — export always captures the whole diagram, not just what's currently visible in the
 * viewport (docs/06-editor-ux.md).
 */
function exportBounds(scene: Scene): Rect {
  const bbox = boundsOfElements(scene.all());
  if (!bbox) {
    return { x: 0, y: 0, w: EMPTY_EXPORT_SIZE.w, h: EMPTY_EXPORT_SIZE.h };
  }
  return {
    x: bbox.x - EXPORT_PADDING,
    y: bbox.y - EXPORT_PADDING,
    w: bbox.w + EXPORT_PADDING * 2,
    h: bbox.h + EXPORT_PADDING * 2,
  };
}

/**
 * A standalone SVG clone of the current scene, sized to its own content rather than the live
 * viewBox `applyViewport()` last set (which tracks the editor's current pan/zoom): editor-only
 * chrome (selection/handle overlays, the background grid — both purely canvas UI, not diagram
 * content) is stripped, and the viewBox/width/height are set to `exportBounds()`.
 */
function cloneForExport(
  scene: Scene,
  renderer: SvgRenderer,
): { svg: SVGSVGElement; bounds: Rect; fontFamily: string } {
  renderer.render(scene);
  const clone = renderer.svg.cloneNode(true) as SVGSVGElement;
  // No explicit xmlns setAttribute here: `renderer.svg` is already created via
  // createElementNS(SVG_NS, "svg") (render/dom.ts), so the namespace is already implicit on the
  // clone. A real browser's XMLSerializer dedupes an explicit "xmlns" attribute of the same value
  // against that implicit one, but jsdom's (used by packages/mcp's headless export) does not —
  // it was emitting the attribute twice, producing invalid XML that a strict parser (e.g. a
  // browser opening the exported .svg file directly) refuses to parse at all.
  clone.querySelector('[data-icad-layer="overlays"]')?.remove();
  clone.querySelector("[data-icad-grid]")?.remove();

  // Pin the font stack the live SVG currently inherits from the host page's CSS (Carbon's `body`
  // reset, e.g. "IBM Plex Sans, system-ui, ...") as an explicit attribute: once this clone is
  // detached and serialized to a standalone file, there's no host stylesheet left to cascade it
  // in, so without this every exported <text> silently fell back to the viewer's own default font
  // instead of what was on screen.
  const fontFamily =
    typeof getComputedStyle === "function"
      ? getComputedStyle(renderer.svg).fontFamily
      : "";
  if (fontFamily) clone.setAttribute("font-family", fontFamily);

  const bounds = exportBounds(scene);
  setAttrs(clone, {
    viewBox: `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`,
    width: bounds.w,
    height: bounds.h,
  });

  return { svg: clone, bounds, fontFamily };
}

function setAttrs(el: SVGSVGElement, attrs: Record<string, string | number>) {
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value));
}

const CSS_URL_RE = /url\((['"]?)([^'")]+)\1\)/g;

/** Base64-encodes arbitrary binary data (font bytes) — unlike base64Encode() above, which is only
 * for UTF-8 text, so raw bytes go through String.fromCharCode directly rather than TextEncoder. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // avoids a call-stack overflow from spreading a whole font file at once.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Fetches every url(...) referenced in an @font-face `src` value and inlines it as a base64
 * data: URI, so the exported file is self-contained (docs/03-file-format.md#svg-canonical's
 * "embedded fonts") and renders identically on a machine that doesn't have IBM Plex Sans installed
 * as a system font. Returns undefined if any referenced file can't be fetched (e.g. blocked by a
 * host CSP), so the caller skips that @font-face rule rather than emit one with a broken src. */
async function inlineFontUrls(src: string): Promise<string | undefined> {
  const matches = [...src.matchAll(CSS_URL_RE)];
  if (matches.length === 0) return undefined;
  const dataUrls = await Promise.all(
    matches.map(async (match) => {
      try {
        const rawUrl = match[2];
        if (!rawUrl) return undefined;
        const resolved = new URL(rawUrl, document.baseURI).toString();
        const response = await fetch(resolved);
        if (!response.ok) return undefined;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const mime = response.headers.get("content-type") ?? "font/woff2";
        return `data:${mime};base64,${bytesToBase64(bytes)}`;
      } catch {
        return undefined;
      }
    }),
  );
  if (dataUrls.some((url) => url === undefined)) return undefined;
  let i = 0;
  return src.replace(CSS_URL_RE, () => `url(${dataUrls[i++]})`);
}

/** Collects every @font-face rule (from the host page's own stylesheets — e.g. Carbon's compiled
 * @ibm/plex CSS) whose font-family matches the live SVG's primary font, with its font file(s)
 * inlined as data: URIs. Cross-origin stylesheets throw on `.cssRules` access and are skipped —
 * none of this app's own CSS is cross-origin, so that only ever excludes stylesheets we don't care
 * about anyway. */
async function embeddedFontFaceCss(primaryFamily: string): Promise<string> {
  if (!primaryFamily || typeof document === "undefined") return "";
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(cssRules)) {
      if (
        typeof CSSFontFaceRule !== "undefined" &&
        rule instanceof CSSFontFaceRule &&
        rule.style
          .getPropertyValue("font-family")
          .replace(/^["']|["']$/g, "") === primaryFamily
      ) {
        rules.push(rule);
      }
    }
  }

  const embedded = await Promise.all(
    rules.map(async (rule) => {
      const src = rule.style.getPropertyValue("src");
      const inlined = await inlineFontUrls(src);
      return inlined ? rule.cssText.replace(src, inlined) : undefined;
    }),
  );
  return embedded.filter((css): css is string => Boolean(css)).join("\n");
}

/** Inserts a <style> with embedded @font-face rules into the clone's <defs>, so the exported file
 * renders in IBM Plex Sans even on a machine that doesn't have it installed system-wide. A no-op
 * (leaving only the font-family attribute from cloneForExport) if the font can't be embedded. */
async function embedFonts(
  clone: SVGSVGElement,
  fontFamily: string,
): Promise<void> {
  const primary = fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!primary) return;
  const css = await embeddedFontFaceCss(primary);
  if (!css) return;
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = css;
  (clone.querySelector("defs") ?? clone).prepend(style);
}

/** Exports the current scene as an SVG string, matching IBM's canonical export guidance. */
export async function exportSvg(
  scene: Scene,
  renderer: SvgRenderer,
  opts: SvgExportOptions = {},
): Promise<string> {
  const { svg: clone, fontFamily } = cloneForExport(scene, renderer);
  await embedFonts(clone, fontFamily);

  if (opts.embedSource ?? true) {
    const metadata = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "metadata",
    );
    metadata.setAttribute("id", "icad:source");
    metadata.setAttribute("data-icad-version", String(ICAD_VERSION));
    metadata.textContent = base64Encode(JSON.stringify(toIcad(scene)));
    clone.insertBefore(metadata, clone.firstChild);
  }

  return new XMLSerializer().serializeToString(clone);
}

/** Rasterizes the SVG export to PNG. Requires a browser canvas 2D context. */
export async function exportPng(
  scene: Scene,
  renderer: SvgRenderer,
  opts: PngExportOptions = {},
): Promise<Blob> {
  const scale = opts.scale ?? 1;
  const { svg: clone, bounds, fontFamily } = cloneForExport(scene, renderer);
  await embedFonts(clone, fontFamily);
  // Bake `scale` into the SVG's own pixel dimensions (the viewBox stays in scene units) *before*
  // it's rasterized, so the browser decodes the image at full target resolution directly from the
  // vector source. Leaving width/height at 1x and instead stretching a bigger canvas via
  // ctx.drawImage() would just upscale an already-rasterized 1x bitmap — the previous source of
  // the blur, since an <img>/Image() decodes an SVG source once at its own intrinsic size.
  const pixelWidth = Math.round(bounds.w * scale);
  const pixelHeight = Math.round(bounds.h * scale);
  setAttrs(clone, { width: pixelWidth, height: pixelHeight });

  const svgString = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(
    new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }),
  );

  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error(
        "PNG export requires a 2D canvas context (run in a browser).",
      );
    if (opts.background === "white") {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG export failed")),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load SVG for PNG export"));
    img.src = src;
  });
}
