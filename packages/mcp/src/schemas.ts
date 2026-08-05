import { z } from "zod";

/** Shared zod fragments mirroring @icad/core's scene/catalog types (docs/03-file-format.md,
 * docs/05-ibm-spec-conformance.md) — kept in one place so every tool schema stays in sync. */

export const pointSchema = z.object({ x: z.number(), y: z.number() });

export const portSideSchema = z.enum(["n", "e", "s", "w", "center"]);

export const portRefSchema = z.object({
  elementId: z.string().describe("The element this port belongs to"),
  port: portSideSchema,
});

const connectionTypeSchema = z.enum([
  "logical-connection",
  "connection",
  "physical-connection",
  "tunneling-connection",
  "traffic-through-double-tunnel",
]);

const relationshipTypeSchema = z.enum([
  "dependency",
  "association",
  "aggregation",
  "composition",
  "implementation",
  "extends",
]);

/** The five IBM connection types (physical/protocol traffic) plus the six relationship types
 * (logical, not traffic) — docs/05-ibm-spec-conformance.md#connector-nomenclature. */
export const connectorTypeSchema = z.union([
  connectionTypeSchema,
  relationshipTypeSchema,
]);

export const connectorDirectionSchema = z.enum([
  "unidirectional",
  "bidirectional",
]);

/** Independent of connectorType: green = private connection, blue = public. */
export const flowColorSchema = z.enum(["private", "public"]);

export const cardinalitySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

/** "Protocol/Application NAME" for connection/physical-connection, or "Encapsulation NAME" for a
 * tunnel type — which reading applies is inferred from the connector's own type, not stored here.
 * Formatted for display via @icad/core's formatConnectorAnnotation, e.g. "HTTPS TLS1.3:443". */
export const connectorAnnotationSchema = z.object({
  name: z.string(),
  security: z
    .string()
    .optional()
    .describe("Encryption/Security descriptor, e.g. TLS1.3"),
  port: z.string().optional(),
});

/** D24 (docs/00-decision-log.md): Region/VPC/Subnet are Box, not Zone — only az/on-prem remain. */
export const zoneKindSchema = z.enum(["az", "on-prem"]);

export const diagramTemplateIdSchema = z.enum([
  "blank",
  "system-context",
  "high-level",
  "detailed",
  "iks-sr-mz-classic",
  "iks-sr-mz-vpc",
  "roks-sr-mz-classic",
  "roks-sr-mz-vpc",
]);

export const iconMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  semantic: z.enum(["node", "actor"]),
  container: z.enum(["square", "rounded"]),
  color: z.string().optional(),
  asset: z.string(),
  keywords: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  tier: z.enum(["ibm-core", "ibm-cloud", "domains", "third-party"]).optional(),
});

export const catalogCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const styleSchema = z.object({
  stroke: z.string().optional(),
  fill: z.string().optional(),
  dashed: z.boolean().optional(),
  strokeWidth: z.number().optional(),
  colorToken: z.string().optional(),
});

export const labelSchema = z.object({
  text: z.string(),
  position: z.enum(["n", "s", "e", "w", "center"]).optional(),
});

/** Shared by every `element_add_*` tool — mirrors @icad/core's `PlacementOptions`. */
export const placementSchema = {
  id: z
    .string()
    .optional()
    .describe("Explicit element id; auto-generated if omitted"),
  at: pointSchema.describe("Top-left scene-space position"),
  w: z.number().optional(),
  h: z.number().optional(),
  parentId: z
    .string()
    .optional()
    .describe("Containing Box/Group/Zone/Frame id"),
  label: z.string().optional(),
};

/** Adds `catalogRef`/`style`, shared by Box/Group/Zone (@icad/core's `ContainerPlacementOptions`). */
export const containerPlacementSchema = {
  ...placementSchema,
  catalogRef: z
    .string()
    .optional()
    .describe("Corner icon shown on the container, e.g. for a preset"),
  style: styleSchema.optional(),
};

/** Mirrors @icad/core's `ElementPropertiesPatch` (Editor.updateElementProperties). */
export const elementPropertiesPatchSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  label: labelSchema.optional(),
  style: styleSchema.optional(),
  catalogRef: z.string().optional(),
  zoneKind: zoneKindSchema.optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  order: z.number().optional(),
  connectorType: connectorTypeSchema.optional(),
  direction: connectorDirectionSchema.optional(),
  flowColor: flowColorSchema.optional(),
  sequence: z.string().optional(),
  annotation: connectorAnnotationSchema.optional(),
  locked: z.boolean().optional().describe("Lock or unlock the element (M18.4)"),
  hidden: z.boolean().optional().describe("Hide or show the element (M18.4)"),
  gutterExempt: z
    .boolean()
    .optional()
    .describe(
      "Opt this element out of the container-child-padding and sibling-overlap advisories for a deliberate decorative layout choice, e.g. a band placed closer to its container's edge or overlapping a sibling on purpose (M27.6/M27.7)",
    ),
  rotation: z
    .number()
    .min(0)
    .max(359)
    .optional()
    .describe(
      "Rotation in degrees 0–359. Non-zero rotation is flagged as off-spec by the linter (D28). Connectors and Frames cannot be rotated. (M20)",
    ),
});

const severitySchema = z.enum(["error", "warn", "info"]);
const ruleCategorySchema = z.enum([
  "semantics",
  "containment",
  "labels",
  "connectors",
  "layout",
]);

/** Wire-safe projection of @icad/core's `Diagnostic` — `quickFix` is a live `Command` (closures)
 * that can't survive JSON-RPC, so it's replaced with `hasQuickFix`; `quickfix_apply` looks the
 * real object up server-side by `id` instead (see state.ts). */
export const diagnosticSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: severitySchema,
  category: ruleCategorySchema,
  message: z.string(),
  elementId: z.string().optional(),
  quickFixLabel: z.string().optional(),
  hasQuickFix: z.boolean(),
});

export const complianceSummarySchema = z.object({
  diagnostics: z.array(diagnosticSchema),
  counts: z.object({ error: z.number(), warn: z.number(), info: z.number() }),
  blocked: z.boolean(),
});
