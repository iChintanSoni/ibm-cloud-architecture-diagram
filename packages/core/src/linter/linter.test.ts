import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import { Scene } from "../scene/scene.js";
import type {
  BoxElement,
  ConnectorElement,
  GroupElement,
  IconNodeElement,
} from "../scene/types.js";
import { Linter } from "./linter.js";

function box(id: string, label?: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...(label ? { label: { text: label } } : {}),
  };
}

function group(id: string, parentId?: string): GroupElement {
  return {
    id,
    type: "group",
    semantic: "deployedTo",
    x: 0,
    y: 0,
    w: 80,
    h: 80,
    label: { text: id },
    ...(parentId ? { parentId } : {}),
  };
}

describe("Linter", () => {
  it("flags a box without a label and offers a quick-fix", () => {
    const scene = new Scene();
    scene._put(box("vpc"));

    const linter = new Linter();
    const diagnostics = linter.run(scene);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "missing-label",
      severity: "warn",
      elementId: "vpc",
    });

    diagnostics[0]!.quickFix!.do(scene);
    expect(scene.get("vpc")?.label?.text).toBe("Untitled");
    expect(linter.run(scene)).toHaveLength(0);
  });

  it("does not flag a labeled box", () => {
    const scene = new Scene();
    scene._put(box("vpc", "VPC"));
    expect(new Linter().run(scene)).toHaveLength(0);
  });

  it("flags a connector with a missing endpoint as an error", () => {
    const scene = new Scene();
    scene._put(box("a", "A"));
    const connector: ConnectorElement = {
      id: "c1",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "a", port: "e" },
      to: { elementId: "missing", port: "w" },
      connectorType: "association",
    };
    scene._put(connector);

    const diagnostics = new Linter().run(scene);
    const connectorDiagnostic = diagnostics.find(
      (d) => d.ruleId === "dangling-connector",
    );
    expect(connectorDiagnostic).toMatchObject({
      severity: "error",
      elementId: "c1",
    });
  });

  it("does not require a deployedTo group to be nested inside a deployedOn box", () => {
    const scene = new Scene();
    scene._put(group("g1"));

    const diagnostics = new Linter().run(scene);
    expect(diagnostics).toEqual([]);
  });

  it("also accepts a group nested inside a box", () => {
    const scene = new Scene();
    scene._put(box("subnet", "Subnet"));
    // Inset within the box's own 16px padding convention (container-child-padding, M27.6) - this
    // test is about semantic acceptance of Group-inside-Box, not padding, so the fixture shouldn't
    // incidentally trip an unrelated rule.
    scene._put({ ...group("sg", "subnet"), x: 16, y: 16, w: 60, h: 60 });

    const diagnostics = new Linter().run(scene);
    expect(diagnostics).toEqual([]);
  });

  it("flags a connector whose straight route crosses an unrelated icon, with a reroute quick-fix", () => {
    const scene = new Scene();
    scene._put(box("a", "A"));
    const b: BoxElement = { ...box("b", "B"), x: 300 };
    scene._put(b);
    const blocker: IconNodeElement = {
      id: "blocker",
      type: "iconNode",
      semantic: "node",
      catalogRef: "test/vpc",
      x: 180,
      y: 30,
      w: 48,
      h: 48,
    };
    scene._put(blocker);
    const connector: ConnectorElement = {
      id: "c1",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "a", port: "e" },
      to: { elementId: "b", port: "w" },
      connectorType: "association",
      routing: "auto",
      waypoints: [],
    };
    scene._put(connector);

    const diagnostics = new Linter().run(scene);
    const crossing = diagnostics.find(
      (d) => d.ruleId === "connector-crosses-obstacle",
    );
    expect(crossing).toMatchObject({ severity: "warn", elementId: "c1" });

    crossing!.quickFix!.do(scene);
    const rerouted = new Linter()
      .run(scene)
      .find((d) => d.ruleId === "connector-crosses-obstacle");
    expect(rerouted).toBeUndefined();
  });

  it("reports no blocking errors on a clean scene", () => {
    const scene = new Scene();
    scene._put(box("a", "A"));
    const linter = new Linter();
    expect(linter.hasBlockingErrors(scene)).toBe(false);
  });

  it("honors per-document severity overrides and disabled rules", () => {
    const scene = new Scene();
    scene._put(box("vpc"));
    scene.conformance.ruleSeverities["missing-label"] = "error";
    expect(new Linter().run(scene)[0]).toMatchObject({
      ruleId: "missing-label",
      severity: "error",
    });

    scene.conformance.ruleSeverities["missing-label"] = "off";
    expect(new Linter().run(scene)).toHaveLength(0);
  });

  it("flags duplicate labels and offers deterministic rename fixes", () => {
    const scene = new Scene();
    scene._put(box("a", "VPC"));
    scene._put({ ...box("b", "VPC"), x: 200 });

    const duplicates = new Linter()
      .run(scene)
      .filter((item) => item.ruleId === "duplicate-label");
    expect(duplicates).toHaveLength(2);
    duplicates[1]!.quickFix!.do(scene);
    expect(scene.get("b")?.label?.text).toBe("VPC 2");
  });

  it("validates catalog references when a catalog is available", () => {
    const scene = new Scene();
    scene._put({
      id: "unknown",
      type: "iconNode",
      semantic: "node",
      catalogRef: "test/missing",
      x: 0,
      y: 0,
      w: 48,
      h: 48,
    });
    const catalog = new Catalog(
      { id: "test", version: "1", categories: [], icons: [] },
      new Map(),
    );

    expect(new Linter({ catalog }).run(scene)).toContainEqual(
      expect.objectContaining({
        ruleId: "non-catalog-icon",
        severity: "error",
        elementId: "unknown",
      }),
    );
  });

  it("normalizes off-spec primary fills and secondary strokes", () => {
    const scene = new Scene();
    scene._put({
      ...box("vpc", "VPC"),
      style: { fill: "#0F62FE", stroke: "#EDF5FF" },
    });

    const diagnostics = new Linter().run(scene);
    diagnostics
      .find((item) => item.ruleId === "primary-color-fill")!
      .quickFix!.do(scene);
    diagnostics
      .find((item) => item.ruleId === "secondary-color-stroke")!
      .quickFix!.do(scene);

    expect(scene.get("vpc")?.style).toMatchObject({
      fill: "#edf5ff",
      stroke: "#0f62fe",
    });
  });

  it("flags high-level nodes without location context", () => {
    const scene = new Scene({ meta: { diagramLevel: "high-level" } });
    scene._put({
      id: "app",
      type: "iconNode",
      semantic: "node",
      catalogRef: "test/app",
      x: 0,
      y: 0,
      w: 48,
      h: 48,
    });

    expect(new Linter().run(scene)).toContainEqual(
      expect.objectContaining({
        ruleId: "node-without-location",
        elementId: "app",
      }),
    );
  });

  it("repairs invalid connector types and port bindings from hand-edited input", () => {
    const scene = new Scene();
    scene._put(box("a", "A"));
    scene._put({ ...box("b", "B"), x: 300 });
    scene._put({
      id: "bad",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      from: { elementId: "a", port: "invalid" },
      to: { elementId: "b", port: "w" },
      connectorType: "custom",
    } as unknown as ConnectorElement);

    const diagnostics = new Linter().run(scene);
    diagnostics
      .find((item) => item.ruleId === "non-standard-connector")!
      .quickFix!.do(scene);
    diagnostics
      .find((item) => item.ruleId === "connector-not-bound-to-port")!
      .quickFix!.do(scene);

    expect(scene.get("bad")).toMatchObject({
      connectorType: "association",
      from: { elementId: "a", port: "e" },
      to: { elementId: "b", port: "w" },
      routing: "auto",
    });
  });

  it("flags reversed public flow and icon geometry drift", () => {
    const scene = new Scene();
    scene._put({ ...box("right", "Public entry"), x: 300 });
    scene._put(box("left", "Service"));
    scene._put({
      id: "drifted",
      type: "iconNode",
      semantic: "node",
      catalogRef: "test/app",
      x: 500,
      y: 0,
      w: 64,
      h: 40,
      style: { strokeWidth: 2 },
    });
    scene._put({
      id: "public",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      from: { elementId: "right", port: "w" },
      to: { elementId: "left", port: "e" },
      connectorType: "connection",
      flowColor: "public",
    });

    const diagnostics = new Linter().run(scene);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ ruleId: "west-east-flow-reversal" }),
    );
    const geometry = diagnostics.find(
      (item) => item.ruleId === "icon-geometry",
    )!;
    geometry.quickFix!.do(scene);
    expect(scene.get("drifted")).toMatchObject({
      w: 48,
      h: 48,
      style: { strokeWidth: 1 },
    });
  });
});
