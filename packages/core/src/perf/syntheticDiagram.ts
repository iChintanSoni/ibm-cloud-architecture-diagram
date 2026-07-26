import { ICAD_FORMAT, ICAD_VERSION, type IcadDocument } from "../io/icad.js";
import { portPoint } from "../render/port.js";
import type { CatalogManifest } from "../catalog/types.js";
import type {
  BoxElement,
  ConnectorElement,
  ElementId,
  IconNodeElement,
  SceneElement,
} from "../scene/types.js";

/**
 * Minimal one-icon catalog for the synthetic diagrams below — a real bundled catalog would work
 * identically for benchmark purposes (only `resolve()`'s color lookup matters to the renderer),
 * but pulling one in would give `packages/core` a build-time dependency on `packages/catalog` it
 * doesn't otherwise have (docs/00-decision-log.md — shells inject the catalog, core never imports it).
 */
export const SYNTHETIC_CATALOG: CatalogManifest = {
  id: "bench-catalog",
  version: "0.0.1",
  categories: [{ id: "compute", name: "Compute" }],
  icons: [
    {
      id: "bench/vm",
      name: "Virtual server",
      category: "compute",
      semantic: "node",
      container: "square",
      color: "#0f62fe",
      asset: "vm",
      tier: "ibm-cloud",
    },
  ],
};

export const SYNTHETIC_ASSETS = new Map([
  ["vm", '<rect width="24" height="24" fill="#ffffff" />'],
]);

const ICONS_PER_CONTAINER = 8;
const CONTAINER_W = 360;
const CONTAINER_H = 200;
const ICON_SIZE = 48;
const COLUMNS = 6;
const GAP = 60;
/** Capped so hit-test sampling stays O(1) in diagram size, not O(n). */
const MAX_SAMPLE_IDS = 200;

export interface SyntheticDiagram {
  doc: IcadDocument;
  /** May exceed the requested count slightly — generation stops at the first element that meets it. */
  elementCount: number;
  /** A representative subset of iconNode ids, for hit-test/move sampling. */
  sampleIconIds: ElementId[];
}

/**
 * Builds a diagram shaped like a realistic one, not a flat pile of shapes: repeating containers
 * (Box) each holding a row of icons chained by connectors — the same nesting + connector density
 * `iks_sr_mz_vpc` (the reference diagram in svgRenderer.goldenFixtures.test.ts) has, just repeated
 * until `targetCount` elements exist. Used by benchmark.test.ts to measure render/hit-test/lint/
 * command-bus cost at realistic scale (docs/09-roadmap.md#m12--performance-at-scale).
 */
export function buildSyntheticDocument(targetCount: number): SyntheticDiagram {
  const elements: SceneElement[] = [];
  const sampleIconIds: ElementId[] = [];
  let containerIndex = 0;

  outer: while (elements.length < targetCount) {
    const col = containerIndex % COLUMNS;
    const row = Math.floor(containerIndex / COLUMNS);
    const originX = col * (CONTAINER_W + GAP);
    const originY = row * (CONTAINER_H + GAP);
    const containerId = `box-${containerIndex}`;

    const container: BoxElement = {
      id: containerId,
      type: "box",
      semantic: "deployedOn",
      x: originX,
      y: originY,
      w: CONTAINER_W,
      h: CONTAINER_H,
      z: elements.length,
    };
    elements.push(container);
    if (elements.length >= targetCount) break;

    const icons: IconNodeElement[] = [];
    for (let i = 0; i < ICONS_PER_CONTAINER; i++) {
      const icon: IconNodeElement = {
        id: `${containerId}-icon-${i}`,
        type: "iconNode",
        semantic: "node",
        catalogRef: "bench/vm",
        x: originX + 24 + i * (ICON_SIZE + 16),
        y: originY + CONTAINER_H / 2 - ICON_SIZE / 2,
        w: ICON_SIZE,
        h: ICON_SIZE,
        parentId: containerId,
        z: elements.length,
      };
      elements.push(icon);
      icons.push(icon);
      if (sampleIconIds.length < MAX_SAMPLE_IDS) sampleIconIds.push(icon.id);
      if (elements.length >= targetCount) break outer;
    }

    for (let i = 0; i < icons.length - 1; i++) {
      const from = icons[i]!;
      const to = icons[i + 1]!;
      const connector: ConnectorElement = {
        id: `${containerId}-conn-${i}`,
        type: "connector",
        semantic: "node",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        from: { elementId: from.id, port: "e" },
        to: { elementId: to.id, port: "w" },
        connectorType: "association",
        routing: "manual",
        waypoints: [portPoint(from, "e"), portPoint(to, "w")],
        z: elements.length,
      };
      elements.push(connector);
      if (elements.length >= targetCount) break outer;
    }

    containerIndex++;
  }

  const doc: IcadDocument = {
    format: ICAD_FORMAT,
    version: ICAD_VERSION,
    catalog: { id: SYNTHETIC_CATALOG.id, version: SYNTHETIC_CATALOG.version },
    meta: {
      title: "Synthetic benchmark diagram",
      diagramLevel: "blank",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    canvas: { theme: "auto", grid: 8, background: "transparent" },
    conformance: { exportGate: "warn", ruleSeverities: {} },
    elements,
  };

  return { doc, elementCount: elements.length, sampleIconIds };
}
