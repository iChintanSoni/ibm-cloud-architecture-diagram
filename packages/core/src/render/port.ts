import type { PortSide, SceneElement } from "../scene/types.js";

export interface Point {
  x: number;
  y: number;
}

/** Resolves a named port on an element's bounding box to a canvas point.
 * When the element has a non-zero `rotation`, the port's unrotated position is rotated about
 * the element's center to match the rendered location (M20, docs/10-canvas-parity-plan.md).
 */
export function portPoint(el: SceneElement, side: PortSide): Point {
  const { x, y, w, h } = el;
  const unrotated = ((): Point => {
    switch (side) {
      case "n":
        return { x: x + w / 2, y };
      case "s":
        return { x: x + w / 2, y: y + h };
      case "e":
        return { x: x + w, y: y + h / 2 };
      case "w":
        return { x, y: y + h / 2 };
      case "center":
        return { x: x + w / 2, y: y + h / 2 };
      default:
        // Invalid values can enter via hand-edited .icad JSON; the linter will
        // report them, while rendering remains resilient at the element center.
        return { x: x + w / 2, y: y + h / 2 };
    }
  })();
  if (!el.rotation) return unrotated;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = unrotated.x - cx;
  const dy = unrotated.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Point at a fraction `t` (0..1) along a polyline's total length — used to place a connector's
 * own label/annotation/cardinality/sequence-badge at its visual midpoint (svgRenderer.ts), and by
 * routeConnector.ts's connectorLabelRectsFor to derive where an *already-routed* connector's own
 * text sits, so a connector currently being routed can treat it as a soft obstacle. Lives here
 * (not in svgRenderer.ts, where it originated) so routing/ can depend on this small point-geometry
 * module without depending on the much heavier render/svgRenderer.ts, which itself depends on
 * routing/routeConnector.ts — that direction would be a circular import.
 */
export function pointAtFraction(points: Point[], t: number): Point {
  const segments = points.slice(0, -1).map((p, i) => {
    const q = points[i + 1]!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  const total = segments.reduce((a, b) => a + b, 0);
  if (total === 0) return points[0]!;
  let remaining = total * Math.min(1, Math.max(0, t));
  for (let i = 0; i < segments.length; i += 1) {
    const len = segments[i]!;
    if (remaining <= len || i === segments.length - 1) {
      const ratio = len === 0 ? 0 : remaining / len;
      const p = points[i]!;
      const q = points[i + 1]!;
      return { x: p.x + (q.x - p.x) * ratio, y: p.y + (q.y - p.y) * ratio };
    }
    remaining -= len;
  }
  return points[0]!;
}
