import type { Catalog } from "../catalog/catalog.js";
import type { Scene } from "../scene/scene.js";
import { defaultRules } from "./rules.js";
import type { Diagnostic, Rule, RuleContext } from "./types.js";

export interface LinterOptions {
  rules?: Rule[];
  catalog?: Catalog;
}

/**
 * Advisory conformance checker (docs/05-ibm-spec-conformance.md). Never
 * blocks editing; export gating is layered on top by callers inspecting
 * the returned diagnostics' severities.
 */
export class Linter {
  private rules: Rule[];
  private context: RuleContext;

  constructor(options: Rule[] | LinterOptions = {}) {
    if (Array.isArray(options)) {
      this.rules = options;
      this.context = {};
    } else {
      this.rules = options.rules ?? defaultRules;
      this.context = {
        ...(options.catalog ? { catalog: options.catalog } : {}),
      };
    }
  }

  run(scene: Scene): Diagnostic[] {
    return this.rules
      .flatMap((rule) => rule(scene, this.context))
      .flatMap((diagnostic) => {
        const severity = scene.conformance.ruleSeverities[diagnostic.ruleId];
        if (severity === "off") return [];
        return [{ ...diagnostic, severity: severity ?? diagnostic.severity }];
      });
  }

  hasBlockingErrors(scene: Scene): boolean {
    return this.run(scene).some((d) => d.severity === "error");
  }
}
