import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement, ConnectorElement, GroupElement, IconNodeElement } from "../scene/types.js";
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
    ...(label ? { label: { text: label } } : {})
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
    ...(parentId ? { parentId } : {})
  };
}

describe("Linter", () => {
  it("flags a box without a label and offers a quick-fix", () => {
    const scene = new Scene();
    scene._put(box("vpc"));

    const linter = new Linter();
    const diagnostics = linter.run(scene);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ ruleId: "missing-label", severity: "warn", elementId: "vpc" });

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
      connectorType: "association"
    };
    scene._put(connector);

    const diagnostics = new Linter().run(scene);
    const connectorDiagnostic = diagnostics.find((d) => d.ruleId === "dangling-connector");
    expect(connectorDiagnostic).toMatchObject({ severity: "error", elementId: "c1" });
  });

  it("flags a deployedTo group with no deployedOn box ancestor", () => {
    const scene = new Scene();
    scene._put(group("g1"));

    const diagnostics = new Linter().run(scene);
    const groupDiagnostic = diagnostics.find((d) => d.ruleId === "group-without-box");
    expect(groupDiagnostic).toMatchObject({ severity: "warn", elementId: "g1" });
  });

  it("does not flag a group nested inside a box", () => {
    const scene = new Scene();
    scene._put(box("subnet", "Subnet"));
    scene._put(group("sg", "subnet"));

    const diagnostics = new Linter().run(scene);
    expect(diagnostics.some((d) => d.ruleId === "group-without-box")).toBe(false);
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
      h: 48
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
      waypoints: []
    };
    scene._put(connector);

    const diagnostics = new Linter().run(scene);
    const crossing = diagnostics.find((d) => d.ruleId === "connector-crosses-obstacle");
    expect(crossing).toMatchObject({ severity: "warn", elementId: "c1" });

    crossing!.quickFix!.do(scene);
    const rerouted = new Linter().run(scene).find((d) => d.ruleId === "connector-crosses-obstacle");
    expect(rerouted).toBeUndefined();
  });

  it("reports no blocking errors on a clean scene", () => {
    const scene = new Scene();
    scene._put(box("a", "A"));
    const linter = new Linter();
    expect(linter.hasBlockingErrors(scene)).toBe(false);
  });
});
