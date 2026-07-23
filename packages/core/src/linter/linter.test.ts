import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement, ConnectorElement } from "../scene/types.js";
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

  it("reports no blocking errors on a clean scene", () => {
    const scene = new Scene();
    scene._put(box("a", "A"));
    const linter = new Linter();
    expect(linter.hasBlockingErrors(scene)).toBe(false);
  });
});
