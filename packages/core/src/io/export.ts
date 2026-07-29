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
  return btoa(unescape(encodeURIComponent(input)));
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
): { svg: SVGSVGElement; bounds: Rect } {
  renderer.render(scene);
  const clone = renderer.svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.querySelector('[data-icad-layer="overlays"]')?.remove();
  clone.querySelector("[data-icad-grid]")?.remove();

  const bounds = exportBounds(scene);
  setAttrs(clone, {
    viewBox: `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`,
    width: bounds.w,
    height: bounds.h,
  });

  return { svg: clone, bounds };
}

function setAttrs(el: SVGSVGElement, attrs: Record<string, string | number>) {
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value));
}

/** Exports the current scene as an SVG string, matching IBM's canonical export guidance. */
export function exportSvg(
  scene: Scene,
  renderer: SvgRenderer,
  opts: SvgExportOptions = {},
): string {
  const { svg: clone } = cloneForExport(scene, renderer);

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
  const { svg: clone, bounds } = cloneForExport(scene, renderer);
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
