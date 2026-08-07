import { describe, expect, it } from "vitest";
import type { StructuredTool } from "@langchain/core/tools";
import {
  CONFORMANCE_EXPORTER_TOOL_NAMES,
  DIAGRAM_BUILDER_TOOL_NAMES,
  pickTools,
} from "./tools.js";

function fakeTool(name: string): StructuredTool {
  return { name } as StructuredTool;
}

describe("pickTools", () => {
  it("returns the named tools in the order requested, not the input order", () => {
    const tools = [fakeTool("a"), fakeTool("b"), fakeTool("c")];
    expect(pickTools(tools, ["c", "a"]).map((t) => t.name)).toEqual(["c", "a"]);
  });

  it("throws on a name that doesn't resolve, naming which one", () => {
    expect(() => pickTools([fakeTool("a")], ["a", "missing"])).toThrow(
      /missing/,
    );
  });
});

describe("tool name partitions (docs/decision-log.md#d33)", () => {
  it("diagram-builder and conformance-exporter never claim the same tool", () => {
    const overlap = DIAGRAM_BUILDER_TOOL_NAMES.filter((name) =>
      (CONFORMANCE_EXPORTER_TOOL_NAMES as readonly string[]).includes(name),
    );
    expect(overlap).toEqual([]);
  });

  it("neither sub-agent touches document lifecycle (handled procedurally, not by an LLM)", () => {
    const lifecycle = ["doc_create", "doc_open", "doc_get"];
    const all = [
      ...DIAGRAM_BUILDER_TOOL_NAMES,
      ...CONFORMANCE_EXPORTER_TOOL_NAMES,
    ];
    for (const name of lifecycle) {
      expect(all).not.toContain(name);
    }
  });

  it("neither sub-agent exports or saves (handled procedurally with the real paths, not relayed through an LLM)", () => {
    const finishing = ["export_diagram", "doc_save"];
    const all = [
      ...DIAGRAM_BUILDER_TOOL_NAMES,
      ...CONFORMANCE_EXPORTER_TOOL_NAMES,
    ];
    for (const name of finishing) {
      expect(all).not.toContain(name);
    }
  });
});
