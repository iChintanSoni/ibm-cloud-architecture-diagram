import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import {
  applyIcad,
  applyIcadWithReport,
  fromIcad,
  fromIcadWithReport,
  toIcad,
} from "./icad.js";

function box(id: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 10,
    y: 20,
    w: 200,
    h: 150,
    label: { text: "VPC" },
  };
}

describe(".icad io", () => {
  it("round-trips a scene through toIcad/fromIcad", () => {
    const scene = new Scene({ meta: { title: "Demo" } });
    scene._put(box("vpc"));

    const doc = toIcad(scene);
    expect(doc.format).toBe("icad");
    expect(doc.version).toBe(1);
    expect(doc.elements).toHaveLength(1);
    expect(doc.conformance).toEqual({ exportGate: "warn", ruleSeverities: {} });

    const restored = fromIcad(doc);
    expect(restored.meta.title).toBe("Demo");
    expect(restored.get("vpc")).toMatchObject({ id: "vpc", type: "box" });
  });

  it("applies a document onto an existing scene in place", () => {
    const scene = new Scene();
    scene._put(box("stale"));

    applyIcad(scene, toIcad(new Scene({ meta: { title: "Fresh" } })));

    expect(scene.meta.title).toBe("Fresh");
    expect(scene.has("stale")).toBe(false);
  });

  it("round-trips per-document conformance settings", () => {
    const scene = new Scene({
      conformance: {
        exportGate: "block",
        ruleSeverities: { "missing-label": "error" },
      },
    });
    const restored = fromIcad(toIcad(scene));
    expect(restored.conformance).toEqual({
      exportGate: "block",
      ruleSeverities: { "missing-label": "error" },
    });
  });

  it("defaults conformance settings when opening a pre-M6 schema-v1 document", () => {
    const scene = fromIcad({
      format: "icad",
      version: 1,
      elements: [box("legacy")],
    });
    expect(scene.conformance).toEqual({
      exportGate: "warn",
      ruleSeverities: {},
    });
  });

  it("rejects a document with the wrong format tag", () => {
    expect(() =>
      fromIcad({ format: "drawio", version: 1, elements: [] }),
    ).toThrow(/expected format "icad"/);
  });

  it("rejects an unsupported schema version", () => {
    expect(() =>
      fromIcad({ format: "icad", version: 999, elements: [] }),
    ).toThrow(/Unsupported .icad schema version/);
  });

  it("rejects a non-object input", () => {
    expect(() => fromIcad(null)).toThrow(/expected a JSON object/);
  });

  it("rejects a non-positive-integer version", () => {
    expect(() =>
      fromIcad({ format: "icad", version: 0, elements: [] }),
    ).toThrow(/version must be a positive integer/);
  });

  describe("repair on load", () => {
    it("clears a dangling parentId", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [{ ...box("orphan"), parentId: "missing-parent" }],
      });
      expect(scene.get("orphan")).not.toHaveProperty("parentId");
    });

    it("breaks a parentId cycle instead of hanging", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [
          { ...box("a"), parentId: "b" },
          { ...box("b"), parentId: "a" },
        ],
      });
      expect(scene.get("a")).not.toHaveProperty("parentId");
      expect(scene.get("b")).not.toHaveProperty("parentId");
    });

    it("drops a connector with a missing endpoint", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [
          box("kept"),
          {
            id: "conn",
            type: "connector",
            semantic: "node",
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            from: { elementId: "kept", port: "e" },
            to: { elementId: "gone", port: "w" },
            connectorType: "association",
          },
        ],
      });
      expect(scene.has("conn")).toBe(false);
      expect(scene.has("kept")).toBe(true);
    });

    it("clamps non-positive or non-finite geometry to a minimum size", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [{ ...box("degenerate"), w: 0, h: Number.NaN }],
      });
      expect(scene.get("degenerate")).toMatchObject({ w: 1, h: 1 });
    });

    it("leaves a well-formed document untouched", () => {
      const doc = toIcad(new Scene({ meta: { title: "Demo" } }));
      const scene = fromIcad(doc);
      expect(scene.meta.title).toBe("Demo");
    });

    it("drops an element with an unknown type discriminant instead of crashing the whole load (I14)", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [
          box("kept"),
          {
            id: "bogus",
            type: "hexagon",
            semantic: "node",
            x: 0,
            y: 0,
            w: 1,
            h: 1,
          },
        ],
      });
      expect(scene.has("kept")).toBe(true);
      expect(scene.has("bogus")).toBe(false);
    });

    it("drops an element whose semantic doesn't match its type (I14)", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [{ ...box("mismatched"), semantic: "boundary" }],
      });
      expect(scene.has("mismatched")).toBe(false);
    });

    it("drops an element with a non-finite x/y instead of letting NaN reach the live scene (I14)", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [box("kept"), { ...box("nan-x"), x: Number.NaN }],
      });
      expect(scene.has("kept")).toBe(true);
      expect(scene.has("nan-x")).toBe(false);
    });

    it("dedupes a duplicate id, keeping the first occurrence (I14)", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [
          { ...box("dup"), label: { text: "first" } },
          { ...box("dup"), label: { text: "second" } },
        ],
      });
      expect(scene.get("dup")).toMatchObject({ label: { text: "first" } });
    });

    it("never throws for a document whose elements array is entirely garbage (I14)", () => {
      expect(() =>
        fromIcad({
          format: "icad",
          version: 1,
          elements: [null, 42, "nope", { random: "shape" }],
        }),
      ).not.toThrow();
    });
  });

  describe("fromIcadWithReport / applyIcadWithReport (I14, docs/improvement-plan.md#i14--icad-schema-validation)", () => {
    it("reports invalid elements dropped for structural schema failures", () => {
      const { scene, report } = fromIcadWithReport({
        format: "icad",
        version: 1,
        elements: [box("kept"), { id: "bad", type: "hexagon" }],
      });
      expect(scene.has("kept")).toBe(true);
      expect(report.invalidElementsDropped).toHaveLength(1);
      expect(report.invalidElementsDropped[0]!.id).toBe("bad");
    });

    it("reports duplicate ids dropped, distinct from invalid-shape drops", () => {
      const { report } = fromIcadWithReport({
        format: "icad",
        version: 1,
        elements: [box("dup"), box("dup")],
      });
      expect(report.duplicateIdsDropped).toEqual(["dup"]);
      expect(report.invalidElementsDropped).toHaveLength(0);
    });

    it("still reports the pre-existing repair categories (dangling parent, cycle, dangling connector, geometry clamp)", () => {
      const { report } = fromIcadWithReport({
        format: "icad",
        version: 1,
        elements: [
          { ...box("orphan"), parentId: "missing-parent" },
          { ...box("cyc-a"), parentId: "cyc-b" },
          { ...box("cyc-b"), parentId: "cyc-a" },
          {
            id: "dangling-conn",
            type: "connector",
            semantic: "node",
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            from: { elementId: "orphan", port: "e" },
            to: { elementId: "nonexistent", port: "w" },
            connectorType: "association",
          },
          { ...box("degenerate"), w: 0, h: Number.NaN },
        ],
      });
      expect(report.danglingParentsCleared).toContain("orphan");
      expect(report.cyclesBroken).toEqual(
        expect.arrayContaining(["cyc-a", "cyc-b"]),
      );
      expect(report.danglingConnectorsDropped).toContain("dangling-conn");
      expect(report.geometryClamped).toContain("degenerate");
    });

    it("returns an all-empty report for an already-clean document", () => {
      const { report } = fromIcadWithReport(toIcad(new Scene()));
      expect(report).toEqual({
        invalidElementsDropped: [],
        duplicateIdsDropped: [],
        danglingParentsCleared: [],
        cyclesBroken: [],
        danglingConnectorsDropped: [],
        geometryClamped: [],
      });
    });

    it("applyIcadWithReport mirrors applyIcad but also returns the report", () => {
      const scene = new Scene();
      const report = applyIcadWithReport(scene, {
        format: "icad",
        version: 1,
        elements: [box("dup"), box("dup")],
      });
      expect(scene.has("dup")).toBe(true);
      expect(report.duplicateIdsDropped).toEqual(["dup"]);
    });

    it("applyIcad (the plain, pre-existing API) still behaves identically with the report discarded", () => {
      const scene = new Scene();
      applyIcad(scene, {
        format: "icad",
        version: 1,
        elements: [box("kept"), { id: "bad", type: "hexagon" }],
      });
      expect(scene.has("kept")).toBe(true);
      expect(scene.has("bad")).toBe(false);
    });
  });
});
