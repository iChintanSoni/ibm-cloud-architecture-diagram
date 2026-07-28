import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireOpenDocument, ToolError, type ServerState } from "../state.js";
import {
  cardinalitySchema,
  connectorAnnotationSchema,
  connectorDirectionSchema,
  connectorTypeSchema,
  containerPlacementSchema,
  elementPropertiesPatchSchema,
  flowColorSchema,
  placementSchema,
  portRefSchema,
  zoneKindSchema,
} from "../schemas.js";
import { fail, ok } from "../toolResult.js";
import { omitUndefined } from "../util.js";

const idOutput = { id: z.string() };

const connectOptsSchema = {
  connectorType: connectorTypeSchema.optional(),
  direction: connectorDirectionSchema.optional(),
  flowColor: flowColorSchema.optional(),
  cardinality: cardinalitySchema.optional(),
  sequence: z
    .string()
    .optional()
    .describe(
      'Short sequencing/numbering badge shown at the connector\'s midpoint, e.g. "1", "2a"',
    ),
  annotation: connectorAnnotationSchema
    .optional()
    .describe(
      'Structured protocol/encapsulation annotation, e.g. { name: "HTTPS", security: "TLS1.3", port: "443" }',
    ),
  label: z.string().optional(),
};

export function registerAuthoringTools(
  server: McpServer,
  state: ServerState,
): void {
  const editor = () => {
    requireOpenDocument(state);
    return state.editor;
  };

  server.registerTool(
    "element_add_icon",
    {
      title: "Add a catalog icon",
      description:
        "Places an IBM Cloud catalog icon (from catalog_search) onto the canvas.",
      inputSchema: {
        catalogRef: z
          .string()
          .describe("Icon id from catalog_search, e.g. ibm-cloud/vpc"),
        ...placementSchema,
      },
      outputSchema: idOutput,
    },
    ({ catalogRef, ...opts }) => {
      try {
        const id = editor().addIcon(catalogRef, omitUndefined(opts));
        return ok({ id }, `Added icon "${catalogRef}" as ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_add_box",
    {
      title: "Add a Box (deployedOn container)",
      description:
        "Adds a Box — a solid-border deployedOn container (docs/05-ibm-spec-conformance.md).",
      inputSchema: containerPlacementSchema,
      outputSchema: idOutput,
    },
    (opts) => {
      try {
        const id = editor().addBox(omitUndefined(opts));
        return ok({ id }, `Added box ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_add_group",
    {
      title: "Add a Group (deployedTo container)",
      description:
        "Adds a Group — a dashed-border deployedTo container (docs/05-ibm-spec-conformance.md).",
      inputSchema: containerPlacementSchema,
      outputSchema: idOutput,
    },
    (opts) => {
      try {
        const id = editor().addGroup(omitUndefined(opts));
        return ok({ id }, `Added group ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_add_zone",
    {
      title: "Add a Boundary/Zone",
      description:
        "Adds a Zone (labelled Boundary in the UI) — a region/AZ/VPC/subnet/on-prem boundary.",
      inputSchema: {
        ...containerPlacementSchema,
        zoneKind: zoneKindSchema.optional(),
      },
      outputSchema: idOutput,
    },
    (opts) => {
      try {
        const id = editor().addZone(omitUndefined(opts));
        return ok({ id }, `Added zone ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_add_actor",
    {
      title: "Add an Actor",
      description: "Adds an Actor (a person/external system) to the canvas.",
      inputSchema: { ...placementSchema, catalogRef: z.string().optional() },
      outputSchema: idOutput,
    },
    (opts) => {
      try {
        const id = editor().addActor(omitUndefined(opts));
        return ok({ id }, `Added actor ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_add_text",
    {
      title: "Add a text label",
      description:
        "Adds a free-floating text element (not attached to any other element's label).",
      inputSchema: {
        id: placementSchema.id,
        at: placementSchema.at,
        w: placementSchema.w,
        h: placementSchema.h,
        parentId: placementSchema.parentId,
        text: z.string(),
      },
      outputSchema: idOutput,
    },
    (opts) => {
      try {
        const id = editor().addText(omitUndefined(opts));
        return ok({ id }, `Added text ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_add_frame",
    {
      title: "Add a presentation Frame",
      description:
        "Adds a Frame — a named, orderable section for presentation mode (docs/06-editor-ux.md#frames-sections--presentation). " +
        "Frames are always top-level, never nested.",
      inputSchema: {
        id: placementSchema.id,
        at: placementSchema.at,
        w: placementSchema.w,
        h: placementSchema.h,
        name: z.string(),
        order: z.number().optional(),
      },
      outputSchema: idOutput,
    },
    (opts) => {
      try {
        const id = editor().addFrame(omitUndefined(opts));
        return ok({ id }, `Added frame "${opts.name}" as ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_update",
    {
      title: "Update an element's properties",
      description:
        "Applies a partial patch (position, size, label, style, ...) to one element as one undo step.",
      inputSchema: { id: z.string(), patch: elementPropertiesPatchSchema },
    },
    ({ id, patch }) => {
      try {
        editor().updateElementProperties(id, omitUndefined(patch));
        return ok({ id }, `Updated ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_reparent",
    {
      title: "Change an element's containing Box/Group/Zone/Frame",
      description:
        "Moves an element into a different container (or to the canvas root, with no parentId), as one undo step. Position is unchanged — only containment membership. Rejects a cycle (an element can't become its own descendant's child) and a non-container target, the same as the human editor's own Properties panel.",
      inputSchema: {
        id: z.string(),
        parentId: z
          .string()
          .optional()
          .describe(
            "Containing Box/Group/Zone/Frame id; omit to lift to the canvas root",
          ),
      },
    },
    ({ id, parentId }) => {
      try {
        editor().setElementParent(id, parentId);
        return ok(
          { id },
          parentId
            ? `Reparented ${id} into ${parentId}.`
            : `Moved ${id} to the canvas root.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_move",
    {
      title: "Nudge elements by a delta",
      description:
        "Moves the given elements by (dx, dy) in scene units, cascading to nested contents (move-with).",
      inputSchema: { ids: z.array(z.string()), dx: z.number(), dy: z.number() },
    },
    ({ ids, dx, dy }) => {
      try {
        editor().nudgeElements(ids, dx, dy);
        return ok({ ids }, `Moved ${ids.length} element(s) by (${dx}, ${dy}).`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "element_delete",
    {
      title: "Delete elements",
      description:
        "Deletes the given elements and everything nested inside them, as one undo step.",
      inputSchema: { ids: z.array(z.string()) },
    },
    ({ ids }) => {
      try {
        editor().deleteElements(ids);
        return ok({ ids }, `Deleted ${ids.length} element(s).`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "connect",
    {
      title: "Connect two exact ports",
      description:
        "Draws an IBM-typed connector between two exact ports (docs/05-ibm-spec-conformance.md#connector-nomenclature). " +
        "Use connect_nearest instead if you don't want to specify exact ports.",
      inputSchema: {
        from: portRefSchema,
        to: portRefSchema,
        ...connectOptsSchema,
      },
      outputSchema: idOutput,
    },
    ({ from, to, ...opts }) => {
      try {
        const id = editor().connect(from, to, omitUndefined(opts));
        return ok(
          { id },
          `Connected ${from.elementId}:${from.port} to ${to.elementId}:${to.port} as ${id}.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "connect_nearest",
    {
      title: "Connect two elements, auto-picking ports",
      description:
        "Draws an IBM-typed connector between two elements, picking a reasonable port pair automatically.",
      inputSchema: {
        fromId: z.string(),
        toId: z.string(),
        ...connectOptsSchema,
      },
      outputSchema: idOutput,
    },
    ({ fromId, toId, ...opts }) => {
      try {
        const id = editor().connectNearest(fromId, toId, omitUndefined(opts));
        if (!id)
          throw new ToolError(
            `Cannot connect "${fromId}" to "${toId}" (same id, or one is a connector).`,
          );
        return ok({ id }, `Connected ${fromId} to ${toId} as ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "group_elements",
    {
      title: "Group elements",
      description:
        "Groups 2+ elements into a new Group container sized to their combined bounds.",
      inputSchema: { ids: z.array(z.string()), padding: z.number().optional() },
      outputSchema: idOutput,
    },
    ({ ids, padding }) => {
      try {
        const id = editor().groupElements(
          ids,
          padding !== undefined ? { padding } : {},
        );
        if (!id)
          throw new ToolError(
            "group_elements needs at least 2 known element ids.",
          );
        return ok({ id }, `Grouped ${ids.length} element(s) as ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "ungroup_element",
    {
      title: "Ungroup a container",
      description:
        "Removes a Box/Group/Zone/Frame container but keeps its contents, reparenting them to its own parent.",
      inputSchema: { id: z.string() },
    },
    ({ id }) => {
      try {
        const scoped = editor();
        const before = scoped.scene.get(id);
        if (!before) throw new ToolError(`Unknown element "${id}".`);
        scoped.ungroupElement(id);
        if (scoped.scene.has(id))
          throw new ToolError(
            `"${id}" is not a container — nothing to ungroup.`,
          );
        return ok({ id }, `Ungrouped ${id}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "frame_reorder",
    {
      title: "Reorder presentation frames",
      description:
        "Applies an exact presentation order to every frame in the document, as one undo step.",
      inputSchema: {
        frameIds: z
          .array(z.string())
          .describe("Every frame id, in the desired presentation order"),
      },
    },
    ({ frameIds }) => {
      try {
        editor().reorderFrames(frameIds);
        return ok({ frameIds }, `Reordered ${frameIds.length} frame(s).`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  const zOrderOutput = { ids: z.array(z.string()), changed: z.boolean() };
  const zOrderTool = (
    name: string,
    title: string,
    description: string,
    verb: string,
    apply: (ids: string[]) => boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: { ids: z.array(z.string()) },
        outputSchema: zOrderOutput,
      },
      ({ ids }) => {
        try {
          const changed = apply(ids);
          return ok(
            { ids, changed },
            changed
              ? `${verb} ${ids.length} element(s).`
              : `No change — already ${verb.toLowerCase()}.`,
          );
        } catch (err) {
          return fail(err);
        }
      },
    );
  };

  zOrderTool(
    "element_bring_to_front",
    "Bring elements to front",
    "Moves every given element to the front (top) of its own sibling bracket — elements sharing the same parent container, or the top level. Never changes order across different containers.",
    "Brought to front",
    (ids) => editor().bringToFront(ids),
  );
  zOrderTool(
    "element_send_to_back",
    "Send elements to back",
    "Moves every given element to the back (bottom) of its own sibling bracket — elements sharing the same parent container, or the top level. Never changes order across different containers.",
    "Sent to back",
    (ids) => editor().sendToBack(ids),
  );
  zOrderTool(
    "element_bring_forward",
    "Bring elements forward",
    "Steps every given element one position toward the front within its own sibling bracket.",
    "Brought forward",
    (ids) => editor().bringForward(ids),
  );
  zOrderTool(
    "element_send_backward",
    "Send elements backward",
    "Steps every given element one position toward the back within its own sibling bracket.",
    "Sent backward",
    (ids) => editor().sendBackward(ids),
  );

  const distributeOutput = { ids: z.array(z.string()), changed: z.boolean() };
  const distributeTool = (
    name: string,
    title: string,
    description: string,
    verb: string,
    apply: (ids: string[]) => boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: { ids: z.array(z.string()) },
        outputSchema: distributeOutput,
      },
      ({ ids }) => {
        try {
          const changed = apply(ids);
          return ok(
            { ids, changed },
            changed
              ? `${verb} ${ids.length} element(s).`
              : `No change — fewer than three distributable elements, or already evenly spaced.`,
          );
        } catch (err) {
          return fail(err);
        }
      },
    );
  };

  distributeTool(
    "element_distribute_horizontal",
    "Distribute elements horizontally",
    "Spaces selected elements so horizontal gaps between them are equal. Anchors the leftmost and rightmost elements in place; requires at least three distributable (non-connector) elements.",
    "Distributed horizontally",
    (ids) => editor().distributeHorizontal(ids),
  );
  distributeTool(
    "element_distribute_vertical",
    "Distribute elements vertically",
    "Spaces selected elements so vertical gaps between them are equal. Anchors the topmost and bottommost elements in place; requires at least three distributable (non-connector) elements.",
    "Distributed vertically",
    (ids) => editor().distributeVertical(ids),
  );

  const alignOutput = { ids: z.array(z.string()), changed: z.boolean() };
  const alignTool = (
    name: string,
    title: string,
    description: string,
    verb: string,
    apply: (ids: string[]) => boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: { ids: z.array(z.string()) },
        outputSchema: alignOutput,
      },
      ({ ids }) => {
        try {
          const changed = apply(ids);
          return ok(
            { ids, changed },
            changed
              ? `${verb} ${ids.length} element(s).`
              : `No change — nothing alignable, or already ${verb.toLowerCase()}.`,
          );
        } catch (err) {
          return fail(err);
        }
      },
    );
  };

  alignTool(
    "element_align_left",
    "Align elements left",
    "Aligns every given element's left edge to the leftmost edge of the whole given selection's bounding box. Requires at least two alignable (non-connector) elements.",
    "Aligned left",
    (ids) => editor().alignLeft(ids),
  );
  alignTool(
    "element_align_center_horizontal",
    "Align elements to horizontal center",
    "Aligns every given element's horizontal center to the horizontal center of the whole given selection's bounding box. Requires at least two alignable (non-connector) elements.",
    "Aligned center",
    (ids) => editor().alignCenterHorizontal(ids),
  );
  alignTool(
    "element_align_right",
    "Align elements right",
    "Aligns every given element's right edge to the rightmost edge of the whole given selection's bounding box. Requires at least two alignable (non-connector) elements.",
    "Aligned right",
    (ids) => editor().alignRight(ids),
  );
  alignTool(
    "element_align_top",
    "Align elements top",
    "Aligns every given element's top edge to the topmost edge of the whole given selection's bounding box. Requires at least two alignable (non-connector) elements.",
    "Aligned top",
    (ids) => editor().alignTop(ids),
  );
  alignTool(
    "element_align_middle",
    "Align elements to vertical middle",
    "Aligns every given element's vertical center to the vertical center of the whole given selection's bounding box. Requires at least two alignable (non-connector) elements.",
    "Aligned middle",
    (ids) => editor().alignMiddle(ids),
  );
  alignTool(
    "element_align_bottom",
    "Align elements bottom",
    "Aligns every given element's bottom edge to the bottommost edge of the whole given selection's bounding box. Requires at least two alignable (non-connector) elements.",
    "Aligned bottom",
    (ids) => editor().alignBottom(ids),
  );

  // ── Lock / Hide (M18.4, docs/10-canvas-parity-plan.md) ──────────────────────
  const lockHideOutput = { ids: z.array(z.string()), changed: z.boolean() };
  const lockHideTool = (
    name: string,
    title: string,
    description: string,
    apply: (ids: string[]) => boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: { ids: z.array(z.string()) },
        outputSchema: lockHideOutput,
      },
      ({ ids }) => {
        try {
          const changed = apply(ids);
          return ok(
            { ids, changed },
            changed
              ? `${title}: ${ids.length} element(s) changed.`
              : `No change — all elements already in the target state.`,
          );
        } catch (err) {
          return fail(err);
        }
      },
    );
  };

  lockHideTool(
    "element_lock",
    "Lock elements",
    "Prevents the given elements (and all their descendants) from being dragged, resized, reparented, or deleted via the UI. Returns changed=false when all are already locked.",
    (ids) => editor().lockElements(ids),
  );
  lockHideTool(
    "element_unlock",
    "Unlock elements",
    "Allows the given elements (and all their descendants) to be dragged, resized, reparented, and deleted again. Returns changed=false when all are already unlocked.",
    (ids) => editor().unlockElements(ids),
  );
  lockHideTool(
    "element_hide",
    "Hide elements",
    "Renders the given elements (and all their descendants) at reduced opacity and excludes them from pointer hit-testing. Returns changed=false when all are already hidden.",
    (ids) => editor().hideElements(ids),
  );
  lockHideTool(
    "element_show",
    "Show elements",
    "Restores the given elements (and all their descendants) to full opacity and pointer-event visibility. Returns changed=false when all are already visible.",
    (ids) => editor().showElements(ids),
  );
}
