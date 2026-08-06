import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  Role,
  TaskState,
  type Message,
  type Task,
  type TaskArtifactUpdateEvent,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  runDiagramTask,
  type RunDiagramTaskResult,
} from "../runDiagramTask.js";
import { parseDiagramTaskParams } from "./taskParams.js";

function textMessage(text: string, taskId: string, contextId: string): Message {
  return {
    role: Role.ROLE_AGENT,
    messageId: randomUUID(),
    parts: [
      {
        content: { $case: "text", value: text },
        metadata: undefined,
        filename: "",
        mediaType: "text/plain",
      },
    ],
    taskId,
    contextId,
    extensions: [],
    metadata: {},
    referenceTaskIds: [],
  };
}

function fileArtifactEvent(
  taskId: string,
  contextId: string,
  name: string,
  filePath: string,
  mediaType: string,
): TaskArtifactUpdateEvent {
  return {
    taskId,
    contextId,
    artifact: {
      artifactId: randomUUID(),
      name,
      description: "",
      parts: [
        {
          content: { $case: "url", value: `file://${filePath}` },
          metadata: undefined,
          filename: path.basename(filePath),
          mediaType,
        },
      ],
      metadata: undefined,
      extensions: [],
    },
    append: false,
    lastChunk: true,
    metadata: undefined,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export type RunDiagramTaskFn = typeof runDiagramTask;

/**
 * The A2A-facing implementation of ICAD's two skills (docs/00-decision-log.md#d32):
 * GenerateArchitectureDiagram / ModifyArchitectureDiagram, both routed through the same
 * `runDiagramTask` (docs/11-agent-runtime.md's request lifecycle) — which skill was invoked
 * doesn't change the executor's own logic, only whether the caller supplied `existingIcadPath`.
 */
export class IcadAgentExecutor implements AgentExecutor {
  private readonly controllers = new Map<string, AbortController>();

  /** Defaults to the real `runDiagramTask` (a real LLM + a real spawned MCP subprocess);
   * injectable so the A2A wiring itself — task lifecycle events, cancellation, artifact
   * publishing — can be tested against a real HTTP server without either of those. */
  constructor(private readonly runTask: RunDiagramTaskFn = runDiagramTask) {}

  cancelTask = async (
    taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> => {
    this.controllers.get(taskId)?.abort();
  };

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const {
      taskId,
      contextId,
      userMessage,
      task: existingTask,
    } = requestContext;
    const controller = new AbortController();
    this.controllers.set(taskId, controller);

    try {
      const taskSnapshot: Task = existingTask ?? {
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          timestamp: nowIso(),
          message: undefined,
        },
        artifacts: [],
        history: [userMessage],
        metadata: userMessage.metadata,
      };
      eventBus.publish(AgentEvent.task(taskSnapshot));
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            timestamp: nowIso(),
            message: undefined,
          },
          metadata: {},
        }),
      );

      const params = parseDiagramTaskParams(userMessage, taskId);

      let result: RunDiagramTaskResult;
      try {
        result = await this.runTask({ ...params, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) {
          eventBus.publish(
            AgentEvent.statusUpdate({
              taskId,
              contextId,
              status: {
                state: TaskState.TASK_STATE_CANCELED,
                timestamp: nowIso(),
                message: textMessage("Task cancelled.", taskId, contextId),
              },
              metadata: {},
            }),
          );
          return;
        }
        throw err;
      }

      if (!result.success) {
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_FAILED,
              timestamp: nowIso(),
              message: textMessage(result.reason, taskId, contextId),
            },
            metadata: { diagnostics: result.diagnostics ?? [] },
          }),
        );
        return;
      }

      eventBus.publish(
        AgentEvent.artifactUpdate(
          fileArtifactEvent(
            taskId,
            contextId,
            "diagram.icad",
            result.icadPath,
            "application/json",
          ),
        ),
      );
      eventBus.publish(
        AgentEvent.artifactUpdate(
          fileArtifactEvent(
            taskId,
            contextId,
            "diagram.svg",
            result.svgPath,
            "image/svg+xml",
          ),
        ),
      );
      if (result.pngPath) {
        eventBus.publish(
          AgentEvent.artifactUpdate(
            fileArtifactEvent(
              taskId,
              contextId,
              "diagram.png",
              result.pngPath,
              "image/png",
            ),
          ),
        );
      }

      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_COMPLETED,
            timestamp: nowIso(),
            message: undefined,
          },
          metadata: {},
        }),
      );
    } catch (err) {
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            timestamp: nowIso(),
            message: textMessage(
              err instanceof Error ? err.message : String(err),
              taskId,
              contextId,
            ),
          },
          metadata: {},
        }),
      );
    } finally {
      this.controllers.delete(taskId);
    }
  }
}
