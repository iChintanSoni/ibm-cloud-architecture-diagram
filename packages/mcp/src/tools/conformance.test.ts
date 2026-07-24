import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient } from "../testClient.js";

describe("conformance & export tools", () => {
  let client: Awaited<ReturnType<typeof createTestClient>>["client"];
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ client, close } = await createTestClient());
    await client.callTool({ name: "doc_create", arguments: { level: "blank" } });
  });

  afterEach(async () => {
    await close();
  });

  it("lint() reports a real diagnostic, and quickfix_apply resolves it by id", async () => {
    // An unlabeled box trips the missing-label rule (docs/05-ibm-spec-conformance.md).
    await client.callTool({ name: "element_add_box", arguments: { at: { x: 0, y: 0 } } });

    const lintResult = await client.callTool({ name: "lint", arguments: {} });
    const { diagnostics } = lintResult.structuredContent as {
      diagnostics: Array<{ id: string; ruleId: string; hasQuickFix: boolean }>;
    };
    expect(diagnostics.length).toBeGreaterThan(0);
    const fixable = diagnostics.find((d) => d.hasQuickFix);
    expect(fixable).toBeDefined();

    const applied = await client.callTool({
      name: "quickfix_apply",
      arguments: { diagnosticId: fixable!.id }
    });
    expect(applied.isError).toBeUndefined();

    // The id is stale now — reusing it must error clearly, not crash.
    const stale = await client.callTool({
      name: "quickfix_apply",
      arguments: { diagnosticId: fixable!.id }
    });
    expect(stale.isError).toBe(true);
  });

  it("quickfix_apply_all fixes everything fixable in one call", async () => {
    await client.callTool({ name: "element_add_box", arguments: { at: { x: 0, y: 0 } } });
    await client.callTool({ name: "element_add_actor", arguments: { at: { x: 400, y: 0 } } });

    const result = await client.callTool({ name: "quickfix_apply_all", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { fixedCount: number }).fixedCount).toBeGreaterThan(0);
  });

  it("export_diagram(svg) returns parseable SVG with an embedded .icad source", async () => {
    await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 }, label: "Application tier" }
    });

    const result = await client.callTool({
      name: "export_diagram",
      arguments: { format: "svg" }
    });
    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text;
    expect(text).toContain("<svg");
    expect(text).toContain('id="icad:source"');
  });
});
