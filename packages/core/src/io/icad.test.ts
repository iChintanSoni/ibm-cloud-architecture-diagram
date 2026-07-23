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

  it("rejects a document with the wrong format tag", () => {
    expect(() => fromIcad({ format: "drawio", version: 1, elements: [] })).toThrow(/expected format "icad"/);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => fromIcad({ format: "icad", version: 999, elements: [] })).toThrow(/Unsupported .icad schema version/);
  });

  it("rejects a non-object input", () => {
    expect(() => fromIcad(null)).toThrow(/expected a JSON object/);
  });
});
