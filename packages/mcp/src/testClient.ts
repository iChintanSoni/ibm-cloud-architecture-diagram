import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type CreateMcpServerOptions } from "./server.js";

/** A fresh, connected client/server pair over an in-memory transport — no stdio, no subprocess.
 * Each call gets its own `createMcpServer()` instance, so tests never leak state into each other.
 * Pass `{ workspaceRoot }` for any test exercising `doc_open`/`doc_save`/`export_diagram`'s `path`
 * argument — defaults to `process.cwd()` (this package's own directory under `vitest run`), which
 * a test writing into an OS temp directory is confined away from on purpose (I13). */
export async function createTestClient(options: CreateMcpServerOptions = {}) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = await createMcpServer(options);
  const client = new Client({ name: "icad-mcp-test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
