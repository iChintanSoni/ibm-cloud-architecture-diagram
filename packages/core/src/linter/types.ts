import type { Catalog } from "../catalog/catalog.js";
import type { Scene } from "../scene/scene.js";
import type { ConformanceSeverity, ElementId } from "../scene/types.js";
import type { Command } from "../commands/types.js";

export type Severity = Exclude<ConformanceSeverity, "off">;
export type RuleCategory =
  "semantics" | "containment" | "labels" | "connectors" | "layout";

export interface Diagnostic {
  id: string;
  ruleId: string;
  severity: Severity;
  message: string;
  category: RuleCategory;
  elementId?: ElementId;
  /** Present when the violation can be auto-resolved via a Command. */
  quickFix?: Command;
  quickFixLabel?: string;
}

export interface RuleContext {
  catalog?: Catalog;
}

export type Rule = (scene: Scene, context?: RuleContext) => Diagnostic[];

export interface RuleMetadata {
  id: string;
  title: string;
  category: RuleCategory;
  defaultSeverity: Severity;
}
