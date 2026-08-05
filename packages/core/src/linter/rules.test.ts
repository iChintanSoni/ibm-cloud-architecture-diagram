import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import { Scene } from "../scene/scene.js";
import type {
  BoxElement,
  ConnectorElement,
  GroupElement,
  IconNodeElement,
  SceneElement,
  ZoneElement,
} from "../scene/types.js";
import {
  catalogIconRule,
  catalogVersionMismatchRule,
  childOutsideParentBoundsRule,
  connectorAnnotationRule,
  connectorCrossesObstacleRule,
  connectorPortRule,
  containerBorderRule,
  containerChildPaddingRule,
  containerSemanticRule,
  danglingConnectorRule,
  duplicateLabelRule,
  iconGeometryRule,
  missingLabelRule,
  nodeWithoutLocationRule,
  primaryFillRule,
  ruleMetadata,
  secondaryStrokeRule,
  standardConnectorTypeRule,
  westEastFlowRule,
} from "./rules.js";

function box(id: string, x = 0): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y: 0,
    w: 100,
    h: 100,
    label: { text: id },
  };
}

function group(id: string): GroupElement {
  return {
    id,
    type: "group",
    semantic: "deployedTo",
    x: 0,
    y: 0,
    w: 80,
    h: 80,
    label: { text: id },
  };
}

function connector(
  id: string,
  fromId: string,
  toId: string,
  patch: Partial<ConnectorElement> = {},
): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    from: { elementId: fromId, port: "e" },
    to: { elementId: toId, port: "w" },
    connectorType: "association",
    ...patch,
  };
}

function icon(id: string, parentId?: string): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef: "test/app",
    x: 20,
    y: 20,
    w: 48,
    h: 48,
    ...(parentId ? { parentId } : {}),
  };
}

function catalog(): Catalog {
  return new Catalog(
    {
      id: "test",
      version: "1",
      categories: [{ id: "applications", name: "Applications" }],
      icons: [
        {
          id: "test/app",
          name: "Application",
          category: "applications",
          semantic: "node",
          container: "square",
          asset: "app.svg",
        },
      ],
    },
    new Map([["app.svg", "<path />"]]),
  );
}

describe("default conformance rules", () => {
  it("publishes a unique IBM-default metadata entry for all 21 supported rules", () => {
    const ids = ruleMetadata.map((rule) => rule.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect(ids).toEqual(
      expect.arrayContaining([
        "container-semantic",
        "container-border",
        "non-catalog-icon",
        "catalog-version-mismatch",
        "primary-color-fill",
        "secondary-color-stroke",
        "node-without-location",
        "child-outside-parent-bounds",
        "container-child-padding",
        "missing-label",
        "duplicate-label",
        "dangling-connector",
        "non-standard-connector",
        "connector-not-bound-to-port",
        "connector-crosses-obstacle",
        "connector-annotation-incomplete",
        "connector-annotation-invalid-port",
        "west-east-flow-reversal",
        "icon-geometry",
        "non-zero-rotation",
        "off-palette-color",
      ]),
    );
  });

  it("requires labels on boxes, groups, zones, and actors only", () => {
    const scene = new Scene();
    scene._put({ ...box("box"), label: undefined } as unknown as BoxElement);
    scene._put({ ...group("group"), label: { text: "  " } });
    scene._put({
      id: "zone",
      type: "zone",
      semantic: "boundary",
      zoneKind: "az",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    scene._put({
      id: "actor",
      type: "actor",
      semantic: "actor",
      x: 0,
      y: 0,
      w: 48,
      h: 48,
    });
    scene._put(icon("unlabeled-icon"));
    scene._put({
      id: "text",
      type: "text",
      semantic: "node",
      text: "Note",
      x: 0,
      y: 0,
      w: 40,
      h: 20,
    });

    expect(
      missingLabelRule(scene)
        .map((item) => item.elementId)
        .sort(),
    ).toEqual(["actor", "box", "group", "zone"]);
  });

  it("converts mismatched Box and Group semantics and supports undo", () => {
    const scene = new Scene();
    scene._put({
      ...box("as-group"),
      semantic: "deployedTo",
    } as unknown as BoxElement);
    scene._put({
      ...group("as-box"),
      semantic: "deployedOn",
    } as unknown as GroupElement);

    const diagnostics = containerSemanticRule(scene);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) diagnostic.quickFix!.do(scene);
    expect(scene.get("as-group")).toMatchObject({
      type: "group",
      semantic: "deployedTo",
    });
    expect(scene.get("as-box")).toMatchObject({
      type: "box",
      semantic: "deployedOn",
    });

    for (const diagnostic of diagnostics.reverse())
      diagnostic.quickFix!.undo(scene);
    expect(scene.get("as-group")).toMatchObject({
      type: "box",
      semantic: "deployedTo",
    });
    expect(scene.get("as-box")).toMatchObject({
      type: "group",
      semantic: "deployedOn",
    });
  });

  it("normalizes explicit Box and Group border overrides", () => {
    const scene = new Scene();
    scene._put({ ...box("solid"), style: { dashed: true, stroke: "#161616" } });
    scene._put({ ...group("dashed"), style: { dashed: false, fill: "white" } });

    const diagnostics = containerBorderRule(scene);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) diagnostic.quickFix!.do(scene);

    expect(scene.get("solid")?.style).toEqual({
      dashed: false,
      stroke: "#161616",
    });
    expect(scene.get("dashed")?.style).toEqual({ dashed: true, fill: "white" });
    expect(containerBorderRule(scene)).toHaveLength(0);
  });

  it("accepts catalog icons and rejects unresolved references", () => {
    const scene = new Scene();
    scene._put(icon("known"));
    scene._put({ ...icon("unknown"), catalogRef: "test/missing" });

    const diagnostics = catalogIconRule(scene, { catalog: catalog() });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      elementId: "unknown",
      severity: "error",
    });
  });

  it("flags a document pinned to a different catalog than the one running, as an info-level, document-level diagnostic", () => {
    const scene = new Scene({ catalog: { id: "test", version: "0" } });

    const diagnostics = catalogVersionMismatchRule(scene, {
      catalog: catalog(),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.elementId).toBeUndefined();
    expect(diagnostics[0]).toMatchObject({
      ruleId: "catalog-version-mismatch",
      severity: "info",
    });
  });

  it("does not flag a document already pinned to the running catalog, or when no catalog is running", () => {
    const scene = new Scene({ catalog: { id: "test", version: "1" } });

    expect(catalogVersionMismatchRule(scene, { catalog: catalog() })).toEqual(
      [],
    );
    expect(catalogVersionMismatchRule(scene)).toEqual([]);
  });

  it("does not flag secondary fills or primary strokes in their valid roles", () => {
    const scene = new Scene();
    scene._put({
      ...box("valid"),
      style: { fill: "#edf5ff", stroke: "#0f62fe" },
    });

    expect(primaryFillRule(scene)).toHaveLength(0);
    expect(secondaryStrokeRule(scene)).toHaveLength(0);
  });

  it("requires location context only in high-level and detailed diagrams", () => {
    const scene = new Scene({ meta: { diagramLevel: "blank" } });
    scene._put(icon("floating"));
    expect(nodeWithoutLocationRule(scene)).toHaveLength(0);

    scene.meta.diagramLevel = "high-level";
    const zone: ZoneElement = {
      id: "region",
      type: "zone",
      semantic: "boundary",
      zoneKind: "az",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      label: { text: "Region" },
    };
    scene._put(zone);
    scene._put(icon("located", zone.id));

    expect(
      nodeWithoutLocationRule(scene).map((item) => item.elementId),
    ).toEqual(["floating"]);
  });

  it("flags a child whose geometry doesn't overlap its container's bounds at all", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    scene._put({ ...icon("stray", "container"), x: 500, y: 500 });

    const diagnostics = childOutsideParentBoundsRule(scene);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "child-outside-parent-bounds",
      severity: "warn",
      category: "containment",
      elementId: "stray",
    });

    diagnostics[0]!.quickFix!.do(scene);
    const fixed = scene.get("stray")!;
    expect(fixed.x).toBeGreaterThanOrEqual(0);
    expect(fixed.x).toBeLessThan(100);
    expect(fixed.y).toBeGreaterThanOrEqual(0);
    expect(fixed.y).toBeLessThan(100);
  });

  it("does not flag a child that merely overhangs its container's edge, only complete disjunction", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    // Mostly outside, but its left edge still overlaps the container by a few px.
    scene._put({ ...icon("overhanging", "container"), x: 90, y: 20 });
    expect(childOutsideParentBoundsRule(scene)).toHaveLength(0);
  });

  it("ignores elements with no parentId, and containers that don't enforce bounds (Frame)", () => {
    const scene = new Scene();
    scene._put(icon("top-level")); // no parentId at all
    scene._put({
      id: "frame",
      type: "frame",
      semantic: "boundary",
      name: "Section",
      order: 1,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    scene._put({ ...icon("far-from-frame", "frame"), x: 999, y: 999 });

    expect(childOutsideParentBoundsRule(scene)).toHaveLength(0);
  });

  it("flags a child that's inside its container but hugging one edge closer than the 16px padding convention", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    scene._put({ ...icon("tight", "container"), x: 5, y: 20 }); // left gap = 5, < 16

    const diagnostics = containerChildPaddingRule(scene);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "container-child-padding",
      severity: "info",
      category: "containment",
      elementId: "tight",
    });

    diagnostics[0]!.quickFix!.do(scene);
    // Nudged inward on the tight (left) edge only - the already-comfortable top gap (20) is
    // left untouched.
    expect(scene.get("tight")).toMatchObject({ x: 16, y: 20 });
  });

  it("does not flag a child that already respects the padding convention on every edge", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    scene._put({ ...icon("comfortable", "container"), x: 20, y: 20 });
    expect(containerChildPaddingRule(scene)).toHaveLength(0);
  });

  it("does not flag an overhanging/disjoint child - that's childOutsideParentBoundsRule's territory, not this rule's", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    // Same overhang shape as childOutsideParentBoundsRule's own "merely overhangs" test above -
    // a negative gap (overhang), not merely a small positive one.
    scene._put({ ...icon("overhanging", "container"), x: 90, y: 20 });
    expect(containerChildPaddingRule(scene)).toHaveLength(0);
  });

  it("respects a per-element gutterExempt opt-out for a deliberate gutter", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    scene._put({
      ...icon("deliberate-gutter", "container"),
      x: 0,
      y: 20,
      gutterExempt: true,
    });
    expect(containerChildPaddingRule(scene)).toHaveLength(0);
  });

  it("ignores elements with no parentId, and containers that don't enforce bounds (Frame)", () => {
    const scene = new Scene();
    scene._put(icon("top-level")); // no parentId at all
    scene._put({
      id: "frame",
      type: "frame",
      semantic: "boundary",
      name: "Section",
      order: 1,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    scene._put({ ...icon("flush-with-frame", "frame"), x: 0, y: 0 });

    expect(containerChildPaddingRule(scene)).toHaveLength(0);
  });

  it("detects duplicate labels case-insensitively and ignores connector labels", () => {
    const scene = new Scene();
    scene._put({ ...box("a"), label: { text: "VPC" } });
    scene._put({ ...box("b", 200), label: { text: "  vpc  " } });
    scene._put({
      ...connector("c", "a", "b"),
      label: { text: "VPC" },
    });

    expect(
      duplicateLabelRule(scene)
        .map((item) => item.elementId)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("only reports dangling connectors when an endpoint element is absent", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 200));
    scene._put(connector("valid", "a", "b"));
    scene._put(connector("dangling", "a", "missing"));

    expect(danglingConnectorRule(scene).map((item) => item.elementId)).toEqual([
      "dangling",
    ]);
  });

  it("accepts every standard connector type and all named ports", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 200));
    const types: ConnectorElement["connectorType"][] = [
      "logical-connection",
      "connection",
      "physical-connection",
      "tunneling-connection",
      "traffic-through-double-tunnel",
      "dependency",
      "association",
      "aggregation",
      "composition",
      "implementation",
      "extends",
    ];
    types.forEach((connectorType, index) => {
      scene._put(
        connector(`c-${index}`, "a", "b", {
          connectorType,
          from: { elementId: "a", port: index % 2 === 0 ? "center" : "n" },
          to: { elementId: "b", port: index % 2 === 0 ? "s" : "w" },
        }),
      );
    });

    expect(standardConnectorTypeRule(scene)).toHaveLength(0);
    expect(connectorPortRule(scene)).toHaveLength(0);
  });

  it("flags a connector annotation with no name, or a non-numeric port, but accepts a well-formed one", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 200));
    scene._put(
      connector("well-formed", "a", "b", {
        annotation: { name: "HTTPS", security: "TLS1.3", port: "443" },
      }),
    );
    scene._put(
      connector("no-name", "a", "b", {
        annotation: { name: "  ", port: "443" },
      }),
    );
    scene._put(
      connector("bad-port", "a", "b", {
        annotation: { name: "HTTPS", port: "https" },
      }),
    );
    scene._put(connector("no-annotation", "a", "b"));

    const diagnostics = connectorAnnotationRule(scene);
    expect(diagnostics.map((d) => [d.elementId, d.ruleId])).toEqual([
      ["no-name", "connector-annotation-incomplete"],
      ["bad-port", "connector-annotation-invalid-port"],
    ]);
  });

  it("binds invalid endpoints to the nearest vertical ports", () => {
    const scene = new Scene();
    scene._put(box("bottom"));
    scene._put({ ...box("top"), y: -300 });
    scene._put({
      ...connector("vertical", "bottom", "top"),
      from: { elementId: "bottom", port: "invalid" },
      to: { elementId: "top", port: "invalid" },
    } as unknown as ConnectorElement);

    const diagnostic = connectorPortRule(scene)[0]!;
    diagnostic.quickFix!.do(scene);
    expect(scene.get("vertical")).toMatchObject({
      from: { elementId: "bottom", port: "n" },
      to: { elementId: "top", port: "s" },
    });
  });

  it("does not report a connector when its path is obstacle-free", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 300));
    scene._put(
      connector("clean", "a", "b", { routing: "auto", waypoints: [] }),
    );

    expect(connectorCrossesObstacleRule(scene)).toHaveLength(0);
  });

  it("flags only grossly reversed public flow", () => {
    const scene = new Scene();
    scene._put(box("left"));
    scene._put(box("right", 300));
    scene._put(
      connector("public-reversed", "right", "left", {
        connectorType: "connection",
        flowColor: "public",
      }),
    );
    scene._put(
      connector("private-reversed", "right", "left", {
        connectorType: "connection",
        flowColor: "private",
      }),
    );
    scene._put(
      connector("public-forward", "left", "right", {
        connectorType: "connection",
        flowColor: "public",
      }),
    );

    expect(westEastFlowRule(scene).map((item) => item.elementId)).toEqual([
      "public-reversed",
    ]);
  });

  it("accepts spec-sized icons and repairs width, height, and outline drift together", () => {
    const scene = new Scene();
    scene._put(icon("valid"));
    scene._put({
      ...icon("drifted"),
      w: 64,
      h: 40,
      style: { strokeWidth: 2, fill: "white" },
    });

    const diagnostics = iconGeometryRule(scene);
    expect(diagnostics).toHaveLength(1);
    diagnostics[0]!.quickFix!.do(scene);
    expect(scene.get("drifted")).toMatchObject({
      w: 48,
      h: 48,
      style: { strokeWidth: 1, fill: "white" },
    });
    expect(iconGeometryRule(scene)).toHaveLength(0);
  });

  it("keeps rule functions resilient to runtime element unions from hand-edited JSON", () => {
    const scene = new Scene();
    const raw = {
      ...box("raw"),
      type: "box",
      semantic: "actor",
    } as unknown as SceneElement;
    scene._put(raw);

    expect(() => containerSemanticRule(scene)).not.toThrow();
    expect(containerSemanticRule(scene)[0]).toMatchObject({
      ruleId: "container-semantic",
    });
  });
});
