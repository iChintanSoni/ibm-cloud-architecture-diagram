import { describe, expect, it } from "vitest";
import { CommandBus } from "../commands/commandBus.js";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { applyQuickFix, applyQuickFixes } from "./quickFix.js";
import { missingLabelRule } from "./rules.js";
import type { Diagnostic } from "./types.js";

function unlabeledBox(id: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 0,
    y: 0,
    w: 100,
    h: 100
  };
}

describe("quick-fix commands", () => {
  it("rejects diagnostics that have no automatic fix", () => {
    const diagnostic: Diagnostic = {
      id: "manual",
      ruleId: "manual",
      severity: "warn",
      category: "layout",
      message: "Requires user judgment"
    };
    expect(() => applyQuickFix(diagnostic)).toThrow(/has no quick-fix/);
  });

  it("wraps a fix with a meaningful undo-history label", () => {
    const scene = new Scene();
    scene._put(unlabeledBox("a"));
    const diagnostic = missingLabelRule(scene)[0]!;
    const command = applyQuickFix(diagnostic);

    expect(command.label).toBe("fix missing-label");
    command.do(scene);
    expect(scene.get("a")?.label?.text).toBe("Untitled");
    command.undo(scene);
    expect(scene.get("a")?.label).toBeUndefined();
  });

  it("batches multiple fixes into one command-bus undo step", () => {
    const scene = new Scene();
    scene._put(unlabeledBox("a"));
    scene._put(unlabeledBox("b"));
    const bus = new CommandBus(scene);

    bus.dispatch(applyQuickFixes(missingLabelRule(scene), "fix missing labels"));
    expect(scene.get("a")?.label?.text).toBe("Untitled");
    expect(scene.get("b")?.label?.text).toBe("Untitled");

    expect(bus.undo()).toBe(true);
    expect(scene.get("a")?.label).toBeUndefined();
    expect(scene.get("b")?.label).toBeUndefined();
    expect(bus.undo()).toBe(false);
  });
});
