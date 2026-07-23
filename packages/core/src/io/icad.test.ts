import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene.js";
import type { BoxElement } from "../scene/types.js";
import { applyIcad, fromIcad, toIcad } from "./icad.js";

function box(id: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 10,
    y: 20,
    w: 200,
    h: 150,
    label: { text: "VPC" }
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
      conformance: { exportGate: "block", ruleSeverities: { "missing-label": "error" } }
    });
    const restored = fromIcad(toIcad(scene));
    expect(restored.conformance).toEqual({
      exportGate: "block",
      ruleSeverities: { "missing-label": "error" }
    });
  });

  it("defaults conformance settings when opening a pre-M6 schema-v1 document", () => {
    const scene = fromIcad({
      format: "icad",
      version: 1,
      elements: [box("legacy")]
    });
    expect(scene.conformance).toEqual({ exportGate: "warn", ruleSeverities: {} });
  });

  it("rejects a document with the wrong format tag", () => {
    expect(() => fromIcad({ format: "drawio", version: 1, elements: [] })).toThrow(/expected format "icad"/);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => fromIcad({ format: "icad", version: 999, elements: [] })).toThrow(/Unsupported .icad schema version/);
  });

  it("rejects a non-object input", () => {
    expect(() => fromIcad(null)).toThrow(/expected a JSON object/);
  });

  it("rejects a non-positive-integer version", () => {
    expect(() => fromIcad({ format: "icad", version: 0, elements: [] })).toThrow(/version must be a positive integer/);
  });

  describe("repair on load", () => {
    it("clears a dangling parentId", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [{ ...box("orphan"), parentId: "missing-parent" }]
      });
      expect(scene.get("orphan")).not.toHaveProperty("parentId");
    });

    it("breaks a parentId cycle instead of hanging", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [
          { ...box("a"), parentId: "b" },
          { ...box("b"), parentId: "a" }
        ]
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
            connectorType: "association"
          }
        ]
      });
      expect(scene.has("conn")).toBe(false);
      expect(scene.has("kept")).toBe(true);
    });

    it("clamps non-positive or non-finite geometry to a minimum size", () => {
      const scene = fromIcad({
        format: "icad",
        version: 1,
        elements: [{ ...box("degenerate"), w: 0, h: Number.NaN }]
      });
      expect(scene.get("degenerate")).toMatchObject({ w: 1, h: 1 });
    });

    it("leaves a well-formed document untouched", () => {
      const doc = toIcad(new Scene({ meta: { title: "Demo" } }));
      const scene = fromIcad(doc);
      expect(scene.meta.title).toBe("Demo");
    });
  });
});
