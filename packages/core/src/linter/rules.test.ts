import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import { Scene } from "../scene/scene.js";
import type {
  BoxElement,
  ConnectorElement,
  GroupElement,
  IconNodeElement,
  SceneElement,
  ZoneElement
} from "../scene/types.js";
import {
  catalogIconRule,
  connectorAnnotationRule,
  connectorCrossesObstacleRule,
  connectorPortRule,
  containerBorderRule,
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
  westEastFlowRule
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
    label: { text: id }
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
    label: { text: id }
  };
}

function connector(
  id: string,
  fromId: string,
  toId: string,
  patch: Partial<ConnectorElement> = {}
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
    ...patch
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
    ...(parentId ? { parentId } : {})
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
          asset: "app.svg"
        }
      ]
    },
    new Map([["app.svg", "<path />"]])
  );
}

describe("default conformance rules", () => {
  it("publishes a unique IBM-default metadata entry for all 16 supported rules", () => {
    const ids = ruleMetadata.map((rule) => rule.id);
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
    expect(ids).toEqual(
      expect.arrayContaining([
        "container-semantic",
        "container-border",
        "non-catalog-icon",
        "primary-color-fill",
        "secondary-color-stroke",
        "node-without-location",
        "missing-label",
        "duplicate-label",
        "dangling-connector",
        "non-standard-connector",
        "connector-not-bound-to-port",
        "connector-crosses-obstacle",
        "connector-annotation-incomplete",
        "connector-annotation-invalid-port",
        "west-east-flow-reversal",
        "icon-geometry"
      ])
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
      h: 100
    });
    scene._put({ id: "actor", type: "actor", semantic: "actor", x: 0, y: 0, w: 48, h: 48 });
    scene._put(icon("unlabeled-icon"));
    scene._put({ id: "text", type: "text", semantic: "node", text: "Note", x: 0, y: 0, w: 40, h: 20 });

    expect(missingLabelRule(scene).map((item) => item.elementId).sort()).toEqual([
      "actor",
      "box",
      "group",
      "zone"
    ]);
  });

  it("converts mismatched Box and Group semantics and supports undo", () => {
    const scene = new Scene();
    scene._put({ ...box("as-group"), semantic: "deployedTo" } as unknown as BoxElement);
    scene._put({ ...group("as-box"), semantic: "deployedOn" } as unknown as GroupElement);

    const diagnostics = containerSemanticRule(scene);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) diagnostic.quickFix!.do(scene);
    expect(scene.get("as-group")).toMatchObject({ type: "group", semantic: "deployedTo" });
    expect(scene.get("as-box")).toMatchObject({ type: "box", semantic: "deployedOn" });

    for (const diagnostic of diagnostics.reverse()) diagnostic.quickFix!.undo(scene);
    expect(scene.get("as-group")).toMatchObject({ type: "box", semantic: "deployedTo" });
    expect(scene.get("as-box")).toMatchObject({ type: "group", semantic: "deployedOn" });
  });

  it("normalizes explicit Box and Group border overrides", () => {
    const scene = new Scene();
    scene._put({ ...box("solid"), style: { dashed: true, stroke: "#161616" } });
    scene._put({ ...group("dashed"), style: { dashed: false, fill: "white" } });

    const diagnostics = containerBorderRule(scene);
    expect(diagnostics).toHaveLength(2);
    for (const diagnostic of diagnostics) diagnostic.quickFix!.do(scene);

    expect(scene.get("solid")?.style).toEqual({ dashed: false, stroke: "#161616" });
    expect(scene.get("dashed")?.style).toEqual({ dashed: true, fill: "white" });
    expect(containerBorderRule(scene)).toHaveLength(0);
  });

  it("accepts catalog icons and rejects unresolved references", () => {
    const scene = new Scene();
    scene._put(icon("known"));
    scene._put({ ...icon("unknown"), catalogRef: "test/missing" });

    const diagnostics = catalogIconRule(scene, { catalog: catalog() });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ elementId: "unknown", severity: "error" });
  });

  it("does not flag secondary fills or primary strokes in their valid roles", () => {
    const scene = new Scene();
    scene._put({ ...box("valid"), style: { fill: "#edf5ff", stroke: "#0f62fe" } });

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
      label: { text: "Region" }
    };
    scene._put(zone);
    scene._put(icon("located", zone.id));

    expect(nodeWithoutLocationRule(scene).map((item) => item.elementId)).toEqual(["floating"]);
  });

  it("detects duplicate labels case-insensitively and ignores connector labels", () => {
    const scene = new Scene();
    scene._put({ ...box("a"), label: { text: "VPC" } });
    scene._put({ ...box("b", 200), label: { text: "  vpc  " } });
    scene._put({
      ...connector("c", "a", "b"),
      label: { text: "VPC" }
    });

    expect(duplicateLabelRule(scene).map((item) => item.elementId).sort()).toEqual(["a", "b"]);
  });

  it("only reports dangling connectors when an endpoint element is absent", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 200));
    scene._put(connector("valid", "a", "b"));
    scene._put(connector("dangling", "a", "missing"));

    expect(danglingConnectorRule(scene).map((item) => item.elementId)).toEqual(["dangling"]);
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
      "extends"
    ];
    types.forEach((connectorType, index) => {
      scene._put(
        connector(`c-${index}`, "a", "b", {
          connectorType,
          from: { elementId: "a", port: index % 2 === 0 ? "center" : "n" },
          to: { elementId: "b", port: index % 2 === 0 ? "s" : "w" }
        })
      );
    });

    expect(standardConnectorTypeRule(scene)).toHaveLength(0);
    expect(connectorPortRule(scene)).toHaveLength(0);
  });

  it("flags a connector annotation with no name, or a non-numeric port, but accepts a well-formed one", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 200));
    scene._put(connector("well-formed", "a", "b", { annotation: { name: "HTTPS", security: "TLS1.3", port: "443" } }));
    scene._put(connector("no-name", "a", "b", { annotation: { name: "  ", port: "443" } }));
    scene._put(connector("bad-port", "a", "b", { annotation: { name: "HTTPS", port: "https" } }));
    scene._put(connector("no-annotation", "a", "b"));

    const diagnostics = connectorAnnotationRule(scene);
    expect(diagnostics.map((d) => [d.elementId, d.ruleId])).toEqual([
      ["no-name", "connector-annotation-incomplete"],
      ["bad-port", "connector-annotation-invalid-port"]
    ]);
  });

  it("binds invalid endpoints to the nearest vertical ports", () => {
    const scene = new Scene();
    scene._put(box("bottom"));
    scene._put({ ...box("top"), y: -300 });
    scene._put({
      ...connector("vertical", "bottom", "top"),
      from: { elementId: "bottom", port: "invalid" },
      to: { elementId: "top", port: "invalid" }
    } as unknown as ConnectorElement);

    const diagnostic = connectorPortRule(scene)[0]!;
    diagnostic.quickFix!.do(scene);
    expect(scene.get("vertical")).toMatchObject({
      from: { elementId: "bottom", port: "n" },
      to: { elementId: "top", port: "s" }
    });
  });

  it("does not report a connector when its path is obstacle-free", () => {
    const scene = new Scene();
    scene._put(box("a"));
    scene._put(box("b", 300));
    scene._put(connector("clean", "a", "b", { routing: "auto", waypoints: [] }));

    expect(connectorCrossesObstacleRule(scene)).toHaveLength(0);
  });

  it("flags only grossly reversed public flow", () => {
    const scene = new Scene();
    scene._put(box("left"));
    scene._put(box("right", 300));
    scene._put(connector("public-reversed", "right", "left", { connectorType: "connection", flowColor: "public" }));
    scene._put(connector("private-reversed", "right", "left", { connectorType: "connection", flowColor: "private" }));
    scene._put(connector("public-forward", "left", "right", { connectorType: "connection", flowColor: "public" }));

    expect(westEastFlowRule(scene).map((item) => item.elementId)).toEqual(["public-reversed"]);
  });

  it("accepts spec-sized icons and repairs width, height, and outline drift together", () => {
    const scene = new Scene();
    scene._put(icon("valid"));
    scene._put({ ...icon("drifted"), w: 64, h: 40, style: { strokeWidth: 2, fill: "white" } });

    const diagnostics = iconGeometryRule(scene);
    expect(diagnostics).toHaveLength(1);
    diagnostics[0]!.quickFix!.do(scene);
    expect(scene.get("drifted")).toMatchObject({
      w: 48,
      h: 48,
      style: { strokeWidth: 1, fill: "white" }
    });
    expect(iconGeometryRule(scene)).toHaveLength(0);
  });

  it("keeps rule functions resilient to runtime element unions from hand-edited JSON", () => {
    const scene = new Scene();
    const raw = {
      ...box("raw"),
      type: "box",
      semantic: "actor"
    } as unknown as SceneElement;
    scene._put(raw);

    expect(() => containerSemanticRule(scene)).not.toThrow();
    expect(containerSemanticRule(scene)[0]).toMatchObject({ ruleId: "container-semantic" });
  });
});
