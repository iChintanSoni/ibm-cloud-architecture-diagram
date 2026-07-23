import { describe, expect, it } from "vitest";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it("lowercases and dashes spaces", () => {
    expect(slugify("Bare Metal Server 01")).toBe("bare-metal-server-01");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("ibm--cloudant")).toBe("ibm-cloudant");
    expect(slugify(" --Edge-- ")).toBe("edge");
  });
});
