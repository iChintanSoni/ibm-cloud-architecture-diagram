import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerState } from "../state.js";
import { catalogCategorySchema, iconMetaSchema } from "../schemas.js";
import { fail, ok } from "../toolResult.js";

/** Caps how many icons a single catalog_search call hands back — a broad query (a catalog term
 * that's also a common English word) can otherwise match a large fraction of the whole catalog,
 * which costs real context for no benefit once results stop being relevant. Results are ranked by
 * Catalog.search() before this cap is applied, so truncation drops the least relevant matches. */
const SEARCH_RESULT_LIMIT = 25;

/** No open-document gate here — the catalog is available before any `doc_create`/`doc_open`. */
export function registerCatalogTools(
  server: McpServer,
  state: ServerState,
): void {
  server.registerTool(
    "catalog_search",
    {
      title: "Search the IBM Cloud icon catalog",
      description:
        "Search the bundled IBM Cloud icon catalog (packages/catalog-build/docs/icon-catalog.md) by name, category, or keyword, " +
        `ranked by relevance and capped at the ${SEARCH_RESULT_LIMIT} best matches. Returns matching icons ` +
        "with the `id` to pass as `catalogRef` to element_add_icon. If `truncated` is true, narrow the query " +
        "(e.g. add a category word) rather than assuming these are every match.",
      inputSchema: {
        query: z
          .string()
          .describe("Free-text search — name, category, or keyword"),
      },
      outputSchema: {
        icons: z.array(iconMetaSchema),
        totalMatches: z.number(),
        truncated: z.boolean(),
      },
    },
    ({ query }) => {
      try {
        const allMatches = state.editor.catalog.search(query);
        const icons = allMatches.slice(0, SEARCH_RESULT_LIMIT);
        const truncated = allMatches.length > icons.length;
        return ok(
          { icons, totalMatches: allMatches.length, truncated },
          `${icons.length} of ${allMatches.length} matching icon(s) for "${query}"` +
            (truncated ? " (narrow the query to see the rest)" : ""),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "catalog_categories",
    {
      title: "List catalog categories",
      description: "List every category in the bundled IBM Cloud icon catalog.",
      outputSchema: { categories: z.array(catalogCategorySchema) },
    },
    () => {
      try {
        const categories = state.editor.catalog.categories();
        return ok(
          { categories },
          `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}
