import os from "node:os";
import path from "node:path";
import type { Message } from "@a2a-js/sdk";
import type { DiagramLevel } from "../runDiagramTask.js";

export interface DiagramTaskParams {
  requirement: string;
  level?: DiagramLevel;
  existingIcadPath?: string;
  outputIcadPath: string;
  outputSvgPath: string;
  outputPngPath: string;
}

function extractText(message: Message): string {
  const text = message.parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
  if (!text) {
    throw new Error(
      "The request message has no text part with the requirement/edit instruction.",
    );
  }
  return text;
}

function withExtension(filePath: string, ext: string): string {
  const { dir, name } = path.parse(filePath);
  return path.join(dir, `${name}${ext}`);
}

function stringField(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads the caller's requirement (the message's text part) and this task's file paths/level from
 * the message's `metadata` bag (docs/decision-log.md#d35 — an explicit path, not inline
 * content). `outputIcadPath` defaults to a per-task temp path if the caller doesn't care where it
 * lands; `outputSvgPath`/`outputPngPath` default to that same path with a swapped extension.
 */
export function parseDiagramTaskParams(
  message: Message,
  taskId: string,
): DiagramTaskParams {
  const requirement = extractText(message);
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;

  const existingIcadPath = stringField(metadata, "existingIcadPath");
  const outputIcadPath =
    stringField(metadata, "outputIcadPath") ??
    path.join(os.tmpdir(), `icad-agent-${taskId}.icad`);
  const outputSvgPath =
    stringField(metadata, "outputSvgPath") ??
    withExtension(outputIcadPath, ".svg");
  const outputPngPath =
    stringField(metadata, "outputPngPath") ??
    withExtension(outputIcadPath, ".png");
  const level = stringField(metadata, "level") as DiagramLevel | undefined;

  return {
    requirement,
    ...(level ? { level } : {}),
    ...(existingIcadPath ? { existingIcadPath } : {}),
    outputIcadPath,
    outputSvgPath,
    outputPngPath,
  };
}
