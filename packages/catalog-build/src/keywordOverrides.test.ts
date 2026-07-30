import { describe, expect, it } from "vitest";
import { withKeywordOverrides } from "./keywordOverrides.js";

describe("withKeywordOverrides", () => {
  it("adds a manual override's terms to the auto-derived keywords", () => {
    expect(withKeywordOverrides("location", ["location"])).toEqual([
      "location",
      "region",
    ]);
  });

  it("leaves keywords untouched for a slug with no override", () => {
    expect(withKeywordOverrides("vpc", ["vpc"])).toEqual(["vpc"]);
  });

  it("dedupes if an override term is already present", () => {
    expect(
      withKeywordOverrides("database-redis", ["database", "redis", "cache"]),
    ).toEqual(["database", "redis", "cache"]);
  });
});
