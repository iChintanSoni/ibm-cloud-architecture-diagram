import { describe, expect, it } from "vitest";
import { loadSkillFiles, skillSourcePath } from "./skills.js";

describe("loadSkillFiles", () => {
  it("reads the real packages/mcp/skills/*/SKILL.md content, keyed under the role's source path", async () => {
    const files = await loadSkillFiles("diagram-builder", [
      "ibm-diagram-authoring",
      "ibm-diagram-spec",
    ]);

    const authoringKey = `${skillSourcePath("diagram-builder")}ibm-diagram-authoring/SKILL.md`;
    const specKey = `${skillSourcePath("diagram-builder")}ibm-diagram-spec/SKILL.md`;
    expect(Object.keys(files).sort()).toEqual([authoringKey, specKey].sort());

    expect(files[authoringKey]?.content).toContain(
      "name: ibm-diagram-authoring",
    );
    expect(files[authoringKey]?.mimeType).toBe("text/markdown");
    expect(files[authoringKey]?.created_at).toBeTruthy();
  });

  it("scopes different roles to different source paths, even for the same skill name", async () => {
    const builderFiles = await loadSkillFiles("diagram-builder", [
      "ibm-diagram-spec",
    ]);
    const exporterFiles = await loadSkillFiles("conformance-exporter", [
      "ibm-diagram-spec",
    ]);

    expect(Object.keys(builderFiles)).not.toEqual(Object.keys(exporterFiles));
    // Same real file content either way — only the virtual path differs.
    const [builderEntry] = Object.values(builderFiles);
    const [exporterEntry] = Object.values(exporterFiles);
    expect(builderEntry?.content).toBe(exporterEntry?.content);
  });
});
