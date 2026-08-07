import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDiagramTask } from "./runDiagramTask.js";

// Live end-to-end: a real local Ollama model, driving the real diagram-builder agent and
// (conditionally, M30.3) the conformance-exporter agent, against a real spawned @icad/mcp
// subprocess. This is the milestone's own "Done when" bar
// (docs/roadmap.md#m30--deep-agent-orchestrator--sub-agents): a hardcoded natural-language
// requirement produces a lint-clean .icad + exported SVG for a real multi-tier topology — not a
// mock of any of these pieces.
//
// Requires `ollama serve` running locally with the model pulled
// (`ollama pull qwen3:8b`, or set ICAD_AGENT_MODEL to whatever's available).

describe("runDiagramTask (live Ollama)", () => {
  const icadPath = path.join(tmpdir(), `icad-agent-int-${process.pid}.icad`);
  const svgPath = path.join(tmpdir(), `icad-agent-int-${process.pid}.svg`);
  const pngPath = path.join(tmpdir(), `icad-agent-int-${process.pid}.png`);

  afterEach(async () => {
    await rm(icadPath, { force: true });
    await rm(svgPath, { force: true });
    await rm(pngPath, { force: true });
  });

  it("builds a lint-clean multi-tier diagram from a natural-language requirement", async () => {
    const result = await runDiagramTask({
      requirement:
        "A Customer actor connects through a Load Balancer to an Application tier group " +
        "containing two Virtual Server instances, which connect to a PostgreSQL database.",
      level: "blank",
      outputIcadPath: icadPath,
      outputSvgPath: svgPath,
      outputPngPath: pngPath,
    });

    if (!result.success) {
      // Surface *why*, not just that it failed — diagnostics/transcript are the whole point of
      // keeping this test's failure output readable when a local model doesn't fully cooperate.
      console.error(
        "runDiagramTask failed:",
        result.reason,
        result.diagnostics,
      );
    }
    expect(result.success).toBe(true);
    if (!result.success) return;

    const svg = await readFile(result.svgPath, "utf-8");
    expect(svg).toContain("<svg");

    const icad = JSON.parse(await readFile(result.icadPath, "utf-8")) as {
      elements: unknown[];
    };
    expect(icad.elements.length).toBeGreaterThan(3);

    const png = await readFile(result.pngPath!);
    expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
  });
});
