import { randomUUID } from "node:crypto";
import { Agent, setGlobalDispatcher } from "undici";
import { Role, TaskState } from "@a2a-js/sdk";
import type { SendMessageRequest } from "@a2a-js/sdk";
import {
  ClientFactory,
  ClientFactoryOptions,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";

// A real diagram-generation task can take many minutes between streamed A2A events — that's an
// LLM step, not network latency, but undici's default ~5-minute body/headers timeout kills the
// underlying fetch() mid-stream regardless (found live, M32/M33 dogfooding: a real run crashed
// with UND_ERR_BODY_TIMEOUT partway through a real task). Disabled outright rather than just
// raised — A2A's own task lifecycle (cancelTask) is the right layer for a caller to give up on a
// genuinely stuck task, not a fixed low-level HTTP timeout that can't tell "still working" from
// "dead." Module-level, since @a2a-js/sdk's transport calls the global `fetch` with no per-call
// dispatcher override.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

export interface SendDiagramRequestOptions {
  url: string;
  requirement: string;
  existingIcadPath?: string;
  outputIcadPath: string;
  outputSvgPath?: string;
  outputPngPath?: string;
  level?: string;
  /** Called for every streamed event, in order — the CLI's progress output hooks in here. */
  onEvent?: (payload: { $case: string; value: unknown }) => void;
}

export interface DiagramArtifact {
  name: string;
  url: string;
  mediaType: string;
}

export interface SendDiagramRequestResult {
  taskId: string;
  finalState: TaskState;
  artifacts: DiagramArtifact[];
  failureReason?: string;
}

function textOf(message: {
  parts: Array<{ content?: { $case: string; value: unknown } }>;
}): string {
  return message.parts
    .map((part) =>
      part.content?.$case === "text" ? String(part.content.value) : "",
    )
    .filter((value) => value.length > 0)
    .join(" ");
}

const TERMINAL_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);

/**
 * Sends one GenerateArchitectureDiagram/ModifyArchitectureDiagram request
 * (docs/00-decision-log.md#d32) and streams it to completion — modeled directly on
 * `@a2a-js/sdk`'s own sample `client.ts`, since that's exactly what a dev-harness/test client is
 * supposed to look like. Not a product surface (docs/11-agent-runtime.md's Limitations section);
 * this is the plumbing-only A2A client (D32) used for local testing and the M33 dogfooding pass.
 */
export async function sendDiagramRequest(
  options: SendDiagramRequestOptions,
): Promise<SendDiagramRequestResult> {
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory()],
    }),
  );
  const client = await factory.createFromUrl(options.url);

  const metadata: Record<string, unknown> = {
    outputIcadPath: options.outputIcadPath,
  };
  if (options.existingIcadPath)
    metadata.existingIcadPath = options.existingIcadPath;
  if (options.outputSvgPath) metadata.outputSvgPath = options.outputSvgPath;
  if (options.outputPngPath) metadata.outputPngPath = options.outputPngPath;
  if (options.level) metadata.level = options.level;

  const request: SendMessageRequest = {
    tenant: "",
    metadata: {},
    configuration: undefined,
    message: {
      messageId: randomUUID(),
      role: Role.ROLE_USER,
      parts: [
        {
          content: { $case: "text", value: options.requirement },
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

  const stream = client.sendMessageStream(request);

  let taskId = "";
  let finalState: TaskState = TaskState.TASK_STATE_UNSPECIFIED;
  let failureReason: string | undefined;
  const artifacts: DiagramArtifact[] = [];

  for await (const event of stream) {
    const payload = event.payload;
    if (!payload) continue;
    options.onEvent?.(payload);

    switch (payload.$case) {
      case "task": {
        const task = payload.value as { id: string };
        taskId = task.id;
        break;
      }
      case "statusUpdate": {
        const update = payload.value as {
          status: {
            state: TaskState;
            message?: {
              parts: Array<{ content?: { $case: string; value: unknown } }>;
            };
          };
        };
        const state = update.status.state;
        if (TERMINAL_STATES.has(state)) {
          finalState = state;
          if (state === TaskState.TASK_STATE_FAILED && update.status.message) {
            failureReason = textOf(update.status.message);
          }
        }
        break;
      }
      case "artifactUpdate": {
        const update = payload.value as {
          artifact?: {
            name: string;
            parts: Array<{
              content?: { $case: string; value: unknown };
              mediaType: string;
            }>;
          };
        };
        const part = update.artifact?.parts[0];
        if (update.artifact && part?.content?.$case === "url") {
          artifacts.push({
            name: update.artifact.name,
            url: String(part.content.value),
            mediaType: part.mediaType,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    taskId,
    finalState,
    artifacts,
    ...(failureReason ? { failureReason } : {}),
  };
}
