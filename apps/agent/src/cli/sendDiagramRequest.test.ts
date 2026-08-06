import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskState } from "@a2a-js/sdk";
import { IcadAgentExecutor } from "../a2a/agentExecutor.js";
import { startA2AServer, type A2AServerHandle } from "../a2a/server.js";
import { sendDiagramRequest } from "./sendDiagramRequest.js";
import type { RunDiagramTaskTiming } from "../runDiagramTask.js";

// Same "real server, faked runDiagramTask" approach as a2a/server.test.ts — this exercises the
// CLI's own client-side request/stream-parsing logic against a real A2A server over real HTTP,
// without needing a live LLM.

const FAKE_TIMING: RunDiagramTaskTiming = {
  sessionStartMs: 0,
  docSetupMs: 0,
  orchestratorMs: 0,
  gateCheckMs: 0,
  totalMs: 0,
};

describe("sendDiagramRequest", () => {
  let handle: A2AServerHandle;
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "icad-agent-cli-test-"));
  });

  afterEach(async () => {
    await handle?.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns the completed status and every published artifact's file:// url", async () => {
    const icadPath = path.join(workDir, "out.icad");
    const svgPath = path.join(workDir, "out.svg");

    handle = await startA2AServer({
      port: 0,
      agentExecutor: new IcadAgentExecutor(async () => {
        await writeFile(icadPath, "{}");
        await writeFile(svgPath, "<svg/>");
        return {
          success: true,
          icadPath,
          svgPath,
          transcript: [],
          timing: FAKE_TIMING,
        };
      }),
    });

    const events: string[] = [];
    const result = await sendDiagramRequest({
      url: `http://localhost:${handle.port}/`,
      requirement: "A load balancer in front of two VSIs.",
      outputIcadPath: icadPath,
      outputSvgPath: svgPath,
      onEvent: (payload) => events.push(payload.$case),
    });

    expect(result.finalState).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map((a) => a.url).sort()).toEqual(
      [`file://${icadPath}`, `file://${svgPath}`].sort(),
    );
    expect(events).toContain("task");
    expect(events).toContain("artifactUpdate");
  });

  it("surfaces the failure reason when the hard export gate rejects the run", async () => {
    handle = await startA2AServer({
      port: 0,
      agentExecutor: new IcadAgentExecutor(async () => ({
        success: false,
        reason: "1 error-severity diagnostic(s) remain after the agent run.",
        transcript: [],
        timing: FAKE_TIMING,
      })),
    });

    const result = await sendDiagramRequest({
      url: `http://localhost:${handle.port}/`,
      requirement: "Build something impossible.",
      outputIcadPath: path.join(workDir, "out.icad"),
    });

    expect(result.finalState).toBe(TaskState.TASK_STATE_FAILED);
    expect(result.failureReason).toContain("error-severity diagnostic");
  });
});
