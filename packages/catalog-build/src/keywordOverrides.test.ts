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

  it("adds 'lb' as a searchable abbreviation for a load-balancer icon", () => {
    expect(
      withKeywordOverrides("load-balancer-vpc", ["load", "balancer", "vpc"]),
    ).toEqual(["load", "balancer", "vpc", "lb"]);
  });

  it("adds 'k8s' as a searchable abbreviation for Kubernetes, not OpenShift", () => {
    expect(withKeywordOverrides("kubernetes", ["kubernetes"])).toEqual([
      "kubernetes",
      "k8s",
    ]);
    expect(withKeywordOverrides("open-shift", ["open", "shift"])).toEqual([
      "open",
      "shift",
    ]);
  });

  it("adds 'vm' and 'vsi' as searchable synonyms for Virtual Server", () => {
    expect(
      withKeywordOverrides("virtual-server", ["virtual", "server"]),
    ).toEqual(["virtual", "server", "vm", "vsi"]);
  });
});
