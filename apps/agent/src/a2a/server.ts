import type { Server } from "node:http";
import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { buildAgentCard } from "./agentCard.js";
import { IcadAgentExecutor } from "./agentExecutor.js";

export const DEFAULT_A2A_PORT = 41241;

export interface A2AServerHandle {
  port: number;
  agentCardUrl: string;
  close(): Promise<void>;
}

export interface StartA2AServerOptions {
  /** 0 picks an OS-assigned ephemeral port — used by tests; a real deployment passes an explicit
   * port (default DEFAULT_A2A_PORT, the SDK's own sample convention). */
  port?: number;
  /** Overridable for tests, so the A2A wiring itself (routing, task lifecycle, cancellation) can
   * be exercised against a real HTTP server without a real LLM/MCP subprocess underneath. */
  agentExecutor?: IcadAgentExecutor;
}

/**
 * Localhost-only, no auth (docs/00-decision-log.md#d32) — `UserBuilder.noAuthentication` is a
 * first-class supported mode of `@a2a-js/sdk` itself, not a bespoke bypass.
 * `InMemoryTaskStore` is sufficient given the single-task-at-a-time model (D34): nothing here
 * needs to survive a process restart.
 */
export async function startA2AServer(
  options: StartA2AServerOptions = {},
): Promise<A2AServerHandle> {
  const requestedPort = options.port ?? DEFAULT_A2A_PORT;
  const app = express();

  const server = await new Promise<Server>((resolve, reject) => {
    const s: Server = app.listen(requestedPort, () => resolve(s));
    s.once("error", reject);
  });

  // For an ephemeral (port: 0) request, the OS-assigned port is only known after listen()
  // resolves — read it back so the AgentCard's own advertised URL is accurate, not "port 0".
  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : requestedPort;

  const agentCard = buildAgentCard(port);
  const taskStore = new InMemoryTaskStore();
  const agentExecutor = options.agentExecutor ?? new IcadAgentExecutor();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    agentExecutor,
  );

  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );
  app.use(
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  return {
    port,
    agentCardUrl: `http://localhost:${port}/${AGENT_CARD_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
