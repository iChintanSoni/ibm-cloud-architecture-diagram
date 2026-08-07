import { z } from "zod";

/**
 * Structural validation for a raw parsed `.icad` element (I14,
 * docs/improvement-plan.md#i14--icad-schema-validation) — the gap `migrate()`/`repair()` left
 * open: `repair()` fixes a *referential* problem (a dangling `parentId`, a `parentId` cycle, a
 * connector missing an endpoint) against elements it already trusts are well-formed, but nothing
 * previously checked that trust itself. A `.icad` file reaches this from two untrusted-input
 * paths — the VS Code extension opens any file a workspace happens to contain, and the MCP server
 * `JSON.parse`s whatever path an LLM names — so an element whose `type` isn't a real discriminant,
 * whose `semantic` doesn't match its `type`, whose `x`/`y` is non-finite (propagates NaN through
 * every downstream layout/hit-test calculation, unlike `w`/`h`, which `repair()`'s `clampSize`
 * already catches), or whose connector `port` isn't one of the five real sides, previously reached
 * the live scene unchecked.
 *
 * Deliberately **not** validated here: whether a `catalogRef` resolves against a real catalog
 * entry — that needs a live `Catalog`, which this module (and `io/icad.ts` generally) has no
 * access to by design (packages/catalog is injected by shells, never imported by core) — and is
 * already covered live, for the open document, by the linter's `catalogIconRule`. This schema
 * only asks "is this shape one the engine can safely operate on," not "is this content correct."
 *
 * `w`/`h` deliberately accept a non-finite or non-positive number (`looseFiniteOrNot`, not plain
 * `z.number()`) so a document already exercising `repair()`'s existing `clampSize` step — which
 * accepts exactly this same class of garbage and clamps it to a minimum size — keeps working
 * unchanged: an element that would previously survive load with `w: 0`/`h: NaN` clamped to `1`
 * still does. Every other numeric field (`x`, `y`, `rotation`, `z`, waypoint coordinates, `order`,
 * `grid`) has no equivalent repair step, so those stay on zod's own default numeric behavior,
 * which already rejects `NaN`/`Infinity` — confirmed against the installed zod version, not
 * assumed from its docs, since this is a security-relevant validator.
 */

const looseFiniteOrNot = z.custom<number>(
  (value) => typeof value === "number",
  { message: "Expected a number" },
);

const styleSchema = z
  .object({
    stroke: z.string().optional(),
    fill: z.string().optional(),
    dashed: z.boolean().optional(),
    strokeWidth: z.number().optional(),
    colorToken: z.string().optional(),
  })
  .strict();

const labelSchema = z
  .object({
    text: z.string(),
    position: z.enum(["n", "s", "e", "w", "center"]).optional(),
  })
  .strict();

const portSideSchema = z.enum(["n", "e", "s", "w", "center"]);

const portRefSchema = z
  .object({
    elementId: z.string().min(1),
    port: portSideSchema,
  })
  .strict();

const connectorTypeSchema = z.enum([
  // ConnectionType
  "logical-connection",
  "connection",
  "physical-connection",
  "tunneling-connection",
  "traffic-through-double-tunnel",
  // RelationshipType
  "dependency",
  "association",
  "aggregation",
  "composition",
  "implementation",
  "extends",
]);

const connectorAnnotationSchema = z
  .object({
    name: z.string(),
    security: z.string().optional(),
    port: z.string().optional(),
  })
  .strict();

const endpointLabelsSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();

const waypointSchema = z.object({ x: z.number(), y: z.number() }).strict();

/** Fields every element type shares (`BaseElement` in scene/types.ts) — spread into each
 * discriminated variant below rather than composed via `.extend()` on a base object, since zod's
 * `z.discriminatedUnion` needs each member's own literal `type` field declared directly on it. */
const baseFields = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: looseFiniteOrNot,
  h: looseFiniteOrNot,
  rotation: z.number().optional(),
  parentId: z.string().min(1).optional(),
  label: labelSchema.optional(),
  style: styleSchema.optional(),
  z: z.number().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  gutterExempt: z.boolean().optional(),
} as const;

const iconNodeElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("iconNode"),
    semantic: z.literal("node"),
    catalogRef: z.string().min(1),
  })
  .strict();

const boxElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("box"),
    semantic: z.literal("deployedOn"),
    catalogRef: z.string().min(1).optional(),
  })
  .strict();

const groupElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("group"),
    semantic: z.literal("deployedTo"),
    catalogRef: z.string().min(1).optional(),
  })
  .strict();

const zoneElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("zone"),
    semantic: z.literal("boundary"),
    zoneKind: z.enum(["az", "on-prem"]),
    catalogRef: z.string().min(1).optional(),
  })
  .strict();

const actorElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("actor"),
    semantic: z.literal("actor"),
    catalogRef: z.string().min(1).optional(),
  })
  .strict();

const connectorElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("connector"),
    semantic: z.literal("node"),
    from: portRefSchema,
    to: portRefSchema,
    connectorType: connectorTypeSchema,
    direction: z.enum(["unidirectional", "bidirectional"]).optional(),
    flowColor: z.enum(["private", "public"]).optional(),
    cardinality: endpointLabelsSchema.optional(),
    sequence: z.string().optional(),
    annotation: connectorAnnotationSchema.optional(),
    waypoints: z.array(waypointSchema).optional(),
    routing: z.enum(["auto", "manual"]).optional(),
  })
  .strict();

const textElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("text"),
    semantic: z.literal("node"),
    text: z.string(),
  })
  .strict();

const frameElementSchema = z
  .object({
    ...baseFields,
    type: z.literal("frame"),
    semantic: z.literal("boundary"),
    name: z.string(),
    order: z.number(),
  })
  .strict();

/** Mirrors `SceneElement` (scene/types.ts) exactly — one arm per member of that union, each
 * `.strict()` so an unrecognized key (a stray field from a future schema version, or arbitrary
 * injected data) fails the element rather than passing through silently. `__proto__` specifically
 * doesn't trigger `.strict()`'s own rejection (a zod-level quirk, confirmed against the installed
 * version, not this schema's own choice) — but `JSON.parse` already produces a harmless *own*
 * property literally named `__proto__`, never a real prototype write, and zod's own parsed output
 * never carries that key through either way; verified directly in icadSchema.test.ts rather than
 * assumed. */
export const sceneElementSchema = z.discriminatedUnion("type", [
  iconNodeElementSchema,
  boxElementSchema,
  groupElementSchema,
  zoneElementSchema,
  actorElementSchema,
  connectorElementSchema,
  textElementSchema,
  frameElementSchema,
]);

export interface DroppedElement {
  /** Index in the original (pre-filter) `elements` array — stable identifying information even
   * when the element's own `id` field is itself what's malformed or missing. */
  index: number;
  /** The element's own `id`, if it at least parsed as a string — undefined when `id` itself is
   * missing or the wrong type. */
  id?: string;
  reason: string;
}

/**
 * Validates every raw array entry against {@link sceneElementSchema} independently — one
 * malformed element is dropped and reported, not allowed to fail the whole document (matching
 * `repair()`'s existing "never throw on a repairable file" contract, docs/03-file-format.md, now
 * packages/core/docs/file-format.md#versioning--migration). Order of surviving elements is
 * preserved.
 */
export function validateElements(raw: unknown[]): {
  valid: unknown[];
  dropped: DroppedElement[];
} {
  const valid: unknown[] = [];
  const dropped: DroppedElement[] = [];
  raw.forEach((candidate, index) => {
    const result = sceneElementSchema.safeParse(candidate);
    if (result.success) {
      valid.push(result.data);
      return;
    }
    const id =
      typeof candidate === "object" &&
      candidate !== null &&
      "id" in candidate &&
      typeof (candidate as { id: unknown }).id === "string"
        ? (candidate as { id: string }).id
        : undefined;
    dropped.push({
      index,
      ...(id !== undefined ? { id } : {}),
      reason: result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    });
  });
  return { valid, dropped };
}
