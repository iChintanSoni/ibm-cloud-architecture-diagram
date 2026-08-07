import { describe, expect, it } from "vitest";
import { sceneElementSchema, validateElements } from "./icadSchema.js";

function box(overrides: Record<string, unknown> = {}) {
  return {
    id: "box-1",
    type: "box",
    semantic: "deployedOn",
    x: 10,
    y: 20,
    w: 200,
    h: 150,
    ...overrides,
  };
}

function connector(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: "a", port: "e" },
    to: { elementId: "b", port: "w" },
    connectorType: "association",
    ...overrides,
  };
}

describe("sceneElementSchema (I14, docs/improvement-plan.md#i14--icad-schema-validation)", () => {
  it("accepts a well-formed box", () => {
    expect(sceneElementSchema.safeParse(box()).success).toBe(true);
  });

  it("accepts a well-formed connector", () => {
    expect(sceneElementSchema.safeParse(connector()).success).toBe(true);
  });

  it("rejects an unknown type discriminant", () => {
    expect(sceneElementSchema.safeParse(box({ type: "hexagon" })).success).toBe(
      false,
    );
  });

  it("rejects a semantic that doesn't match its type", () => {
    // "box" must carry semantic "deployedOn" — "boundary" is Zone's, not Box's.
    expect(
      sceneElementSchema.safeParse(box({ semantic: "boundary" })).success,
    ).toBe(false);
  });

  it("rejects a non-finite x", () => {
    expect(sceneElementSchema.safeParse(box({ x: Number.NaN })).success).toBe(
      false,
    );
  });

  it("rejects an Infinity y", () => {
    expect(
      sceneElementSchema.safeParse(box({ y: Number.POSITIVE_INFINITY }))
        .success,
    ).toBe(false);
  });

  it("accepts a non-finite w/h — repair()'s existing clampSize step handles it, not this schema", () => {
    const result = sceneElementSchema.safeParse(box({ w: 0, h: Number.NaN }));
    expect(result.success).toBe(true);
  });

  it("rejects a missing required field (iconNode without catalogRef)", () => {
    expect(
      sceneElementSchema.safeParse({
        id: "icon-1",
        type: "iconNode",
        semantic: "node",
        x: 0,
        y: 0,
        w: 48,
        h: 48,
      }).success,
    ).toBe(false);
  });

  it("rejects an unrecognized extra field", () => {
    expect(
      sceneElementSchema.safeParse(box({ notARealField: "surprise" })).success,
    ).toBe(false);
  });

  it("never lets a __proto__ key on a parsed element actually pollute Object.prototype", () => {
    // `JSON.parse` itself is already safe here — it creates a real *own* property literally
    // named "__proto__" via [[DefineOwnProperty]], not the special prototype-chain setter object
    // *literal* syntax (`{ __proto__: x }`) would trigger — confirmed directly, not assumed.
    // What this test actually guards is zod's own handling of that own-key: `.strict()` doesn't
    // flag "__proto__" as an unrecognized field the way it does any other extra key (confirmed
    // against the installed zod version — a schema-library quirk, not something this module
    // controls), so the real property under test is the one that matters: it must never survive
    // into the parsed output or reach the actual prototype chain, on this schema or any other.
    const malicious = JSON.parse(
      `{"id":"box-1","type":"box","semantic":"deployedOn","x":0,"y":0,"w":10,"h":10,"__proto__":{"polluted":true}}`,
    ) as Record<string, unknown>;
    const result = sceneElementSchema.safeParse(malicious);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    if (result.success) {
      expect(
        Object.prototype.hasOwnProperty.call(result.data, "__proto__"),
      ).toBe(false);
    }
  });

  it("rejects an invalid connector port side", () => {
    expect(
      sceneElementSchema.safeParse(
        connector({ from: { elementId: "a", port: "northwest" } }),
      ).success,
    ).toBe(false);
  });

  it("rejects an invalid connectorType", () => {
    expect(
      sceneElementSchema.safeParse(connector({ connectorType: "friendship" }))
        .success,
    ).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(sceneElementSchema.safeParse(box({ id: "" })).success).toBe(false);
  });

  it("accepts optional fields entirely omitted", () => {
    expect(sceneElementSchema.safeParse(box()).success).toBe(true);
  });

  it("rejects a locked/hidden field of the wrong type", () => {
    expect(sceneElementSchema.safeParse(box({ locked: "yes" })).success).toBe(
      false,
    );
  });
});

describe("validateElements", () => {
  it("keeps every well-formed element, in order", () => {
    const { valid, dropped } = validateElements([
      box({ id: "a" }),
      box({ id: "b" }),
    ]);
    expect(dropped).toHaveLength(0);
    expect(valid).toHaveLength(2);
    expect((valid[0] as { id: string }).id).toBe("a");
    expect((valid[1] as { id: string }).id).toBe("b");
  });

  it("drops one malformed element without discarding its well-formed siblings", () => {
    const { valid, dropped } = validateElements([
      box({ id: "good-1" }),
      box({ id: "bad", type: "not-a-real-type" }),
      box({ id: "good-2" }),
    ]);
    expect(valid).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.id).toBe("bad");
    expect(dropped[0]!.index).toBe(1);
  });

  it("reports a dropped element's index even when its id itself isn't a string", () => {
    const { dropped } = validateElements([{ type: "box", id: 12345 }]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.id).toBeUndefined();
    expect(dropped[0]!.index).toBe(0);
  });

  it("never throws on completely garbage input", () => {
    expect(() =>
      validateElements([null, undefined, 42, "string", [], {}]),
    ).not.toThrow();
    const { valid, dropped } = validateElements([
      null,
      undefined,
      42,
      "string",
      [],
      {},
    ]);
    expect(valid).toHaveLength(0);
    expect(dropped).toHaveLength(6);
  });

  it("includes a human-readable reason mentioning the offending field", () => {
    const { dropped } = validateElements([box({ x: "not a number" })]);
    expect(dropped[0]!.reason).toContain("x");
  });
});
