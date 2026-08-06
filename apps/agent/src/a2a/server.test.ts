import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Role, TaskState } from "@a2a-js/sdk";
import type { SendMessageRequest } from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import { IcadAgentExecutor, type RunDiagramTaskFn } from "./agentExecutor.js";
import { startA2AServer, type A2AServerHandle } from "./server.js";
import type { RunDiagramTaskTiming } from "../runDiagramTask.js";

// Exercises the real A2A wiring (HTTP, JSON-RPC, task lifecycle events, cancellation) against a
// real @a2a-js/sdk client over a real server — only `runDiagramTask` itself (the real LLM + real
// spawned MCP subprocess, exercised separately in runDiagramTask.int.test.ts) is faked, via
// IcadAgentExecutor's injectable constructor param.

const FAKE_TIMING: RunDiagramTaskTiming = {
  sessionStartMs: 0,
  docSetupMs: 0,
  orchestratorMs: 0,
  gateCheckMs: 0,
  totalMs: 0,
};

function sendMessageRequest(
  text: string,
  metadata: Record<string, unknown>,
): SendMessageRequest {
  return {
    tenant: "",
    metadata: {},
    configuration: undefined,
    message: {
      messageId: randomUUID(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: "text", value: text },
          metadata: undefined,
          filename: "",
          mediaType: "text/plain",
        },
      ],
      taskId: "",
      contextId: "",
      extensions: [],
      metadata,
      referenceTaskIds: [],
    },
  };
}

async function collectEvents(
  stream: AsyncIterable<{ payload?: { $case: string; value: unknown } }>,
) {
  const events: Array<{ $case: string; value: unknown }> = [];
  for await (const event of stream) {
    if (event.payload) events.push(event.payload);
  }
  return events;
}

describe("A2A server (docs/00-decision-log.md#d32)", () => {
  let handle: A2AServerHandle;
  let workDir: string;

  async function serverWith(runTask: RunDiagramTaskFn) {
    handle = await startA2AServer({
      port: 0,
      agentExecutor: new IcadAgentExecutor(runTask),
    });
    return handle;
  }

  async function clientFor(handle: A2AServerHandle) {
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new JsonRpcTransportFactory()],
      }),
    );
    return factory.createFromUrl(`http://localhost:${handle.port}/`);
  }

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "icad-agent-a2a-test-"));
  });

  afterEach(async () => {
    await handle?.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("serves an AgentCard advertising both skills", async () => {
    handle = await serverWith(async () => {
      throw new Error("not called");
    });

    const response = await fetch(handle.agentCardUrl);
    expect(response.status).toBe(200);
    const card = (await response.json()) as { skills: Array<{ id: string }> };
    const ids = card.skills.map((s) => s.id).sort();
    expect(ids).toEqual([
      "generate_architecture_diagram",
      "modify_architecture_diagram",
    ]);
  });

  it("publishes task -> working -> 3 artifacts -> completed for a successful run", async () => {
    const icadPath = path.join(workDir, "out.icad");
    const svgPath = path.join(workDir, "out.svg");
    const pngPath = path.join(workDir, "out.png");

    await serverWith(async () => {
      await writeFile(icadPath, "{}");
      await writeFile(svgPath, "<svg/>");
      await writeFile(pngPath, "fake-png");
      return {
        success: true,
        icadPath,
        svgPath,
        pngPath,
        transcript: [],
        timing: FAKE_TIMING,
      };
    });

    const client = await clientFor(handle);
    const stream = client.sendMessageStream(
      sendMessageRequest("Add a load balancer.", {
        outputIcadPath: icadPath,
        outputSvgPath: svgPath,
        outputPngPath: pngPath,
      }),
    );
    const events = await collectEvents(stream);

    expect(events.map((e) => e.$case)).toEqual([
      "task",
      "statusUpdate",
      "artifactUpdate",
      "artifactUpdate",
      "artifactUpdate",
      "statusUpdate",
    ]);
    const statusStates = events
      .filter((e) => e.$case === "statusUpdate")
      .map((e) => (e.value as { status: { state: TaskState } }).status.state);
    expect(statusStates).toEqual([
      TaskState.TASK_STATE_WORKING,
      TaskState.TASK_STATE_COMPLETED,
    ]);
  });

  it("publishes a failed status with diagnostics when the hard export gate rejects the run", async () => {
    await serverWith(async () => ({
      success: false,
      reason: "2 error-severity diagnostic(s) remain after the agent run.",
      diagnostics: [
        {
          id: "d1",
          ruleId: "missing-label",
          severity: "error" as const,
          message: "Box has no label",
        },
      ],
      transcript: [],
      timing: FAKE_TIMING,
    }));

    const client = await clientFor(handle);
    const stream = client.sendMessageStream(
      sendMessageRequest("Build something impossible.", {
        outputIcadPath: path.join(workDir, "out.icad"),
      }),
    );
    const events = await collectEvents(stream);

    const failed = events.find(
      (e) =>
        e.$case === "statusUpdate" &&
        (e.value as { status: { state: TaskState } }).status.state ===
          TaskState.TASK_STATE_FAILED,
    );
    expect(failed).toBeDefined();
  });

  it("publishes a canceled status when cancelTask is called mid-run", async () => {
    await serverWith(
      (input) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    const client = await clientFor(handle);
    const stream = client.sendMessageStream(
      sendMessageRequest("A task that takes a while.", {
        outputIcadPath: path.join(workDir, "out.icad"),
      }),
    );

    let taskId: string | undefined;
    const events: Array<{ $case: string; value: unknown }> = [];
    for await (const event of stream) {
      if (!event.payload) continue;
      events.push(event.payload);
      if (event.payload.$case === "task") {
        taskId = (event.payload.value as { id: string }).id;
        await client.cancelTask({ tenant: "", id: taskId, metadata: {} });
      }
      if (
        event.payload.$case === "statusUpdate" &&
        (event.payload.value as { status: { state: TaskState } }).status
          .state !== TaskState.TASK_STATE_WORKING
      ) {
        break;
      }
    }

    const terminal = events.find(
      (e) =>
        e.$case === "statusUpdate" &&
        (e.value as { status: { state: TaskState } }).status.state !==
          TaskState.TASK_STATE_WORKING,
    );
    expect(
      (terminal?.value as { status: { state: TaskState } }).status.state,
    ).toBe(TaskState.TASK_STATE_CANCELED);
  });
});
