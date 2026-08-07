import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient } from "../testClient.js";

describe("document tools", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "icad-mcp-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("requires doc_create/doc_open before any authoring tool", async () => {
    const { client, close } = await createTestClient();
    try {
      const result = await client.callTool({ name: "doc_get", arguments: {} });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("doc_create then doc_save then doc_open round-trips through disk", async () => {
    const { client, close } = await createTestClient({ workspaceRoot: dir });
    try {
      await client.callTool({
        name: "doc_create",
        arguments: { level: "blank" },
      });
      await client.callTool({
        name: "element_add_box",
        arguments: { at: { x: 10, y: 10 } },
      });

      const filePath = path.join(dir, "roundtrip.icad");
      const saveResult = await client.callTool({
        name: "doc_save",
        arguments: { path: filePath },
      });
      expect(saveResult.isError).toBeUndefined();

      const getBefore = await client.callTool({
        name: "doc_get",
        arguments: {},
      });
      const before = (
        getBefore.structuredContent as { document: { elements: unknown[] } }
      ).document;
      expect(before.elements).toHaveLength(1);

      // Reopen the same file into a *different* server/document to prove it actually persisted.
      const other = await createTestClient({ workspaceRoot: dir });
      try {
        const openResult = await other.client.callTool({
          name: "doc_open",
          arguments: { path: filePath },
        });
        expect(openResult.isError).toBeUndefined();
        const getAfter = await other.client.callTool({
          name: "doc_get",
          arguments: {},
        });
        const after = (
          getAfter.structuredContent as { document: { elements: unknown[] } }
        ).document;
        expect(after.elements).toHaveLength(1);
      } finally {
        await other.close();
      }
    } finally {
      await close();
    }
  });

  it("doc_create({ level, seedExampleContent: false }) gives an empty canvas that keeps the level's diagramLevel meta", async () => {
    const { client, close } = await createTestClient();
    try {
      await client.callTool({
        name: "doc_create",
        arguments: { level: "high-level", seedExampleContent: false },
      });

      const get = await client.callTool({ name: "doc_get", arguments: {} });
      const document = (
        get.structuredContent as {
          document: { elements: unknown[]; meta: { diagramLevel: string } };
        }
      ).document;
      expect(document.elements).toHaveLength(0);
      expect(document.meta.diagramLevel).toBe("high-level");
    } finally {
      await close();
    }
  });

  it("doc_create refuses to replace a dirty document without force", async () => {
    const { client, close } = await createTestClient();
    try {
      await client.callTool({
        name: "doc_create",
        arguments: { level: "blank" },
      });
      await client.callTool({
        name: "element_add_box",
        arguments: { at: { x: 0, y: 0 } },
      });

      const blocked = await client.callTool({
        name: "doc_create",
        arguments: { level: "blank" },
      });
      expect(blocked.isError).toBe(true);

      const forced = await client.callTool({
        name: "doc_create",
        arguments: { level: "blank", force: true },
      });
      expect(forced.isError).toBeUndefined();

      const get = await client.callTool({ name: "doc_get", arguments: {} });
      const document = (
        get.structuredContent as { document: { elements: unknown[] } }
      ).document;
      expect(document.elements).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
