import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTestClient } from "./testClient.js";

/** Guards against skill docs drifting from the real MCP surface (packages/mcp/docs/agent-integration.md:
 * "Skills version alongside the MCP toolset ... so guidance never references tools that don't
 * exist"). Every inline-code token shaped like a tool name (snake_case, or one of the rare
 * bare-word tool names) must be a real registered tool. */

const skillsDir = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../skills",
);
const expectedSkills = [
  "ibm-diagram-spec",
  "ibm-diagram-authoring",
  "ibm-diagram-export",
];

const bareWordToolNames = new Set(["lint", "connect"]);

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const fieldMatch = line.match(/^([a-zA-Z]+):\s*(.+)$/);
    if (fieldMatch) fields[fieldMatch[1]] = fieldMatch[2].trim();
  }
  return fields;
}

function toolLikeTokens(body: string): string[] {
  const tokens = [...body.matchAll(/`([a-z][a-z_]*)`/g)].map((m) => m[1]);
  return tokens.filter(
    (token) => token.includes("_") || bareWordToolNames.has(token),
  );
}

describe("agent skills", () => {
  it("ships exactly the three skills named in D16/roadmap M9.2", async () => {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(dirs.sort()).toEqual([...expectedSkills].sort());
  });

  for (const skill of expectedSkills) {
    it(`${skill}/SKILL.md has valid frontmatter and only references real MCP tools`, async () => {
      const raw = await readFile(
        path.join(skillsDir, skill, "SKILL.md"),
        "utf-8",
      );
      const frontmatter = parseFrontmatter(raw);
      expect(frontmatter.name).toBe(skill);
      expect(frontmatter.description?.length).toBeGreaterThan(20);

      const { client, close } = await createTestClient();
      try {
        const { tools } = await client.listTools();
        const realToolNames = new Set(tools.map((t) => t.name));
        const referenced = new Set(toolLikeTokens(raw));
        for (const token of referenced) {
          expect(
            realToolNames.has(token),
            `"${token}" in ${skill}/SKILL.md is not a real MCP tool`,
          ).toBe(true);
        }
      } finally {
        await close();
      }
    });
  }

  it("ibm-diagram-authoring and ibm-diagram-export both point back to ibm-diagram-spec", async () => {
    const authoring = await readFile(
      path.join(skillsDir, "ibm-diagram-authoring", "SKILL.md"),
      "utf-8",
    );
    const exportSkill = await readFile(
      path.join(skillsDir, "ibm-diagram-export", "SKILL.md"),
      "utf-8",
    );
    expect(authoring).toContain("ibm-diagram-spec");
    expect(authoring).toContain("ibm-diagram-export");
    expect(exportSkill).toContain("ibm-diagram-authoring");
  });
});
