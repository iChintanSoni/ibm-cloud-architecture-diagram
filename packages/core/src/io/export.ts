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

function base64Encode(input: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(input, "utf-8").toString("base64");
  return btoa(unescape(encodeURIComponent(input)));
}

/** Exports the current scene as an SVG string, matching IBM's canonical export guidance. */
export function exportSvg(scene: Scene, renderer: SvgRenderer, opts: SvgExportOptions = {}): string {
  renderer.render(scene);
  const clone = renderer.svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.querySelector('[data-icad-layer="overlays"]')?.remove();

  if (opts.embedSource ?? true) {
    const metadata = document.createElementNS("http://www.w3.org/2000/svg", "metadata");
    metadata.setAttribute("id", "icad:source");
    metadata.setAttribute("data-icad-version", String(ICAD_VERSION));
    metadata.textContent = base64Encode(JSON.stringify(toIcad(scene)));
    clone.insertBefore(metadata, clone.firstChild);
  }

  return new XMLSerializer().serializeToString(clone);
}

/** Rasterizes the SVG export to PNG. Requires a browser canvas 2D context. */
export async function exportPng(scene: Scene, renderer: SvgRenderer, opts: PngExportOptions = {}): Promise<Blob> {
  const svgString = exportSvg(scene, renderer, { embedSource: false });
  const scale = opts.scale ?? 1;
  const url = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PNG export requires a 2D canvas context (run in a browser).");
    if (opts.background === "white") {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png");
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
