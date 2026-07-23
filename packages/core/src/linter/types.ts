import type { Scene } from "../scene/scene.js";
import type { ElementId } from "../scene/types.js";
import type { Command } from "../commands/types.js";

export type Severity = "error" | "warn" | "info";

export interface Diagnostic {
  id: string;
  ruleId: string;
  severity: Severity;
  message: string;
  elementId?: ElementId;
  /** Present when the violation can be auto-resolved via a Command. */
  quickFix?: Command;
}

export type Rule = (scene: Scene) => Diagnostic[];
