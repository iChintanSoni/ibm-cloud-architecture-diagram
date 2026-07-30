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
    expect(result.content?.[0]).toMatchObject({
      text: expect.stringContaining("itself"),
    });
  });

  it("connect_nearest names the actual unknown id, not an unrelated guess, when one or both don't exist", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;

    const bothUnknown = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: "does-not-exist", toId: "also-missing" },
    });
    expect(bothUnknown.isError).toBe(true);
    expect(bothUnknown.content?.[0]).toMatchObject({
      text: expect.stringContaining('"does-not-exist"'),
    });

    const toUnknown = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: boxId, toId: "also-missing" },
    });
    expect(toUnknown.isError).toBe(true);
    expect(toUnknown.content?.[0]).toMatchObject({
      text: expect.stringContaining('"also-missing"'),
    });
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

  it("align tools move elements to the selection's own bbox edge/center and report changed:false once already aligned", async () => {
    const a = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 }, w: 100, h: 100 },
    });
    const b = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 50, y: 200 }, w: 200, h: 50 },
    });
    const aId = (a.structuredContent as { id: string }).id;
    const bId = (b.structuredContent as { id: string }).id;

    const position = async (id: string): Promise<{ x: number; y: number }> => {
      const doc = await client.callTool({ name: "doc_get", arguments: {} });
      const element = (
        doc.structuredContent as {
          document: { elements: Array<{ id: string; x: number; y: number }> };
        }
      ).document.elements.find((el) => el.id === id)!;
      return { x: element.x, y: element.y };
    };

    const left = await client.callTool({
      name: "element_align_left",
      arguments: { ids: [aId, bId] },
    });
    expect(left.isError).toBeUndefined();
    expect((left.structuredContent as { changed: boolean }).changed).toBe(true);
    expect((await position(bId)).x).toBe(0);

    const noop = await client.callTool({
      name: "element_align_left",
      arguments: { ids: [aId, bId] },
    });
    expect(noop.isError).toBeUndefined();
    expect((noop.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );

    const right = await client.callTool({
      name: "element_align_right",
      arguments: { ids: [aId, bId] },
    });
    expect(right.isError).toBeUndefined();
    expect((right.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );
    expect((await position(aId)).x).toBe(100);

    const centerH = await client.callTool({
      name: "element_align_center_horizontal",
      arguments: { ids: [aId, bId] },
    });
    expect(centerH.isError).toBeUndefined();
    expect((centerH.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    const top = await client.callTool({
      name: "element_align_top",
      arguments: { ids: [aId, bId] },
    });
    expect(top.isError).toBeUndefined();
    expect((top.structuredContent as { changed: boolean }).changed).toBe(true);
    expect((await position(bId)).y).toBe(0);

    const bottom = await client.callTool({
      name: "element_align_bottom",
      arguments: { ids: [aId, bId] },
    });
    expect(bottom.isError).toBeUndefined();
    expect((bottom.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    const middle = await client.callTool({
      name: "element_align_middle",
      arguments: { ids: [aId, bId] },
    });
    expect(middle.isError).toBeUndefined();
    expect((middle.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    // A single-element selection is never alignable to anything: always changed:false.
    const single = await client.callTool({
      name: "element_align_left",
      arguments: { ids: [aId] },
    });
    expect(single.isError).toBeUndefined();
    expect((single.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );
  });

  it("distribute tools space elements evenly and report changed:false when already even", async () => {
    const a = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 }, w: 50, h: 50 },
    });
    const b = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 200, y: 0 }, w: 50, h: 50 },
    });
    const c = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 300, y: 0 }, w: 100, h: 50 },
    });
    const aId = (a.structuredContent as { id: string }).id;
    const bId = (b.structuredContent as { id: string }).id;
    const cId = (c.structuredContent as { id: string }).id;

    const position = async (id: string): Promise<{ x: number; y: number }> => {
      const doc = await client.callTool({ name: "doc_get", arguments: {} });
      const element = (
        doc.structuredContent as {
          document: { elements: Array<{ id: string; x: number; y: number }> };
        }
      ).document.elements.find((el) => el.id === id)!;
      return { x: element.x, y: element.y };
    };

    // Horizontal: a x 0..50, b x 200..250, c x 300..400
    // anchor a & c; gap = (300-50-50)/2 = 100; b target = 150 → dx -50
    const horizontal = await client.callTool({
      name: "element_distribute_horizontal",
      arguments: { ids: [aId, bId, cId] },
    });
    expect(horizontal.isError).toBeUndefined();
    expect((horizontal.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );
    expect((await position(bId)).x).toBe(150);
    expect((await position(aId)).x).toBe(0); // anchor unmoved
    expect((await position(cId)).x).toBe(300); // anchor unmoved

    // Already evenly spaced → changed:false
    const noop = await client.callTool({
      name: "element_distribute_horizontal",
      arguments: { ids: [aId, bId, cId] },
    });
    expect(noop.isError).toBeUndefined();
    expect((noop.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );

    // Fewer than three elements → changed:false
    const tooFew = await client.callTool({
      name: "element_distribute_horizontal",
      arguments: { ids: [aId, bId] },
    });
    expect(tooFew.isError).toBeUndefined();
    expect((tooFew.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );

    // Vertical distribute works the same way
    const d = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 }, w: 50, h: 50 },
    });
    const e = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 200 }, w: 50, h: 50 },
    });
    const f = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 300 }, w: 50, h: 100 },
    });
    const dId = (d.structuredContent as { id: string }).id;
    const eId = (e.structuredContent as { id: string }).id;
    const fId = (f.structuredContent as { id: string }).id;

    const vertical = await client.callTool({
      name: "element_distribute_vertical",
      arguments: { ids: [dId, eId, fId] },
    });
    expect(vertical.isError).toBeUndefined();
    expect((vertical.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );
    expect((await position(eId)).y).toBe(150);
    expect((await position(dId)).y).toBe(0);
    expect((await position(fId)).y).toBe(300);
  });

  it("element_lock / element_unlock / element_hide / element_show round-trip (M18.4)", async () => {
    const box = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 } },
    });
    const boxId = (box.structuredContent as { id: string }).id;

    const locked = await client.callTool({
      name: "element_lock",
      arguments: { ids: [boxId] },
    });
    expect(locked.isError).toBeUndefined();
    expect((locked.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    // Already locked → changed:false
    const noop = await client.callTool({
      name: "element_lock",
      arguments: { ids: [boxId] },
    });
    expect((noop.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );

    const unlocked = await client.callTool({
      name: "element_unlock",
      arguments: { ids: [boxId] },
    });
    expect(unlocked.isError).toBeUndefined();
    expect((unlocked.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    const hidden = await client.callTool({
      name: "element_hide",
      arguments: { ids: [boxId] },
    });
    expect(hidden.isError).toBeUndefined();
    expect((hidden.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    const shown = await client.callTool({
      name: "element_show",
      arguments: { ids: [boxId] },
    });
    expect(shown.isError).toBeUndefined();
    expect((shown.structuredContent as { changed: boolean }).changed).toBe(
      true,
    );

    // Already visible → changed:false
    const noopShow = await client.callTool({
      name: "element_show",
      arguments: { ids: [boxId] },
    });
    expect((noopShow.structuredContent as { changed: boolean }).changed).toBe(
      false,
    );
  });

  it("connector_retarget changes a connector's to-endpoint and connector_reset_routing switches it back to auto", async () => {
    const a = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 0, y: 0 }, w: 100, h: 80 },
    });
    const b = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 300, y: 0 }, w: 100, h: 80 },
    });
    const c = await client.callTool({
      name: "element_add_box",
      arguments: { at: { x: 300, y: 200 }, w: 100, h: 80 },
    });
    const aId = (a.structuredContent as { id: string }).id;
    const bId = (b.structuredContent as { id: string }).id;
    const cId = (c.structuredContent as { id: string }).id;

    // Connect A→B.
    const conn = await client.callTool({
      name: "connect_nearest",
      arguments: { fromId: aId, toId: bId },
    });
    const connId = (conn.structuredContent as { id: string }).id;

    // Retarget to → C.
    const retargeted = await client.callTool({
      name: "connector_retarget",
      arguments: { id: connId, to: { elementId: cId, port: "w" } },
    });
    expect(retargeted.isError).toBeUndefined();

    type ConnEl = { id: string; to?: { elementId: string }; routing?: string };
    const doc = await client.callTool({ name: "doc_get", arguments: {} });
    const el = (
      doc.structuredContent as { document: { elements: ConnEl[] } }
    ).document.elements.find((e) => e.id === connId)!;
    expect(el.to?.elementId).toBe(cId);

    // Reset routing.
    const reset = await client.callTool({
      name: "connector_reset_routing",
      arguments: { id: connId },
    });
    expect(reset.isError).toBeUndefined();

    const docAfter = await client.callTool({ name: "doc_get", arguments: {} });
    const elAfter = (
      docAfter.structuredContent as { document: { elements: ConnEl[] } }
    ).document.elements.find((e) => e.id === connId)!;
    expect(elAfter.routing ?? "auto").toBe("auto");
  });

  it("connector_retarget errors when neither from nor to is provided", async () => {
    const result = await client.callTool({
      name: "connector_retarget",
      arguments: { id: "nonexistent" },
    });
    expect(result.isError).toBe(true);
  });
});
