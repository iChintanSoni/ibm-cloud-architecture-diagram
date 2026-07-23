import type { Scene } from "../scene/scene.js";
import { defaultRules } from "./rules.js";
import type { Diagnostic, Rule } from "./types.js";

/**
 * Advisory conformance checker (docs/05-ibm-spec-conformance.md). Never
 * blocks editing; export gating is layered on top by callers inspecting
 * the returned diagnostics' severities.
 */
export class Linter {
  constructor(private rules: Rule[] = defaultRules) {}

  run(scene: Scene): Diagnostic[] {
    return this.rules.flatMap((rule) => rule(scene));
  }

  hasBlockingErrors(scene: Scene): boolean {
    return this.run(scene).some((d) => d.severity === "error");
  }
}
