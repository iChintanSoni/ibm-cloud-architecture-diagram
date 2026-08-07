import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export type SkillName =
  "ibm-diagram-authoring" | "ibm-diagram-spec" | "ibm-diagram-export";

/** deepagents' `FileDataV2` shape (current format; see langchain-ai/deepagentsjs
 * `src/backends/protocol.ts`) — a plain in-memory file entry, no real disk write involved. */
export interface SkillFile {
  content: string;
  mimeType: string;
  created_at: string;
  modified_at: string;
}

/** `@icad/mcp` ships its skills/ directory as a sibling of dist/ (its `package.json` `"files"`
 * includes both) — resolve from the same real-module-resolution root `McpSession` uses to find
 * the compiled server, rather than a separate hardcoded relative path. */
function skillsRoot(): string {
  const mcpEntrypoint = createRequire(import.meta.url).resolve("@icad/mcp");
  return path.join(path.dirname(mcpEntrypoint), "..", "skills");
}

/** The deepagents `skills` source-path convention: a directory containing one subdirectory per
 * skill, each with its own SKILL.md. `role` scopes each sub-agent to only the skills it should
 * see (docs/decision-log.md#d33) — diagram-builder and conformance-exporter each get their own
 * root, even though both include `ibm-diagram-spec`, rather than sharing one root that would
 * expose all three skills to both. */
export function skillSourcePath(
  role: "diagram-builder" | "conformance-exporter",
): string {
  return `/skills/${role}/`;
}

/** Reads the real `packages/mcp/skills/*\/SKILL.md` files (D33) into the deepagents `files` state
 * shape, keyed under the given role's source path, so `createDeepAgent`'s `skills` option can
 * load them from the default ephemeral `StateBackend` (D36) — nothing is written to real disk,
 * and nothing persists past one task. */
export async function loadSkillFiles(
  role: "diagram-builder" | "conformance-exporter",
  names: readonly SkillName[],
): Promise<Record<string, SkillFile>> {
  const root = skillsRoot();
  const base = skillSourcePath(role);
  const now = new Date().toISOString();
  const entries = await Promise.all(
    names.map(async (name) => {
      const content = await readFile(
        path.join(root, name, "SKILL.md"),
        "utf-8",
      );
      const file: SkillFile = {
        content,
        mimeType: "text/markdown",
        created_at: now,
        modified_at: now,
      };
      return [`${base}${name}/SKILL.md`, file] as const;
    }),
  );
  return Object.fromEntries(entries);
}
