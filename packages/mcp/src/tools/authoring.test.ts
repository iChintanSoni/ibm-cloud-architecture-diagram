import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient } from "../testClient.js";

describe("authoring tools", () => {
  let client: Awaited<ReturnType<typeof createTestClient>>["client"];
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ client, close } = await createTestClient());
    await client.callTool({ name: "doc_create", arguments: { level: "blank" } });
  });

  afterEach(async () => {
    await close();
  });

  it("adds a catalog icon found via catalog_search", async () => {
    const search = await client.callTool({ name: "catalog_search", arguments: { query: "vpc" } });
    const { icons } = search.structuredContent as { icons: Array<{ id: string }> };
    expect(icons.length).toBeGreaterThan(0);

    const added = await client.callTool({
      name: "element_add_icon",
      arguments: { catalogRef: icons[0]!.id, at: { x: 100, y: 100 } }
    });
    expect(added.isError).toBeUndefined();
    expect((added.structuredContent as { id: string }).id).toBeTruthy();
  });

  it("connects two elements with connect_nearest and can group/ungroup them", async () => {
    const box = await client.callTool({ name: "element_add_box", arguments: { at: { x: 0, y: 0 } } });
    const actor = await client.callTool({ name: "element_add_actor", arguments: { at: { x: 400, y: 0 } } });
    const boxId = (box.structuredContent as { id: string }).id;
    const actorId = (actor.structuredContent as { id: string }).id;

    const connected = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: boxId, toId: actorId }
    });
    expect(connected.isError).toBeUndefined();

    const grouped = await client.callTool({
      name: "group_elements",
      arguments: { ids: [boxId, actorId] }
    });
    expect(grouped.isError).toBeUndefined();
    const groupId = (grouped.structuredContent as { id: string }).id;

    const ungrouped = await client.callTool({ name: "ungroup_element", arguments: { id: groupId } });
    expect(ungrouped.isError).toBeUndefined();

    // The group is gone; ungrouping it again (or ungrouping a non-container) is a clear error, not
    // a silent no-op, even though the underlying Editor.ungroupElement() no-ops quietly.
    const again = await client.callTool({ name: "ungroup_element", arguments: { id: groupId } });
    expect(again.isError).toBe(true);
    const nonContainer = await client.callTool({ name: "ungroup_element", arguments: { id: actorId } });
    expect(nonContainer.isError).toBe(true);
  });

  it("connect_nearest errors clearly instead of returning undefined for an invalid pair", async () => {
    const box = await client.callTool({ name: "element_add_box", arguments: { at: { x: 0, y: 0 } } });
    const boxId = (box.structuredContent as { id: string }).id;
    const result = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: boxId, toId: boxId }
    });
    expect(result.isError).toBe(true);
  });

  it("group_elements errors clearly for fewer than two known ids", async () => {
    const box = await client.callTool({ name: "element_add_box", arguments: { at: { x: 0, y: 0 } } });
    const boxId = (box.structuredContent as { id: string }).id;
    const result = await client.callTool({ name: "group_elements", arguments: { ids: [boxId] } });
    expect(result.isError).toBe(true);
  });

  it("element_move nudges and element_delete removes", async () => {
    const box = await client.callTool({ name: "element_add_box", arguments: { at: { x: 0, y: 0 } } });
    const boxId = (box.structuredContent as { id: string }).id;

    await client.callTool({ name: "element_move", arguments: { ids: [boxId], dx: 10, dy: 5 } });
    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const element = (doc.structuredContent as { document: { elements: Array<{ id: string; x: number; y: number }> } })
      .document.elements.find((el) => el.id === boxId)!;
    expect(element.x).toBe(10);
    expect(element.y).toBe(5);

    const deleted = await client.callTool({ name: "element_delete", arguments: { ids: [boxId] } });
    expect(deleted.isError).toBeUndefined();
    const docAfter = await client.callTool({ name: "doc_get", arguments: {} });
    expect((docAfter.structuredContent as { document: { elements: unknown[] } }).document.elements).toHaveLength(0);
  });

  it("frame_reorder applies an exact presentation order", async () => {
    const a = await client.callTool({ name: "element_add_frame", arguments: { at: { x: 0, y: 0 }, name: "A" } });
    const b = await client.callTool({ name: "element_add_frame", arguments: { at: { x: 900, y: 0 }, name: "B" } });
    const aId = (a.structuredContent as { id: string }).id;
    const bId = (b.structuredContent as { id: string }).id;

    const reordered = await client.callTool({ name: "frame_reorder", arguments: { frameIds: [bId, aId] } });
    expect(reordered.isError).toBeUndefined();

    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const frames = (doc.structuredContent as { document: { elements: Array<{ id: string; order: number }> } })
      .document.elements.filter((el) => el.id === aId || el.id === bId)
      .sort((x, y) => x.order - y.order);
    expect(frames.map((f) => f.id)).toEqual([bId, aId]);
  });
});
