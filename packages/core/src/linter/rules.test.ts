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
  childOverhangsParentRule,
  connectorAnnotationRule,
  connectorBorderHugRule,
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
  siblingOverlapRule,
  standardConnectorTypeRule,
  textOverflowNeedsWrapRule,
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
  it("publishes a unique IBM-default metadata entry for all 25 supported rules", () => {
    const ids = ruleMetadata.map((rule) => rule.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
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
        "child-overhangs-parent",
        "container-child-padding",
        "missing-label",
        "duplicate-label",
        "text-overflow-needs-wrap",
        "dangling-connector",
        "non-standard-connector",
        "connector-not-bound-to-port",
        "connector-crosses-obstacle",
        "connector-border-hug",
        "connector-annotation-incomplete",
        "connector-annotation-invalid-port",
        "sibling-overlap",
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

describe("childOverhangsParentRule", () => {
  it("flags a child that mostly hangs off its container's edge", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    // Overlap area = 20*48 = 960 of a 48*48=2304 child - well under half.
    scene._put({ ...icon("mostly-out", "container"), x: 80, y: 20 });

    const diagnostics = childOverhangsParentRule(scene);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "child-overhangs-parent",
      severity: "warn",
      category: "containment",
      elementId: "mostly-out",
    });
  });

  it("does not flag a child that's mostly inside with only a small overhang", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    // Overlap area = 40*48 = 1920 of a 2304 child - well over half.
    scene._put({ ...icon("mostly-in", "container"), x: 60, y: 20 });
    expect(childOverhangsParentRule(scene)).toHaveLength(0);
  });

  it("does not flag a fully disjoint child - that's childOutsideParentBoundsRule's territory", () => {
    const scene = new Scene();
    scene._put(box("container")); // (0, 0, 100, 100)
    scene._put({ ...icon("disjoint", "container"), x: 500, y: 500 });
    expect(childOverhangsParentRule(scene)).toHaveLength(0);
  });
});

describe("siblingOverlapRule", () => {
  it("flags two overlapping same-parent (here: both top-level) siblings, one diagnostic each", () => {
    const scene = new Scene();
    scene._put(box("a", 0)); // (0, 0, 100, 100)
    scene._put(box("b", 50)); // (50, 0, 100, 100) - overlaps a by 50px

    const diagnostics = siblingOverlapRule(scene);
    expect(diagnostics.map((d) => d.elementId).sort()).toEqual(["a", "b"]);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "sibling-overlap",
      severity: "warn",
      category: "layout",
    });
  });

  it("does not flag siblings that don't overlap, even when close", () => {
    const scene = new Scene();
    scene._put(box("a", 0));
    scene._put(box("b", 150)); // (150, 0, 100, 100) - clear of a's (0,0,100,100)
    expect(siblingOverlapRule(scene)).toHaveLength(0);
  });

  it("does not flag overlapping elements that belong to different parents", () => {
    const scene = new Scene();
    scene._put(box("parent-a", 0));
    scene._put(box("parent-b", 500));
    // Same geometry as each other, but different parents - not siblings.
    scene._put(icon("child-a", "parent-a"));
    scene._put(icon("child-b", "parent-b"));
    expect(siblingOverlapRule(scene)).toHaveLength(0);
  });

  it("respects gutterExempt on either side of an overlapping pair (deliberate decorative overlay)", () => {
    const scene = new Scene();
    scene._put(box("a", 0));
    scene._put({ ...box("b", 50), gutterExempt: true });
    expect(siblingOverlapRule(scene)).toHaveLength(0);
  });

  it("excludes connectors, whose stored geometry is a degenerate rect, not a real footprint", () => {
    const scene = new Scene();
    scene._put(icon("a")); // (20, 20, 48, 48)
    scene._put({ ...icon("b"), x: 500, y: 500 }); // clear of "a" - no real overlap
    // Both connectors share the same degenerate (0,0,1,1) rect from the connector() helper -
    // if connectors weren't excluded, this pair would itself read as "overlapping."
    scene._put(connector("c1", "a", "b"));
    scene._put(connector("c2", "a", "b"));
    expect(siblingOverlapRule(scene)).toHaveLength(0);
  });
});

describe("connectorBorderHugRule", () => {
  it("flags a manually-routed connector whose stored path hugs an unrelated container's border", () => {
    const scene = new Scene();
    scene._put({ ...box("outer", 200), y: 100, w: 400, h: 300 });
    // Source/target sit so their own ports land exactly on outer's top edge (y=100), with no
    // waypoints of their own - the straight line between them runs directly along that border.
    scene._put({ ...icon("source"), x: 0, y: 76 });
    scene._put({ ...icon("target"), x: 700, y: 76 });
    scene._put(
      connector("hugging", "source", "target", {
        routing: "manual",
        waypoints: [],
      }),
    );

    const diagnostics = connectorBorderHugRule(scene);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "connector-border-hug",
      severity: "warn",
      category: "connectors",
      elementId: "hugging",
    });
    expect(diagnostics[0]!.quickFix).toBeDefined();
  });

  it("does not flag a connector that stays clear of every container's border", () => {
    const scene = new Scene();
    scene._put({ ...box("outer", 200), y: 800, w: 400, h: 300 }); // far away
    scene._put({ ...icon("source"), x: 0, y: 76 });
    scene._put({ ...icon("target"), x: 700, y: 76 });
    scene._put(
      connector("clean", "source", "target", {
        routing: "manual",
        waypoints: [],
      }),
    );
    expect(connectorBorderHugRule(scene)).toHaveLength(0);
  });
});

describe("textOverflowNeedsWrapRule", () => {
  it("flags a container label that doesn't fit its own boundary", () => {
    const scene = new Scene();
    scene._put({
      ...box("narrow"),
      w: 40,
      label: { text: "A Very Long Container Label" },
    });

    const diagnostics = textOverflowNeedsWrapRule(scene);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "text-overflow-needs-wrap",
      severity: "info",
      category: "labels",
      elementId: "narrow",
    });
  });

  it("does not flag a container label that comfortably fits", () => {
    const scene = new Scene();
    scene._put({ ...box("wide"), label: { text: "OK" } });
    expect(textOverflowNeedsWrapRule(scene)).toHaveLength(0);
  });

  it("flags an icon/actor caption that still needs ellipsis after wrapping to two lines", () => {
    const scene = new Scene();
    scene._put({
      ...icon("long-caption"),
      label: {
        text: "A Really Long Multi Word Icon Caption That Definitely Will Not Fit In Two Lines",
      },
    });

    const diagnostics = textOverflowNeedsWrapRule(scene);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "text-overflow-needs-wrap",
      severity: "info",
      elementId: "long-caption",
    });
  });

  it("does not flag an icon/actor caption that fits within two lines", () => {
    const scene = new Scene();
    scene._put({ ...icon("short-caption"), label: { text: "Web Server" } });
    expect(textOverflowNeedsWrapRule(scene)).toHaveLength(0);
  });

  it("ignores elements with no label", () => {
    const scene = new Scene();
    scene._put({ ...box("no-label-box"), label: undefined });
    scene._put(icon("no-label-icon"));
    expect(textOverflowNeedsWrapRule(scene)).toHaveLength(0);
  });
});
