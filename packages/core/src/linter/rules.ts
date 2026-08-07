import {
  autoRouteConnector,
  batch,
  moveElements,
  rotateElement,
  updateElement,
} from "../commands/commands.js";
import type { Command } from "../commands/types.js";
import {
  borderHugCost,
  pathCrossesObstacles,
} from "../routing/orthogonalRouter.js";
import {
  connectorPathPoints,
  obstaclesFor,
} from "../routing/routeConnector.js";
import {
  CONTAINER_LABEL_FONT_SIZE_PX,
  containerLabelMaxWidth,
} from "../render/containerLabel.js";
import { nodeLabelMaxWidth } from "../render/nodeLabel.js";
import { ellipsize, wrapText } from "../render/textMetrics.js";
import type { Scene } from "../scene/scene.js";
import { CONTAINER_CHILD_PADDING_PX } from "../scene/containerPadding.js";
import type {
  ConnectorElement,
  ConnectorType,
  PortSide,
  SceneElement,
  Semantic,
} from "../scene/types.js";
import {
  PRIMARY_TO_SECONDARY_FILL,
  SECONDARY_TO_PRIMARY_FILL,
} from "../theme/colorPalette.js";
import type { Diagnostic, Rule, RuleMetadata, Severity } from "./types.js";

const LABELED_TYPES = new Set(["box", "group", "zone", "actor"]);
const VALID_PORTS = new Set<PortSide>(["n", "e", "s", "w", "center"]);
const VALID_CONNECTOR_TYPES = new Set<ConnectorType>([
  "logical-connection",
  "connection",
  "physical-connection",
  "tunneling-connection",
  "traffic-through-double-tunnel",
  "dependency",
  "association",
  "aggregation",
  "composition",
  "implementation",
  "extends",
]);

function colorKey(color: string): string {
  return color.trim().toLowerCase();
}

function diagnostic(
  ruleId: string,
  severity: Severity,
  category: Diagnostic["category"],
  elementId: string,
  message: string,
  quickFix?: Command,
  quickFixLabel?: string,
): Diagnostic {
  return {
    id: `${ruleId}:${elementId}`,
    ruleId,
    severity,
    category,
    elementId,
    message,
    ...(quickFix ? { quickFix } : {}),
    ...(quickFixLabel ? { quickFixLabel } : {}),
  };
}

/** Boxes/groups/zones/actors should carry a label per packages/core/docs/ibm-spec-conformance.md. */
export const missingLabelRule: Rule = (scene: Scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (!LABELED_TYPES.has(el.type) || el.label?.text.trim()) continue;
    diagnostics.push(
      diagnostic(
        "missing-label",
        "warn",
        "labels",
        el.id,
        `"${el.id}" (${el.type}) is missing a required label.`,
        updateElement(scene, el.id, { label: { text: "Untitled" } }),
        "Add label",
      ),
    );
  }
  return diagnostics;
};

/** Repeated visible names make reviews and connector descriptions ambiguous. */
export const duplicateLabelRule: Rule = (scene: Scene): Diagnostic[] => {
  const byLabel = new Map<string, SceneElement[]>();
  for (const el of scene.all()) {
    const label = el.label?.text.trim();
    if (!label || el.type === "connector") continue;
    const key = label.toLocaleLowerCase();
    byLabel.set(key, [...(byLabel.get(key) ?? []), el]);
  }

  const diagnostics: Diagnostic[] = [];
  for (const elements of byLabel.values()) {
    if (elements.length < 2) continue;
    for (let index = 0; index < elements.length; index += 1) {
      const el = elements[index]!;
      const original = el.label!.text.trim();
      const replacement = `${original} ${index + 1}`;
      diagnostics.push(
        diagnostic(
          "duplicate-label",
          "warn",
          "labels",
          el.id,
          `Label "${original}" is used by ${elements.length} elements.`,
          updateElement(scene, el.id, {
            label: { ...el.label, text: replacement },
          }),
          `Rename to "${replacement}"`,
        ),
      );
    }
  }
  return diagnostics;
};

/**
 * A label whose stored text is long enough that it renders visibly truncated — even after the
 * same wrap-then-ellipsize treatment the renderer itself applies (M27.2/M27.3's textMetrics.ts):
 * a container label ellipsized to fit its single line, or an icon/actor caption whose 2-line wrap
 * still needed a trailing ellipsis. Purely informational (no quick fix - there's no principled
 * automatic way to shorten someone's label text, or to know whether the container should instead
 * grow to fit it), but valuable for LLM/agent-authored diagrams via MCP: the model may have no
 * other way to notice its own chosen wording doesn't actually fit.
 */
export const textOverflowNeedsWrapRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    const text = el.label?.text;
    if (!text) continue;

    if (el.type === "box" || el.type === "group" || el.type === "zone") {
      const rendered = ellipsize(
        text,
        containerLabelMaxWidth(el),
        "end",
        CONTAINER_LABEL_FONT_SIZE_PX,
      );
      if (rendered === text) continue;
      diagnostics.push(
        diagnostic(
          "text-overflow-needs-wrap",
          "info",
          "labels",
          el.id,
          `"${el.id}"'s label doesn't fit and renders truncated as "${rendered}".`,
        ),
      );
    } else if (el.type === "iconNode" || el.type === "actor") {
      const lines = wrapText(text, nodeLabelMaxWidth(el, scene), {
        maxLines: 2,
      });
      const lastLine = lines[lines.length - 1];
      if (!lastLine?.endsWith("…")) continue;
      diagnostics.push(
        diagnostic(
          "text-overflow-needs-wrap",
          "info",
          "labels",
          el.id,
          `"${el.id}"'s label doesn't fit on two lines and renders truncated.`,
        ),
      );
    }
  }
  return diagnostics;
};

/** An IconNode must resolve to the document's pinned IBM catalog. */
export const catalogIconRule: Rule = (scene, context): Diagnostic[] => {
  if (!context?.catalog) return [];
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "iconNode") continue;
    if (el.catalogRef && context.catalog.resolve(el.catalogRef)) continue;
    diagnostics.push(
      diagnostic(
        "non-catalog-icon",
        "error",
        "semantics",
        el.id,
        `"${el.id}" references an icon that is not in catalog ${context.catalog.id}@${context.catalog.version}.`,
      ),
    );
  }
  return diagnostics;
};

/**
 * Document-level, not per-element (Roadmap M13): flags when this file's pinned
 * `scene.catalog` ({ id, version }, packages/core/docs/file-format.md) doesn't match the currently
 * bundled catalog. Informational only — `catalogIconRule` already flags any actually-broken
 * `catalogRef`, and `Catalog.resolve()`'s `aliases` fallback (packages/core/src/catalog/catalog.ts)
 * already resolves most renames invisibly — this just explains *why* a file might be showing
 * gray-tile fallback icons (svgRenderer.ts) even when nothing is technically broken.
 */
export const catalogVersionMismatchRule: Rule = (
  scene,
  context,
): Diagnostic[] => {
  if (!context?.catalog) return [];
  if (
    scene.catalog.id === context.catalog.id &&
    scene.catalog.version === context.catalog.version
  ) {
    return [];
  }
  return [
    {
      id: "catalog-version-mismatch",
      ruleId: "catalog-version-mismatch",
      severity: "info",
      category: "semantics",
      message:
        `This file was authored against catalog ${scene.catalog.id}@${scene.catalog.version}, ` +
        `but the running app is on ${context.catalog.id}@${context.catalog.version}. ` +
        `Icons that were renamed since then still resolve via the catalog's aliases; a ` +
        `gray-tile icon means its reference no longer exists in either version.`,
    },
  ];
};

/**
 * Raw/hand-edited files can disagree about container shape and IBM semantic.
 * Normalize the concrete type to the declared deployedOn/deployedTo meaning
 * where that intent is recoverable.
 */
export const containerSemanticRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    const semantic = (el as { semantic: Semantic }).semantic;
    if (el.type === "box" && semantic !== "deployedOn") {
      const convert = semantic === "deployedTo";
      diagnostics.push(
        diagnostic(
          "container-semantic",
          "error",
          "semantics",
          el.id,
          `"${el.id}" is drawn as a Box but declares the "${semantic}" semantic.`,
          updateElement(
            scene,
            el.id,
            convert
              ? ({
                  type: "group",
                  semantic: "deployedTo",
                } as Partial<SceneElement>)
              : ({ semantic: "deployedOn" } as Partial<SceneElement>),
          ),
          convert ? "Convert to Group" : "Use deployedOn",
        ),
      );
    }
    if (el.type === "group" && semantic !== "deployedTo") {
      const convert = semantic === "deployedOn";
      diagnostics.push(
        diagnostic(
          "container-semantic",
          "error",
          "semantics",
          el.id,
          `"${el.id}" is drawn as a Group but declares the "${semantic}" semantic.`,
          updateElement(
            scene,
            el.id,
            convert
              ? ({
                  type: "box",
                  semantic: "deployedOn",
                } as Partial<SceneElement>)
              : ({ semantic: "deployedTo" } as Partial<SceneElement>),
          ),
          convert ? "Convert to Box" : "Use deployedTo",
        ),
      );
    }
  }
  return diagnostics;
};

/** Explicit border overrides must preserve solid Box / dashed Group meaning. */
export const containerBorderRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    const wrongBox = el.type === "box" && el.style?.dashed === true;
    const wrongGroup = el.type === "group" && el.style?.dashed === false;
    if (!wrongBox && !wrongGroup) continue;
    const nextStyle = { dashed: wrongGroup };
    diagnostics.push(
      diagnostic(
        "container-border",
        "warn",
        "semantics",
        el.id,
        `"${el.id}" uses the wrong border style for a ${el.type}.`,
        updateElement(scene, el.id, { style: nextStyle }),
        wrongBox ? "Use solid border" : "Use dashed border",
      ),
    );
  }
  return diagnostics;
};

/** Saturated primary colors are accents/outlines, never shape fills. */
export const primaryFillRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    const fill = el.style?.fill;
    if (!fill) continue;
    const secondary = PRIMARY_TO_SECONDARY_FILL[colorKey(fill)];
    if (!secondary) continue;
    diagnostics.push(
      diagnostic(
        "primary-color-fill",
        "warn",
        "semantics",
        el.id,
        `"${el.id}" uses a saturated primary color as a fill; IBM primary colors are for accents.`,
        updateElement(scene, el.id, { style: { fill: secondary } }),
        `Use ${secondary} tint`,
      ),
    );
  }
  return diagnostics;
};

/** Light secondary tints are fills, never outlines or connector strokes. */
export const secondaryStrokeRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    const stroke = el.style?.stroke;
    if (!stroke) continue;
    const primary = SECONDARY_TO_PRIMARY_FILL[colorKey(stroke)];
    if (!primary) continue;
    diagnostics.push(
      diagnostic(
        "secondary-color-stroke",
        "warn",
        "semantics",
        el.id,
        `"${el.id}" uses a light fill tint for an outline or connector.`,
        updateElement(scene, el.id, { style: { stroke: primary } }),
        `Use ${primary} primary`,
      ),
    );
  }
  return diagnostics;
};

/**
 * In high-level and detailed topology, an IBM component needs location
 * context. System-context and blank diagrams intentionally allow standalone
 * components.
 */
export const nodeWithoutLocationRule: Rule = (scene): Diagnostic[] => {
  if (
    scene.meta.diagramLevel !== "high-level" &&
    scene.meta.diagramLevel !== "detailed"
  )
    return [];
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "iconNode") continue;
    const located = scene
      .ancestorsOf(el.id)
      .some((ancestor) => ancestor.type === "box" || ancestor.type === "zone");
    if (located) continue;
    diagnostics.push(
      diagnostic(
        "node-without-location",
        "warn",
        "containment",
        el.id,
        `"${el.id}" has no Box or Boundary ancestor in a ${scene.meta.diagramLevel} diagram.`,
      ),
    );
  }
  return diagnostics;
};

/** Container types whose bounds a child is expected to actually sit inside — mirrors the visual
 * nesting convention (solid/dashed/dotted box drawn around its contents), independent of
 * `nodeWithoutLocationRule`'s narrower "counts as a deployedOn location" definition (which
 * excludes Group on purpose). Frame is excluded: it's a presentation/sectioning primitive, always
 * top-level, not a visual nesting container children are drawn inside. */
const BOUNDS_ENFORCING_CONTAINERS = new Set(["box", "group", "zone"]);

/** Placed a repositioned child this far inside its container's own edges — the app's shared
 * child-to-container padding convention (scene/containerPadding.ts), which the authoring skill
 * already tells agents to place new children within. */
const CONTAINER_INSET = CONTAINER_CHILD_PADDING_PX;

/**
 * A child with a real containing Box/Group/Zone whose geometry doesn't overlap that container's
 * bounds at all — an easy coordinate-math mistake, and one nothing else catches: containment here
 * is a logical `parentId` plus manually-consistent absolute coordinates (not an automatic layout),
 * rendering doesn't clip or warn on it, and `nodeWithoutLocationRule` only checks whether *some*
 * ancestor box/zone exists, never whether the geometry actually agrees with it. Deliberately only
 * flags complete disjunction, not a child that merely overhangs an edge — plenty of real diagrams
 * intentionally let a child sit flush against, or slightly past, its container's border.
 */
export const childOutsideParentBoundsRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (!el.parentId || el.type === "connector" || el.type === "frame")
      continue;
    const parent = scene.get(el.parentId);
    if (!parent || !BOUNDS_ENFORCING_CONTAINERS.has(parent.type)) continue;

    const disjoint =
      el.x + el.w <= parent.x ||
      el.x >= parent.x + parent.w ||
      el.y + el.h <= parent.y ||
      el.y >= parent.y + parent.h;
    if (!disjoint) continue;

    diagnostics.push(
      diagnostic(
        "child-outside-parent-bounds",
        "warn",
        "containment",
        el.id,
        `"${el.id}" is positioned entirely outside its container "${parent.id}"'s bounds.`,
        moveElements(
          scene,
          [el.id],
          parent.x + CONTAINER_INSET - el.x,
          parent.y + CONTAINER_INSET - el.y,
        ),
        "Move inside container",
      ),
    );
  }
  return diagnostics;
};

/**
 * A child that overlaps its container, but only partially — more than half its own area hangs off
 * the edge. Distinct from childOutsideParentBoundsRule (zero overlap) and deliberately narrower
 * than "any overhang at all": that rule's own doc comment already establishes that a child sitting
 * flush against, or slightly past, its container's border is a legitimate, common layout choice,
 * not a mistake — this rule respects that same judgment call, only firing once a child reads as
 * "mostly outside" rather than "mostly inside with a bit spilling over."
 */
export const childOverhangsParentRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (!el.parentId || el.type === "connector" || el.type === "frame")
      continue;
    const parent = scene.get(el.parentId);
    if (!parent || !BOUNDS_ENFORCING_CONTAINERS.has(parent.type)) continue;

    const overlapW = Math.max(
      0,
      Math.min(el.x + el.w, parent.x + parent.w) - Math.max(el.x, parent.x),
    );
    const overlapH = Math.max(
      0,
      Math.min(el.y + el.h, parent.y + parent.h) - Math.max(el.y, parent.y),
    );
    const overlapArea = overlapW * overlapH;
    if (overlapArea <= 0) continue; // fully disjoint - childOutsideParentBoundsRule's territory
    const childArea = el.w * el.h;
    if (childArea <= 0 || overlapArea >= childArea / 2) continue;

    diagnostics.push(
      diagnostic(
        "child-overhangs-parent",
        "warn",
        "containment",
        el.id,
        `"${el.id}" mostly hangs off its container "${parent.id}"'s edge — more than half its area sits outside.`,
        moveElements(
          scene,
          [el.id],
          parent.x + CONTAINER_INSET - el.x,
          parent.y + CONTAINER_INSET - el.y,
        ),
        "Move inside container",
      ),
    );
  }
  return diagnostics;
};

/**
 * A child that's genuinely *inside* its container (not childOutsideParentBoundsRule's territory
 * — complete disjunction — nor an overhang past an edge, left for that rule's own future overhang
 * extension) but sitting closer to one of the container's edges than
 * CONTAINER_CHILD_PADDING_PX (scene/containerPadding.ts) — the app's one child-to-container inset
 * convention, applied consistently everywhere else (snap guides, auto-grow, resize-reflow,
 * grouping) but never previously validated for hand-authored or agent-authored geometry that
 * never went through any of those interactive paths.
 *
 * Advisory (`info`, not `warn`): a tight-but-still-inside child is routinely a deliberate layout
 * choice (a border-flush accent strip, a tightly fitted icon), not a coordinate mistake — so this
 * offers an explicit per-element opt-out (`gutterExempt`) rather than forcing every diagram to
 * either satisfy the convention or accept a louder warning. This is the data-level version of what
 * the ROKS reference templates' "Master" band gutter previously only self-declared via a source
 * code comment, which a lint rule has no way to read.
 */
export const containerChildPaddingRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (!el.parentId || el.type === "connector" || el.type === "frame")
      continue;
    if (el.gutterExempt) continue;
    const parent = scene.get(el.parentId);
    if (!parent || !BOUNDS_ENFORCING_CONTAINERS.has(parent.type)) continue;

    const left = el.x - parent.x;
    const right = parent.x + parent.w - (el.x + el.w);
    const top = el.y - parent.y;
    const bottom = parent.y + parent.h - (el.y + el.h);
    // Only an edge the child is genuinely inside of (a negative gap is an overhang -
    // childOutsideParentBoundsRule's territory, not this rule's) counts as "too tight."
    const isTight = (gap: number) =>
      gap >= 0 && gap < CONTAINER_CHILD_PADDING_PX;
    if (![left, right, top, bottom].some(isTight)) continue;

    const dx = isTight(left)
      ? CONTAINER_CHILD_PADDING_PX - left
      : isTight(right)
        ? -(CONTAINER_CHILD_PADDING_PX - right)
        : 0;
    const dy = isTight(top)
      ? CONTAINER_CHILD_PADDING_PX - top
      : isTight(bottom)
        ? -(CONTAINER_CHILD_PADDING_PX - bottom)
        : 0;

    diagnostics.push(
      diagnostic(
        "container-child-padding",
        "info",
        "containment",
        el.id,
        `"${el.id}" sits closer than ${CONTAINER_CHILD_PADDING_PX}px to its container "${parent.id}"'s edge.`,
        moveElements(scene, [el.id], dx, dy),
        "Move inside padding",
      ),
    );
  }
  return diagnostics;
};

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/**
 * Two elements sharing the same parent (or both top-level, sharing no parent) whose bounding boxes
 * genuinely overlap — occluding or visually merging with each other, usually a real defect
 * regardless of diagram style, unlike a mere close gap (deliberately not flagged: siblings sitting
 * flush against or close to one another is routine and often intentional, e.g. a row of icons).
 *
 * Respects the same `gutterExempt` opt-out containerChildPaddingRule does: a deliberate decorative
 * overlay (e.g. the ROKS reference templates' translucent "Master" band, drawn across all 3 zones
 * on purpose) is exactly the shape this would otherwise flag as a mistake. If either side of an
 * overlapping pair is exempt, that pair is skipped entirely — the overlap is intentional because
 * of that element, regardless of what the other one is.
 *
 * Scoped to same-parent siblings only, grouped in one O(n) pass, then compared pairwise only
 * *within* each (typically small) group — not all-pairs across the whole scene, which would be
 * O(n²) against the perf budgets M27.3 already flagged as tight (docs/roadmap.md#m12).
 * Connectors are excluded: their own stored x/y/w/h is a degenerate 0x0 rect (docs/architecture.md), not a real footprint.
 */
export const siblingOverlapRule: Rule = (scene): Diagnostic[] => {
  const groups = new Map<string, SceneElement[]>();
  for (const el of scene.all()) {
    if (el.type === "connector") continue;
    const key = el.parentId ?? "";
    const list = groups.get(key);
    if (list) list.push(el);
    else groups.set(key, [el]);
  }

  const diagnostics: Diagnostic[] = [];
  const flagged = new Set<string>();
  for (const siblings of groups.values()) {
    for (let i = 0; i < siblings.length; i += 1) {
      for (let j = i + 1; j < siblings.length; j += 1) {
        const a = siblings[i]!;
        const b = siblings[j]!;
        if (a.gutterExempt || b.gutterExempt) continue;
        if (!rectsOverlap(a, b)) continue;
        for (const [el, other] of [
          [a, b],
          [b, a],
        ] as const) {
          if (flagged.has(el.id)) continue;
          flagged.add(el.id);
          diagnostics.push(
            diagnostic(
              "sibling-overlap",
              "warn",
              "layout",
              el.id,
              `"${el.id}" overlaps sibling element "${other.id}".`,
            ),
          );
        }
      }
    }
  }
  return diagnostics;
};

/** Connectors whose endpoint element no longer exists. */
export const danglingConnectorRule: Rule = (scene: Scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector") continue;
    if (scene.has(el.from.elementId) && scene.has(el.to.elementId)) continue;
    diagnostics.push(
      diagnostic(
        "dangling-connector",
        "error",
        "connectors",
        el.id,
        `Connector "${el.id}" has an endpoint that no longer exists.`,
      ),
    );
  }
  return diagnostics;
};

/** Hand-edited files may contain connector names outside IBM's nomenclature. */
export const standardConnectorTypeRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector" || VALID_CONNECTOR_TYPES.has(el.connectorType))
      continue;
    diagnostics.push(
      diagnostic(
        "non-standard-connector",
        "error",
        "connectors",
        el.id,
        `Connector "${el.id}" uses the non-standard type "${String(el.connectorType)}".`,
        updateElement(scene, el.id, {
          connectorType: "association",
        } as Partial<SceneElement>),
        "Use Association",
      ),
    );
  }
  return diagnostics;
};

/**
 * IBM's structured protocol/encapsulation annotation (packages/core/docs/ibm-spec-conformance.md#connector-
 * nomenclature) only makes sense with a name — a security/port descriptor with nothing to
 * describe is incomplete — and its PORT segment is always a network port number.
 */
export const connectorAnnotationRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector" || !el.annotation) continue;
    const { name, port } = el.annotation;
    if (!name.trim()) {
      diagnostics.push(
        diagnostic(
          "connector-annotation-incomplete",
          "warn",
          "connectors",
          el.id,
          `Connector "${el.id}" has a protocol/encapsulation annotation with no name.`,
        ),
      );
    }
    if (port?.trim() && !/^\d+$/.test(port.trim())) {
      diagnostics.push(
        diagnostic(
          "connector-annotation-invalid-port",
          "warn",
          "connectors",
          el.id,
          `Connector "${el.id}"'s annotation port "${port}" is not a plain port number.`,
        ),
      );
    }
  }
  return diagnostics;
};

function nearestPort(source: SceneElement, target: SceneElement): PortSide {
  const dx = target.x + target.w / 2 - (source.x + source.w / 2);
  const dy = target.y + target.h / 2 - (source.y + source.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}

/** Every endpoint must bind to one of the five named ports. */
export const connectorPortRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector") continue;
    const invalidFrom = !VALID_PORTS.has(el.from.port);
    const invalidTo = !VALID_PORTS.has(el.to.port);
    if (!invalidFrom && !invalidTo) continue;
    const fromEl = scene.get(el.from.elementId);
    const toEl = scene.get(el.to.elementId);
    let quickFix: Command | undefined;
    if (fromEl && toEl) {
      const patched: ConnectorElement = {
        ...el,
        from: {
          ...el.from,
          port: invalidFrom ? nearestPort(fromEl, toEl) : el.from.port,
        },
        to: {
          ...el.to,
          port: invalidTo ? nearestPort(toEl, fromEl) : el.to.port,
        },
      };
      quickFix = batch("bind connector to nearest ports", [
        updateElement(scene, el.id, {
          from: patched.from,
          to: patched.to,
        } as Partial<SceneElement>),
        autoRouteConnector(scene, el.id),
      ]);
    }
    diagnostics.push(
      diagnostic(
        "connector-not-bound-to-port",
        "error",
        "connectors",
        el.id,
        `Connector "${el.id}" has an endpoint that is not bound to a named port.`,
        quickFix,
        quickFix ? "Bind to nearest ports" : undefined,
      ),
    );
  }
  return diagnostics;
};

/**
 * Connectors whose route crosses a leaf shape it is not attached to can be
 * returned to the obstacle-avoiding router.
 */
export const connectorCrossesObstacleRule: Rule = (
  scene: Scene,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector") continue;
    if (!scene.has(el.from.elementId) || !scene.has(el.to.elementId)) continue;
    if (!VALID_PORTS.has(el.from.port) || !VALID_PORTS.has(el.to.port))
      continue;

    const points = connectorPathPoints(scene, el);
    const obstacles = obstaclesFor(
      scene,
      new Set([el.from.elementId, el.to.elementId]),
    );
    if (!pathCrossesObstacles(points, obstacles)) continue;

    diagnostics.push(
      diagnostic(
        "connector-crosses-obstacle",
        "warn",
        "connectors",
        el.id,
        `Connector "${el.id}" crosses another shape; a clean orthogonal route is available.`,
        autoRouteConnector(scene, el.id),
        "Re-route",
      ),
    );
  }
  return diagnostics;
};

/**
 * A connector whose final rendered path runs parallel to, and within the router's own border-
 * clearance distance of, an unrelated container's edge — the static residual counterpart to
 * M27.1's live routing-time deterrent (orthogonalRouter.ts's borderHugCost), which only ever runs
 * while the router itself is computing a fresh auto route. A `routing: "manual"` connector (hand-
 * set waypoints, e.g. from raw .icad JSON or direct MCP authoring) never passes through that cost
 * model at all, and even an auto-routed connector's waypoints can drift out of compliance if
 * hand-edited afterward — this rule catches both by re-checking the actual stored path rather than
 * trusting how it was produced. Reuses the router's own borderHugCost function directly so
 * "hugging" means the exact same thing here as it does during live routing.
 */
export const connectorBorderHugRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector") continue;
    if (!scene.has(el.from.elementId) || !scene.has(el.to.elementId)) continue;

    const containers = scene
      .all()
      .filter(
        (c) =>
          (c.type === "box" || c.type === "group" || c.type === "zone") &&
          c.id !== el.from.elementId &&
          c.id !== el.to.elementId,
      )
      .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
    if (containers.length === 0) continue;

    const points = connectorPathPoints(scene, el);
    let hugs = false;
    for (let i = 0; i < points.length - 1 && !hugs; i += 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (borderHugCost(a.x, a.y, b.x, b.y, containers) > 0) hugs = true;
    }
    if (!hugs) continue;

    diagnostics.push(
      diagnostic(
        "connector-border-hug",
        "warn",
        "connectors",
        el.id,
        `Connector "${el.id}" runs alongside a container's border closer than the router's own clearance convention.`,
        autoRouteConnector(scene, el.id),
        "Re-route",
      ),
    );
  }
  return diagnostics;
};

/** Public connections should read west-to-east, with gross reversals flagged. */
export const westEastFlowRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector" || el.flowColor !== "public") continue;
    const from = scene.get(el.from.elementId);
    const to = scene.get(el.to.elementId);
    if (!from || !to) continue;
    const fromX = from.x + from.w / 2;
    const toX = to.x + to.w / 2;
    if (fromX <= toX + 48) continue;
    diagnostics.push(
      diagnostic(
        "west-east-flow-reversal",
        "warn",
        "layout",
        el.id,
        `Public connector "${el.id}" flows right-to-left; public entry should read west-to-east.`,
      ),
    );
  }
  return diagnostics;
};

/** IBM node containers are exactly 48×48 with a 1px outline. */
export const iconGeometryRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (el.type !== "iconNode") continue;
    if (
      el.w === 48 &&
      el.h === 48 &&
      (el.style?.strokeWidth === undefined || el.style.strokeWidth === 1)
    )
      continue;
    diagnostics.push(
      diagnostic(
        "icon-geometry",
        "warn",
        "layout",
        el.id,
        `"${el.id}" has drifted from the IBM 48×48 container / 1px outline spec.`,
        updateElement(scene, el.id, {
          w: 48,
          h: 48,
          style: { strokeWidth: 1 },
        }),
        "Snap to 48×48",
      ),
    );
  }
  return diagnostics;
};

/**
 * Non-zero rotation is off-spec per IBM's architecture diagram kit — IBM's own worked examples
 * use only horizontal/vertical elements (D28, docs/decision-log.md). This rule is advisory:
 * the linter never blocks rotation, just flags it so diagrams that don't need it stay clean.
 * Quick-fix resets the element to 0°. Connectors and Frames are excluded — connectors derive
 * their geometry from routing (no rotation field is ever set on them), and Frame is excluded
 * from all rotation operations.
 */
export const nonZeroRotationRule: Rule = (scene): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    if (!el.rotation || el.type === "connector" || el.type === "frame")
      continue;
    diagnostics.push(
      diagnostic(
        "non-zero-rotation",
        "warn",
        "layout",
        el.id,
        `"${el.id}" is rotated ${el.rotation}°; IBM diagrams use only horizontal/vertical elements.`,
        rotateElement(scene, el.id, 0),
        "Reset to 0°",
      ),
    );
  }
  return diagnostics;
};

/**
 * Colors outside IBM's 9-pair primary/secondary palette are off-spec (D28,
 * docs/decision-log.md). This rule is advisory — the picker exists for deliberate one-offs —
 * and flags both `style.stroke` and `style.fill` when they don't match any palette entry.
 * Quick-fix is not offered here (there's no canonical "nearest palette color" function) to avoid
 * a lossy auto-correction the user didn't ask for.
 */
export const offPaletteColorRule: Rule = (scene): Diagnostic[] => {
  // IBM's 9-pair palette: every valid color is either a primary key or a secondary key.
  const isInPalette = (c: string): boolean =>
    c in PRIMARY_TO_SECONDARY_FILL ||
    c in SECONDARY_TO_PRIMARY_FILL ||
    colorKey(c) in PRIMARY_TO_SECONDARY_FILL ||
    colorKey(c) in SECONDARY_TO_PRIMARY_FILL;

  const diagnostics: Diagnostic[] = [];
  for (const el of scene.all()) {
    const stroke = el.style?.stroke;
    const fill = el.style?.fill;
    if (stroke && !isInPalette(stroke)) {
      diagnostics.push(
        diagnostic(
          "off-palette-color",
          "warn",
          "semantics",
          el.id,
          `"${el.id}" stroke "${stroke}" is outside IBM's 9-pair color palette.`,
        ),
      );
    }
    if (fill && !isInPalette(fill)) {
      diagnostics.push(
        diagnostic(
          "off-palette-color",
          "warn",
          "semantics",
          el.id,
          `"${el.id}" fill "${fill}" is outside IBM's 9-pair color palette.`,
        ),
      );
    }
  }
  return diagnostics;
};

export const ruleMetadata: RuleMetadata[] = [
  {
    id: "container-semantic",
    title: "Container semantics",
    category: "semantics",
    defaultSeverity: "error",
  },
  {
    id: "container-border",
    title: "Container border",
    category: "semantics",
    defaultSeverity: "warn",
  },
  {
    id: "non-catalog-icon",
    title: "Catalog icon",
    category: "semantics",
    defaultSeverity: "error",
  },
  {
    id: "catalog-version-mismatch",
    title: "Catalog version",
    category: "semantics",
    defaultSeverity: "info",
  },
  {
    id: "primary-color-fill",
    title: "Primary color fill",
    category: "semantics",
    defaultSeverity: "warn",
  },
  {
    id: "secondary-color-stroke",
    title: "Secondary color stroke",
    category: "semantics",
    defaultSeverity: "warn",
  },
  {
    id: "node-without-location",
    title: "Node location",
    category: "containment",
    defaultSeverity: "warn",
  },
  {
    id: "child-outside-parent-bounds",
    title: "Child inside container",
    category: "containment",
    defaultSeverity: "warn",
  },
  {
    id: "child-overhangs-parent",
    title: "Child overhang",
    category: "containment",
    defaultSeverity: "warn",
  },
  {
    id: "container-child-padding",
    title: "Container padding",
    category: "containment",
    defaultSeverity: "info",
  },
  {
    id: "missing-label",
    title: "Required labels",
    category: "labels",
    defaultSeverity: "warn",
  },
  {
    id: "duplicate-label",
    title: "Duplicate labels",
    category: "labels",
    defaultSeverity: "warn",
  },
  {
    id: "text-overflow-needs-wrap",
    title: "Text overflow",
    category: "labels",
    defaultSeverity: "info",
  },
  {
    id: "dangling-connector",
    title: "Dangling connector",
    category: "connectors",
    defaultSeverity: "error",
  },
  {
    id: "non-standard-connector",
    title: "Connector type",
    category: "connectors",
    defaultSeverity: "error",
  },
  {
    id: "connector-not-bound-to-port",
    title: "Connector ports",
    category: "connectors",
    defaultSeverity: "error",
  },
  {
    id: "connector-crosses-obstacle",
    title: "Connector crossing",
    category: "connectors",
    defaultSeverity: "warn",
  },
  {
    id: "connector-border-hug",
    title: "Connector border clearance",
    category: "connectors",
    defaultSeverity: "warn",
  },
  {
    id: "connector-annotation-incomplete",
    title: "Annotation name",
    category: "connectors",
    defaultSeverity: "warn",
  },
  {
    id: "connector-annotation-invalid-port",
    title: "Annotation port",
    category: "connectors",
    defaultSeverity: "warn",
  },
  {
    id: "sibling-overlap",
    title: "Sibling overlap",
    category: "layout",
    defaultSeverity: "warn",
  },
  {
    id: "west-east-flow-reversal",
    title: "West-east flow",
    category: "layout",
    defaultSeverity: "warn",
  },
  {
    id: "icon-geometry",
    title: "Icon geometry",
    category: "layout",
    defaultSeverity: "warn",
  },
  {
    id: "non-zero-rotation",
    title: "Non-zero rotation",
    category: "layout",
    defaultSeverity: "warn",
  },
  {
    id: "off-palette-color",
    title: "Off-palette color",
    category: "semantics",
    defaultSeverity: "warn",
  },
];

export const defaultRules: Rule[] = [
  containerSemanticRule,
  containerBorderRule,
  catalogIconRule,
  catalogVersionMismatchRule,
  primaryFillRule,
  secondaryStrokeRule,
  nodeWithoutLocationRule,
  childOutsideParentBoundsRule,
  childOverhangsParentRule,
  containerChildPaddingRule,
  missingLabelRule,
  duplicateLabelRule,
  textOverflowNeedsWrapRule,
  danglingConnectorRule,
  standardConnectorTypeRule,
  connectorPortRule,
  connectorCrossesObstacleRule,
  connectorBorderHugRule,
  connectorAnnotationRule,
  siblingOverlapRule,
  westEastFlowRule,
  iconGeometryRule,
  nonZeroRotationRule,
  offPaletteColorRule,
];
