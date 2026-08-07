import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpSession } from "./mcpSession.js";

// Real subprocess spawn + stdio handshake per test — slower than a mock, deliberately: the whole
// point of this suite is proving the real @icad/mcp binary round-trips, not a hand-written
// simulation of the MCP protocol (docs/roadmap.md#m29--agent-package-scaffold--mcp-subprocess-lifecycle).
const TEST_TIMEOUT_MS = 30_000;

describe("McpSession", () => {
  let session: McpSession | undefined;
  const icadPath = path.join(tmpdir(), `icad-agent-test-${process.pid}.icad`);
  const svgPath = path.join(tmpdir(), `icad-agent-test-${process.pid}.svg`);

  afterEach(async () => {
    await session?.close();
    session = undefined;
    await rm(icadPath, { force: true });
    await rm(svgPath, { force: true });
  });

  it(
    "round-trips a real .icad + .svg through a real spawned @icad/mcp subprocess",
    async () => {
      // The subprocess's workspace root is confined to tmpdir() (I13) so it can write the
      // .icad/.svg fixtures this test reads back below — matching how runDiagramTask itself
      // derives a root from its own caller-supplied output paths, not from anything the LLM
      // decides.
      session = await McpSession.start({ workspaceRoot: tmpdir() });

      await session.callTool("doc_create", { level: "blank", force: true });
      await session.callTool("element_add_box", {
        at: { x: 0, y: 0 },
        w: 200,
        h: 120,
        label: "Test Box",
      });
      await session.callTool("export_diagram", {
        format: "svg",
        path: svgPath,
        embedSource: true,
      });
      await session.callTool("doc_save", { path: icadPath });

      // Read what the real subprocess actually wrote to disk, rather than trusting whatever
      // shape the LangChain tool wrapper happens to return from .invoke() — a stronger proof
      // that the whole protocol round-trip (not just the call) is real.
      const svg = await readFile(svgPath, "utf-8");
      expect(svg).toContain("<svg");

      const icad = JSON.parse(await readFile(icadPath, "utf-8")) as {
        elements: unknown[];
      };
      expect(icad.elements).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects an unknown tool name instead of silently no-op-ing",
    async () => {
      session = await McpSession.start();
      await expect(session.callTool("not_a_real_tool", {})).rejects.toThrow(
        /not_a_real_tool/,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "surfaces a real, actionable schema-validation error to an agent tool call, not a generic message",
    async () => {
      // Regression test for a real live finding: @langchain/core's default error for a malformed
      // tool call is "Received tool input did not match expected schema" with zero detail — a
      // real qwen3:8b run burned ~35 minutes alternating between wrong scene_apply shapes with no
      // way to tell what was actually wrong. `verboseParsingErrors: true` (mcpSession.ts's
      // `withErrorRecovery`) should append the real Zod error instead.
      session = await McpSession.start();
      await session.callTool("doc_create", { level: "blank", force: true });

      const tools = await session.tools();
      const sceneApply = tools.find((t) => t.name === "scene_apply");
      expect(sceneApply).toBeDefined();

      // Deliberately malformed: connect_nearest requires string fromId/toId, not from/to objects.
      const result = (await sceneApply!.invoke({
        ops: [
          {
            kind: "connect_nearest",
            from: { elementId: "a", port: "e" },
            to: { elementId: "b", port: "w" },
          },
        ],
      })) as string;

      expect(result).toContain("Error calling scene_apply");
      // The generic message alone, with no real detail appended, is exactly the bug this guards
      // against — assert there's more here than just that one sentence.
      expect(result.length).toBeGreaterThan(
        "Error calling scene_apply: Received tool input did not match expected schema"
          .length,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
