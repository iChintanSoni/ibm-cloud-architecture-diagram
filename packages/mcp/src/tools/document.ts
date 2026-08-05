import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  guardReplace,
  requireOpenDocument,
  ToolError,
  type ServerState,
} from "../state.js";
import { diagramTemplateIdSchema } from "../schemas.js";
import { fail, ok, okText } from "../toolResult.js";

const forceSchema = z
  .boolean()
  .optional()
  .describe("Discard unsaved changes in the current document without erroring");

function resolvePath(input: string): string {
  return path.resolve(process.cwd(), input);
}

export function registerDocumentTools(
  server: McpServer,
  state: ServerState,
): void {
  server.registerTool(
    "doc_create",
    {
      title: "Start a new diagram",
      description:
        "Replace the current document with a fresh starter template: one of IBM's 4 diagram levels " +
        "(docs/09-roadmap.md#m73--ibm-level-templates-and-frame-authoring) or one of 4 built-in IBM " +
        "reference architectures — IKS/ROKS Single Region Multi-Zone on Classic or VPC infrastructure " +
        "(docs/09-roadmap.md#m26--reference-architecture-templates), all of which carry diagramLevel " +
        '"detailed". For any level but blank, this seeds a full worked example (frame, boxes, icons, ' +
        "connectors) by default — pass seedExampleContent: false for an empty canvas that still carries " +
        "the level's diagramLevel meta, so it still runs that level's full linter rule set (e.g. the " +
        "containment check for high-level/detailed). Recommended when building a diagram from a " +
        "requirement, since the seeded example would otherwise sit in the same space as whatever gets " +
        "built next. Errors if the current document has unsaved changes — pass force: true to discard " +
        "them.",
      inputSchema: {
        level: diagramTemplateIdSchema,
        force: forceSchema,
        seedExampleContent: z
          .boolean()
          .optional()
          .describe(
            "Seed the level's worked example content (default true). Pass false for an empty canvas that still runs the level's full linter rule set.",
          ),
      },
    },
    ({ level, force, seedExampleContent }) => {
      try {
        guardReplace(state, force);
        state.editor.newDocument(
          level,
          seedExampleContent !== undefined ? { seedExampleContent } : undefined,
        );
        state.hasExplicitDocument = true;
        state.dirty = false;
        state.lastPath = undefined;
        return okText(
          `Created a new "${level}" diagram${seedExampleContent === false ? " (empty canvas)" : ""}.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "doc_open",
    {
      title: "Open a .icad file",
      description:
        "Load a .icad file from disk into the editor, replacing the current document. Relative paths resolve " +
        "against the server process's working directory. Errors if the current document has unsaved changes " +
        "— pass force: true to discard them.",
      inputSchema: { path: z.string(), force: forceSchema },
    },
    async ({ path: inputPath, force }) => {
      try {
        guardReplace(state, force);
        const resolved = resolvePath(inputPath);
        const raw = await readFile(resolved, "utf-8");
        state.editor.loadIcad(JSON.parse(raw));
        state.hasExplicitDocument = true;
        state.dirty = false;
        state.lastPath = resolved;
        return okText(`Opened "${resolved}".`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "doc_save",
    {
      title: "Save the current document",
      description:
        "Write the current document to disk as .icad JSON. Defaults to the path last used by doc_open/doc_save " +
        "for this document if `path` is omitted.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path: inputPath }) => {
      try {
        requireOpenDocument(state);
        const target = inputPath ? resolvePath(inputPath) : state.lastPath;
        if (!target) {
          throw new ToolError(
            "No path given, and this document has never been saved — pass a path.",
          );
        }
        await writeFile(
          target,
          JSON.stringify(state.editor.toIcad(), null, 2),
          "utf-8",
        );
        state.lastPath = target;
        state.dirty = false;
        return okText(`Saved to "${target}".`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "doc_get",
    {
      title: "Get the current document",
      description:
        "Returns the current document's full .icad JSON (elements, frames, meta, canvas, conformance).",
      // Deliberately loose: @icad/core's SceneElement is a ~9-way discriminated union, and fully
      // mirroring it here would duplicate (and drift from) packages/core's own types for no real
      // validation benefit — this is our own output, not untrusted input.
      outputSchema: { document: z.record(z.string(), z.unknown()) },
    },
    () => {
      try {
        requireOpenDocument(state);
        const document = state.editor.toIcad();
        return ok(
          { document },
          `Document with ${document.elements.length} element(s).`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}
