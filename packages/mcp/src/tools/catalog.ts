import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerState } from "../state.js";
import { catalogCategorySchema, iconMetaSchema } from "../schemas.js";
import { fail, ok } from "../toolResult.js";

/** No open-document gate here — the catalog is available before any `doc_create`/`doc_open`. */
export function registerCatalogTools(server: McpServer, state: ServerState): void {
  server.registerTool(
    "catalog_search",
    {
      title: "Search the IBM Cloud icon catalog",
      description:
        "Search the bundled IBM Cloud icon catalog (docs/04-icon-catalog.md) by name, category, or keyword. " +
        "Returns matching icons with the `id` to pass as `catalogRef` to element_add_icon.",
      inputSchema: { query: z.string().describe("Free-text search — name, category, or keyword") },
      outputSchema: { icons: z.array(iconMetaSchema) }
    },
    ({ query }) => {
      try {
        const icons = state.editor.catalog.search(query);
        return ok({ icons }, `${icons.length} matching icon(s) for "${query}"`);
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "catalog_categories",
    {
      title: "List catalog categories",
      description: "List every category in the bundled IBM Cloud icon catalog.",
      outputSchema: { categories: z.array(catalogCategorySchema) }
    },
    () => {
      try {
        const categories = state.editor.catalog.categories();
        return ok({ categories }, `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`);
      } catch (err) {
        return fail(err);
      }
    }
  );
}
