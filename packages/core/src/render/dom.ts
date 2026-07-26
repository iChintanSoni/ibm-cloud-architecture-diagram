import type { Point } from "./port.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

export function setAttrs(
  el: SVGElement,
  attrs: Record<string, string | number | undefined>,
): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    el.setAttribute(key, String(value));
  }
}

/**
 * Converts a client-space (mouse/pointer event) coordinate into the SVG's own scene-space
 * coordinate system, accounting for the current pan/zoom viewBox. Pure SVG DOM math, no
 * framework dependency — moved here from a shell-local `placement.ts` (previously duplicated
 * identically in `apps/web` and `apps/vscode`) so `CanvasController` can use it internally too.
 */
export function clientPointToCanvas(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}
