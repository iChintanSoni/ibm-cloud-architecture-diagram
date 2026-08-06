import { parseArgs } from "node:util";
import { TaskState, taskStateToJSON } from "@a2a-js/sdk";
import { DEFAULT_A2A_PORT } from "../a2a/index.js";
import { sendDiagramRequest } from "./sendDiagramRequest.js";

const HELP = `icad-agent-cli — A2A dev-harness client (docs/09-roadmap.md#m33)

Usage:
  icad-agent-cli "<requirement or edit instruction>" --output <path.icad> [options]

Options:
  --output <path>     Where to save the .icad (required). .svg/.png default to the same
                       basename unless overridden below.
  --existing <path>   Modify this existing .icad instead of creating a new one
                       (docs/00-decision-log.md#d35 — ModifyArchitectureDiagram).
  --svg <path>        Override the .svg output path.
  --png <path>        Override the .png output path.
  --level <level>     Diagram level for a new diagram: blank | system-context | high-level |
                       detailed. Ignored with --existing.
  --url <url>         A2A server URL (default: http://localhost:${DEFAULT_A2A_PORT}/).
  --help              Show this message.
`;

function isTerminal(state: TaskState): boolean {
  return (
    state === TaskState.TASK_STATE_COMPLETED ||
    state === TaskState.TASK_STATE_FAILED ||
    state === TaskState.TASK_STATE_CANCELED ||
    state === TaskState.TASK_STATE_REJECTED
  );
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      output: { type: "string" },
      existing: { type: "string" },
      svg: { type: "string" },
      png: { type: "string" },
      level: { type: "string" },
      url: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  if (!values.output) {
    console.error("Missing required --output <path.icad>.\n");
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const url = values.url ?? `http://localhost:${DEFAULT_A2A_PORT}/`;
  console.log(`[icad-agent-cli] -> ${url}`);
  console.log(`[icad-agent-cli] requirement: ${positionals[0]}`);

  const result = await sendDiagramRequest({
    url,
    requirement: positionals[0]!,
    outputIcadPath: values.output,
    ...(values.existing ? { existingIcadPath: values.existing } : {}),
    ...(values.svg ? { outputSvgPath: values.svg } : {}),
    ...(values.png ? { outputPngPath: values.png } : {}),
    ...(values.level ? { level: values.level } : {}),
    onEvent: (payload) => {
      switch (payload.$case) {
        case "task":
          console.log(
            `[icad-agent-cli] task ${(payload.value as { id: string }).id} submitted`,
          );
          break;
        case "statusUpdate": {
          const state = (payload.value as { status: { state: TaskState } })
            .status.state;
          console.log(`[icad-agent-cli] status: ${taskStateToJSON(state)}`);
          break;
        }
        case "artifactUpdate": {
          const artifact = (
            payload.value as {
              artifact?: {
                name: string;
                parts: Array<{ content?: { $case: string; value: unknown } }>;
              };
            }
          ).artifact;
          const urlPart = artifact?.parts.find(
            (part) => part.content?.$case === "url",
          );
          console.log(
            `[icad-agent-cli] artifact: ${artifact?.name} -> ${urlPart?.content && "value" in urlPart.content ? String(urlPart.content.value) : "?"}`,
          );
          break;
        }
        default:
          break;
      }
    },
  });

  if (!isTerminal(result.finalState)) {
    console.error("[icad-agent-cli] stream ended without a terminal status.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `[icad-agent-cli] final status: ${taskStateToJSON(result.finalState)}`,
  );
  if (result.finalState !== TaskState.TASK_STATE_COMPLETED) {
    if (result.failureReason)
      console.error(`[icad-agent-cli] reason: ${result.failureReason}`);
    process.exitCode = 1;
    return;
  }

  for (const artifact of result.artifacts) {
    console.log(`[icad-agent-cli] ${artifact.name}: ${artifact.url}`);
  }
}

main().catch((err) => {
  console.error("icad-agent-cli fatal error:", err);
  process.exit(1);
});
