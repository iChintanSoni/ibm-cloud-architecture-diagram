export const SVG_NS = "http://www.w3.org/2000/svg";

export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

export function setAttrs(el: SVGElement, attrs: Record<string, string | number | undefined>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    el.setAttribute(key, String(value));
  }
}
