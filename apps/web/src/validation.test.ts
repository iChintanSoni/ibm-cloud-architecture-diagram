import type { Command, Diagnostic, Severity } from "@icad/core";
import { describe, expect, it } from "vitest";
import { buildValidationView } from "./validation";

const noOpFix: Command = {
  label: "fix",
  do() {},
  undo() {}
};

function diagnostic(
  id: string,
  severity: Severity,
  ruleId = id,
  quickFix?: Command
): Diagnostic {
  return {
    id,
    ruleId,
    severity,
    category: "labels",
    message: id,
    ...(quickFix ? { quickFix } : {})
  };
}

describe("buildValidationView", () => {
  it("groups diagnostics in error, warning, info order and counts each severity", () => {
    const view = buildValidationView(
      [
        diagnostic("information", "info"),
        diagnostic("warning", "warn"),
        diagnostic("error-1", "error"),
        diagnostic("error-2", "error")
      ],
      "warn"
    );

    expect(view.groups.map((group) => group.severity)).toEqual(["error", "warn", "info"]);
    expect(view.groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["error-1", "error-2"],
      ["warning"],
      ["information"]
    ]);
    expect(view.counts).toEqual({ error: 2, warn: 1, info: 1 });
  });

  it("counts only actionable diagnostics for Fix all of this type", () => {
    const view = buildValidationView(
      [
        diagnostic("missing-1", "warn", "missing-label", noOpFix),
        diagnostic("missing-2", "warn", "missing-label", noOpFix),
        diagnostic("missing-3", "warn", "missing-label"),
        diagnostic("crossing", "warn", "connector-crosses-obstacle", noOpFix)
      ],
      "warn"
    );

    expect(view.fixableByRule.get("missing-label")).toBe(2);
    expect(view.fixableByRule.get("connector-crosses-obstacle")).toBe(1);
  });

  it("never blocks in advisory mode, even with errors", () => {
    expect(buildValidationView([diagnostic("error", "error")], "warn").exportBlocked).toBe(false);
  });

  it("blocks strict export only when at least one error exists", () => {
    expect(buildValidationView([diagnostic("warning", "warn")], "block").exportBlocked).toBe(false);
    expect(buildValidationView([diagnostic("error", "error")], "block").exportBlocked).toBe(true);
  });

  it("returns empty groups and zero counts for a clean document", () => {
    const view = buildValidationView([], "block");
    expect(view.groups.every((group) => group.items.length === 0)).toBe(true);
    expect(view.counts).toEqual({ error: 0, warn: 0, info: 0 });
    expect(view.exportBlocked).toBe(false);
  });
});
