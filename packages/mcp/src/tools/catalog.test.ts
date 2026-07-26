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
});
