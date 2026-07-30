import { describe, expect, it } from "vitest";
import { createTestClient } from "../testClient.js";

describe("catalog tools", () => {
  it("catalog_search and catalog_categories work before any document is open", async () => {
    const { client, close } = await createTestClient();
    try {
      const search = await client.callTool({
        name: "catalog_search",
        arguments: { query: "vpc" },
      });
      expect(search.isError).toBeUndefined();
      const { icons } = search.structuredContent as {
        icons: Array<{ id: string; name: string }>;
      };
      expect(icons.length).toBeGreaterThan(0);

      const categories = await client.callTool({
        name: "catalog_categories",
        arguments: {},
      });
      expect(categories.isError).toBeUndefined();
      const { categories: list } = categories.structuredContent as {
        categories: Array<{ id: string }>;
      };
      expect(list.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("caps a broad query's results and reports how many matched in total", async () => {
    const { client, close } = await createTestClient();
    try {
      // A single letter matches well over the cap across the real catalog's names/keywords — a
      // deliberately extreme stand-in for "broad, low-signal query" that doesn't depend on any
      // one word's exact hit count staying above the cap as the catalog's own content evolves.
      const search = await client.callTool({
        name: "catalog_search",
        arguments: { query: "a" },
      });
      expect(search.isError).toBeUndefined();
      const { icons, totalMatches, truncated } = search.structuredContent as {
        icons: Array<{ id: string }>;
        totalMatches: number;
        truncated: boolean;
      };
      expect(icons.length).toBeLessThanOrEqual(25);
      expect(totalMatches).toBeGreaterThan(icons.length);
      expect(truncated).toBe(true);
    } finally {
      await close();
    }
  });
});
