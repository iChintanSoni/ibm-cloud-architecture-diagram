import type { Diagnostic, ExportGate, Severity } from "@icad/core";

export interface DiagnosticGroup {
  severity: Severity;
  items: Diagnostic[];
}

export interface ValidationView {
  groups: DiagnosticGroup[];
  counts: Record<Severity, number>;
  fixableByRule: Map<string, number>;
  exportBlocked: boolean;
}

const SEVERITY_ORDER: Severity[] = ["error", "warn", "info"];

/** Pure projection used by both the validation panel and export summary. */
export function buildValidationView(
  diagnostics: Diagnostic[],
  exportGate: ExportGate,
): ValidationView {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  const fixableByRule = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
    if (diagnostic.quickFix) {
      fixableByRule.set(
        diagnostic.ruleId,
        (fixableByRule.get(diagnostic.ruleId) ?? 0) + 1,
      );
    }
  }

  return {
    groups: SEVERITY_ORDER.map((severity) => ({
      severity,
      items: diagnostics.filter(
        (diagnostic) => diagnostic.severity === severity,
      ),
    })),
    counts,
    fixableByRule,
    exportBlocked: exportGate === "block" && counts.error > 0,
  };
}
