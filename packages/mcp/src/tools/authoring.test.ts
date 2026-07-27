import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient } from "../testClient.js";

describe("authoring tools", () => {
  let client: Awaited<ReturnType<typeof createTestClient>>["client"];
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ client, close } = await createTestClient());
    await client.callTool({
      name: "doc_create",
      arguments: { level: "blank" },
    });
  });

  afterEach(async () => {
    await close();
  });

  it("adds a catalog icon found via catalog_search", async () => {
    const search = await client.callTool({
      name: "catalog_search",
      arguments: { query: "vpc" },
    });
    const { icons } = search.structuredContent as {
      icons: Array<{ id: string }>;
    };
    expect(icons.length).toBeGreaterThan(0);

    const added = await client.callTool({
      name: "element_add_icon",
      arguments: { catalogRef: icons[0]!.id, at: { x: 100, y: 100 } },
    });
    expect(added.isError).toBeUndefined();
    expect((added.structuredContent as { id: string }).id).toBeTruthy();
  });

  it("connects two elements with connect_nearest and can group/ungroup them", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const actor = await client.callTool({
      name: "element_add_actor",
      arguments: { at: { x: 400, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;
    const actorId = (actor.structuredContent as { id: string }).id;

    const connected = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: boxId, toId: actorId },
    });
    expect(connected.isError).toBeUndefined();

    const grouped = await client.callTool({
      name: "group_elements",
      arguments: { ids: [boxId, actorId] },
    });
    expect(grouped.isError).toBeUndefined();
    const groupId = (grouped.structuredContent as { id: string }).id;

    const ungrouped = await client.callTool({
      name: "ungroup_element",
      arguments: { id: groupId },
    });
    expect(ungrouped.isError).toBeUndefined();

    // The group is gone; ungrouping it again (or ungrouping a non-container) is a clear error, not
    // a silent no-op, even though the underlying Editor.ungroupElement() no-ops quietly.
    const again = await client.callTool({
      name: "ungroup_element",
      arguments: { id: groupId },
    });
    expect(again.isError).toBe(true);
    const nonContainer = await client.callTool({
      name: "ungroup_element",
      arguments: { id: actorId },
    });
    expect(nonContainer.isError).toBe(true);
  });

  it("sets a connector's sequence badge at creation and updates it afterward", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const actor = await client.callTool({
      name: "element_add_actor",
      arguments: { at: { x: 400, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;
    const actorId = (actor.structuredContent as { id: string }).id;

    const connected = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: boxId, toId: actorId, sequence: "1" },
    });
    const connId = (connected.structuredContent as { id: string }).id;

    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const element = (
      doc.structuredContent as {
        document: { elements: Array<{ id: string; sequence?: string }> };
      }
    ).document.elements.find((el) => el.id === connId)!;
    expect(element.sequence).toBe("1");

    await client.callTool({
      name: "element_update",
      arguments: { id: connId, patch: { sequence: "2a" } },
    });
    const docAfter = await client.callTool({ name: "doc_get", arguments: {} });
    const updated = (
      docAfter.structuredContent as {
        document: { elements: Array<{ id: string; sequence?: string }> };
      }
    ).document.elements.find((el) => el.id === connId)!;
    expect(updated.sequence).toBe("2a");
  });

  it("sets a structured protocol annotation at creation and updates it afterward", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const actor = await client.callTool({
      name: "element_add_actor",
      arguments: { at: { x: 400, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;
    const actorId = (actor.structuredContent as { id: string }).id;

    const connected = await client.callTool({
      name: "connect_nearest",
      arguments: {
        fromId: boxId,
        toId: actorId,
        annotation: { name: "HTTPS", security: "TLS1.3", port: "443" },
      },
    });
    const connId = (connected.structuredContent as { id: string }).id;

    type AnnotationEl = {
      id: string;
      annotation?: { name: string; security?: string; port?: string };
    };
    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const element = (
      doc.structuredContent as { document: { elements: AnnotationEl[] } }
    ).document.elements.find((el) => el.id === connId)!;
    expect(element.annotation).toEqual({
      name: "HTTPS",
      security: "TLS1.3",
      port: "443",
    });

    await client.callTool({
      name: "element_update",
      arguments: { id: connId, patch: { annotation: { name: "VXLAN" } } },
    });
    const docAfter = await client.callTool({ name: "doc_get", arguments: {} });
    const updated = (
      docAfter.structuredContent as { document: { elements: AnnotationEl[] } }
    ).document.elements.find((el) => el.id === connId)!;
    expect(updated.annotation).toEqual({ name: "VXLAN" });
  });

  it("connect_nearest errors clearly instead of returning undefined for an invalid pair", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;
    const result = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: boxId, toId: boxId },
    });
    expect(result.isError).toBe(true);
  });

  it("group_elements errors clearly for fewer than two known ids", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;
    const result = await client.callTool({
      name: "group_elements",
      arguments: { ids: [boxId] },
    });
    expect(result.isError).toBe(true);
  });

  it("element_move nudges and element_delete removes", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;

    await client.callTool({
      name: "element_move",
      arguments: { ids: [boxId], dx: 10, dy: 5 },
    });
    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const element = (
      doc.structuredContent as {
        document: { elements: Array<{ id: string; x: number; y: number }> };
      }
    ).document.elements.find((el) => el.id === boxId)!;
    expect(element.x).toBe(10);
    expect(element.y).toBe(5);

    const deleted = await client.callTool({
      name: "element_delete",
      arguments: { ids: [boxId] },
    });
    expect(deleted.isError).toBeUndefined();
    const docAfter = await client.callTool({ name: "doc_get", arguments: {} });
    expect(
      (docAfter.structuredContent as { document: { elements: unknown[] } })
        .document.elements,
    ).toHaveLength(0);
  });

  it("element_reparent changes containment without touching position, and rejects a cycle", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 }, w: 200, h: 200 },
    });
    const boxId = (box.structuredContent as { id: string }).id;
    const icon = await client.callTool({
      name: "element_add_icon",
      arguments: {
        catalogRef: (
          (
            await client.callTool({
              name: "catalog_search",
              arguments: { query: "vpc" },
            })
          ).structuredContent as { icons: Array<{ id: string }> }
        ).icons[0]!.id,
        at: { x: 500, y: 500 },
      },
    });
    const iconId = (icon.structuredContent as { id: string }).id;

    const reparented = await client.callTool({
      name: "element_reparent",
      arguments: { id: iconId, parentId: boxId },
    });
    expect(reparented.isError).toBeUndefined();

    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const element = (
      doc.structuredContent as {
        document: {
          elements: Array<{
            id: string;
            x: number;
            y: number;
            parentId?: string;
          }>;
        };
      }
    ).document.elements.find((el) => el.id === iconId)!;
    expect(element.parentId).toBe(boxId);
    expect(element).toMatchObject({ x: 500, y: 500 }); // position untouched

    const liftedToRoot = await client.callTool({
      name: "element_reparent",
      arguments: { id: iconId },
    });
    expect(liftedToRoot.isError).toBeUndefined();

    const cycle = await client.callTool({
      name: "element_reparent",
      arguments: { id: boxId, parentId: boxId },
    });
    expect(cycle.isError).toBe(true);
  });

  it("frame_reorder applies an exact presentation order", async () => {
    const a = await client.callTool({
      name: "element_add_frame",
      arguments: { at: { x: 0, y: 0 }, name: "A" },
    });
    const b = await client.callTool({
      name: "element_add_frame",
      arguments: { at: { x: 900, y: 0 }, name: "B" },
    });
    const aId = (a.structuredContent as { id: string }).id;
    const bId = (b.structuredContent as { id: string }).id;

    const reordered = await client.callTool({
      name: "frame_reorder",
      arguments: { frameIds: [bId, aId] },
    });
    expect(reordered.isError).toBeUndefined();

    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const frames = (
      doc.structuredContent as {
        document: { elements: Array<{ id: string; order: number }> };
      }
    ).document.elements
      .filter((el) => el.id === aId || el.id === bId)
      .sort((x, y) => x.order - y.order);
    expect(frames.map((f) => f.id)).toEqual([bId, aId]);
  });

  it("z-order tools reorder siblings and report changed:false once nothing moves further", async () => {
    const a = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const b = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 300, y: 0 } },
    });
    const aId = (a.structuredContent as { id: string }).id;
    const bId = (b.structuredContent as { id: string }).id;

    const siblingIndex = async (): Promise<Record<string, number>> => {
      const doc = await client.callTool({ name: "doc_get", arguments: {} });
      const elements = (
        doc.structuredContent as {
          document: { elements: Array<{ id: string }> };
        }
      ).document.elements;
      return Object.fromEntries(elements.map((el, index) => [el.id, index]));
    };

    // a was added first, so it's already behind b — but the very first z op on a document still
    // legitimately normalizes untouched z values (a real write), so canonicalize once before the
    // real no-op check.
    await client.callTool({
      name: "element_send_to_back",
      arguments: { ids: [aId] },
    });
    const noop = await client.callTool({
      name: "element_send_to_back",
      arguments: { ids: [aId] },
    });
    expect(noop.isError).toBeUndefined();
    expect((noop.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );

    const front = await client.callTool({
      name: "element_bring_to_front",
      arguments: { ids: [aId] },
    });
    expect(front.isError).toBeUndefined();
    expect((front.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );
    const afterFront = await siblingIndex();
    expect(afterFront[aId]).toBeGreaterThan(afterFront[bId]!);

    const back = await client.callTool({
      name: "element_send_to_back",
      arguments: { ids: [aId] },
    });
    expect(back.isError).toBeUndefined();
    expect((back.structuredContent as { changed: boolean }).changed).toBe(true);
    const afterBack = await siblingIndex();
    expect(afterBack[aId]).toBeLessThan(afterBack[bId]!);

    const forward = await client.callTool({
      name: "element_bring_forward",
      arguments: { ids: [aId] },
    });
    expect(forward.isError).toBeUndefined();
    expect((forward.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );
    const afterForward = await siblingIndex();
    expect(afterForward[aId]).toBeGreaterThan(afterForward[bId]!);

    const backward = await client.callTool({
      name: "element_send_backward",
      arguments: { ids: [aId] },
    });
    expect(backward.isError).toBeUndefined();
    expect((backward.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );
    const afterBackward = await siblingIndex();
    expect(afterBackward[aId]).toBeLessThan(afterBackward[bId]!);
  });
});
