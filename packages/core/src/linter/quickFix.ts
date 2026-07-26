import { batch } from "../commands/commands.js";
import type { Command } from "../commands/types.js";
import type { Diagnostic } from "./types.js";

/** Wraps a diagnostic's fix in a named command for undo history and agent parity. */
export function applyQuickFix(diagnostic: Diagnostic): Command {
  if (!diagnostic.quickFix)
    throw new Error(`Diagnostic "${diagnostic.id}" has no quick-fix`);
  const command = diagnostic.quickFix;
  return {
    label: `fix ${diagnostic.ruleId}`,
    do(scene) {
      command.do(scene);
    },
    undo(scene) {
      command.undo(scene);
    },
  };
}

/** Applies a set of diagnostics as one undoable "Fix all" history step. */
export function applyQuickFixes(
  diagnostics: Diagnostic[],
  label = "fix validation issues",
): Command {
  return batch(
    label,
    diagnostics.filter((item) => item.quickFix).map(applyQuickFix),
  );
}
