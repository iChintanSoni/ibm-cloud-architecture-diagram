import { describe, expect, it } from "vitest";
import { createTestClient } from "./testClient.js";

describe("createMcpServer", () => {
  it("lists every tool from every registered group", async () => {
    const { client, close } = await createTestClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        [
          "catalog_categories",
          "catalog_search",
          "connect",
          "connect_nearest",
          "connector_reset_routing",
          "connector_retarget",
          "doc_create",
          "doc_get",
          "doc_open",
          "doc_save",
          "element_add_actor",
          "element_add_box",
          "element_add_frame",
          "element_add_group",
          "element_add_icon",
          "element_add_text",
          "element_add_zone",
          "element_align_bottom",
          "element_align_center_horizontal",
          "element_align_left",
          "element_align_middle",
          "element_align_right",
          "element_align_top",
          "element_bring_forward",
          "element_bring_to_front",
          "element_delete",
          "element_distribute_horizontal",
          "element_distribute_vertical",
          "element_hide",
          "element_lock",
          "element_move",
          "element_reparent",
          "element_send_backward",
          "element_send_to_back",
          "element_show",
          "element_unlock",
          "element_update",
          "export_diagram",
          "frame_reorder",
          "group_elements",
          "lint",
          "quickfix_apply",
          "quickfix_apply_all",
          "ungroup_element",
        ].sort(),
      );
    } finally {
      await close();
    }
  });

  it("gives each test its own isolated document (no cross-test state)", async () => {
    const a = await createTestClient();
    const b = await createTestClient();
    try {
      await a.client.callTool({
        name: "doc_create",
        arguments: { level: "blank" },
      });
      const result = await b.client.callTool({
        name: "doc_get",
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
