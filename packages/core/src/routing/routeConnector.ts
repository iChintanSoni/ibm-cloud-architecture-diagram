import { rotatedBounds } from "../scene/bounds.js";
import type { Scene } from "../scene/scene.js";
import { formatConnectorAnnotation } from "../scene/connectorAnnotation.js";
import type { ConnectorElement, PortSide } from "../scene/types.js";
import { containerLabelRect } from "../render/containerLabel.js";
import { pointAtFraction, portPoint, type Point } from "../render/port.js";
import { measureText } from "../render/textMetrics.js";
import {
  routeOrthogonal,
  type Rect,
  type SoftObstacle,
} from "./orthogonalRouter.js";

/**
 * Cost added (not blocked) for a segment crossing an unrelated container's padded interior. 10x
 * the router's own BEND_PENALTY: enough to make the router prefer a 1-3 bend detour around an
 * unrelated container when one is available nearby, without being so large it distorts routing
 * far from the obstacle. Tunable; refine by visual inspection of a real multi-container diagram,
 * not by re-deriving this number analytically.
 */
const CONTAINER_SOFT_OBSTACLE_PENALTY = 80;
/**
 * Cost added for a segment crossing a container's own label footprint (see
 * containerLabelRectsFor below) — roughly 2.5x CONTAINER_SOFT_OBSTACLE_PENALTY, reflecting that
 * cutting through literal text is a stronger visual defect than crossing a plain unrelated
 * container's empty interior, so it's worth a larger detour to avoid. Tunable, same as above.
 */
const LABEL_SOFT_OBSTACLE_PENALTY = 200;
/**
 * Cost added for a segment crossing another connector's own text (label/protocol annotation/
 * cardinality/sequence badge) — same magnitude as LABEL_SOFT_OBSTACLE_PENALTY (crossing literal
 * text is the defect being penalized either way, regardless of whether it's a container's title or
 * a connector's own caption). Kept as its own named constant rather than reusing
 * LABEL_SOFT_OBSTACLE_PENALTY directly since the two protect conceptually different things and may
 * need to be tuned independently later.
 */
const CONNECTOR_LABEL_SOFT_OBSTACLE_PENALTY = 200;
/**
 * Distinct from both penalty channels above: containerRectsFor's containers are passed to
 * routeOrthogonal's `containers` channel (minus the connector's own two endpoints, see
 * routeConnectorInScene) so a route never runs parallel to and hugging a border it's allowed —
 * even expected — to cross. Border clearance and "may this be crossed" are orthogonal questions:
 * an *ancestor* of an endpoint is exactly the kind of border a connector legitimately crosses per
 * the M4 decision, and is exactly where the ugly exact-on-the-border / few-px-inside routes this
 * fixes were coming from, so this deliberately does NOT use containerAvoidanceRectsFor's fuller
 * ancestor/descendant relatedness exemption — only the two literal endpoint elements themselves
 * are excluded, nothing about their ancestor chains. (Excluding only the direct endpoints, not
 * ancestors too, is still enough to avoid the failure mode this guards against: a connector
 * touching its own endpoint's border at the port is attachment, not hugging, and including that
 * endpoint's own edges was adding grid lines that could shift orthogonalRouter's Dijkstra
 * tie-breaking for routes having nothing to do with border clearance at all — e.g. two boxes
 * connected directly to each other, no other containers involved.) See orthogonalRouter.ts's
 * BORDER_CLEARANCE_PX doc comment for the actual mechanism.
 */

/**
 * Fraction of an element's own side length available for spreading multiple connectors that
 * share that exact (element, side) pair, so they don't all leave/arrive from one indistinguishable
 * point. Kept well short of 1 so a spread-out endpoint still clearly reads as attached to that
 * side, not to a corner.
 */
const PORT_FAN_SPAN_RATIO = 0.6;
/**
 * Minimum pixel gap enforced between adjacent connectors fanned along the same (element, side) —
 * PORT_FAN_SPAN_RATIO alone divides a fixed span more finely as sibling count grows, so it gets
 * *tighter* with more connectors sharing a side, backwards from what's needed. Arrowhead markers
 * render at 7x7px (svgRenderer.ts's marker defs); 16px clears a marker's own width plus a real
 * gap, so two arrowheads read as distinct rather than merging into what looks like one thick or
 * doubled line. Tunable; refine by visual inspection of a real fan-out/fan-in diagram, not by
 * re-deriving this number analytically.
 */
const MIN_PORT_SEPARATION_PX = 16;

interface PortSibling {
  connectorId: string;
  otherElementId: string;
}

interface PortGroupsCacheEntry {
  mutationCount: number;
  groups: Map<string, PortSibling[]>;
}

/** One entry per Scene, invalidated by `Scene.mutationCount` — see `portGroupsFor` below. */
const portGroupsCache = new WeakMap<Scene, PortGroupsCacheEntry>();

function portGroupKey(elementId: string, side: PortSide): string {
  return `${elementId} ${side}`;
}

/**
 * Every connector endpoint in the scene, grouped by the exact (element, side) it attaches to —
 * computed in one O(connector count) pass over the scene and cached until the scene's next
 * mutation, rather than rescanning per connector per endpoint (which made this an O(connector
 * count²) cost across a full render — steep enough to blow the M12 performance budget on a
 * several-hundred-connector scene).
 */
function portGroupsFor(scene: Scene): Map<string, PortSibling[]> {
  const cached = portGroupsCache.get(scene);
  if (cached && cached.mutationCount === scene.mutationCount)
    return cached.groups;

  const groups = new Map<string, PortSibling[]>();
  const add = (elementId: string, side: PortSide, sibling: PortSibling) => {
    const key = portGroupKey(elementId, side);
    const list = groups.get(key);
    if (list) list.push(sibling);
    else groups.set(key, [sibling]);
  };
  for (const candidate of scene.all()) {
    if (candidate.type !== "connector") continue;
    add(candidate.from.elementId, candidate.from.port, {
      connectorId: candidate.id,
      otherElementId: candidate.to.elementId,
    });
    add(candidate.to.elementId, candidate.to.port, {
      connectorId: candidate.id,
      otherElementId: candidate.from.elementId,
    });
  }
  portGroupsCache.set(scene, { mutationCount: scene.mutationCount, groups });
  return groups;
}

interface ContainerRect {
  id: string;
  rect: Rect;
}

interface ContainerRectsCacheEntry {
  mutationCount: number;
  rects: ContainerRect[];
}

/** One entry per Scene, invalidated by Scene.mutationCount, mirrors portGroupsCache above. */
const containerRectsCache = new WeakMap<Scene, ContainerRectsCacheEntry>();

/**
 * Every Box/Group/Zone in the scene, as a flat cached list, the candidate pool
 * containerAvoidanceRectsFor filters per connector. Frame is excluded: it's a presentation/
 * sectioning primitive (D25) that typically spans most of the canvas, so treating it as even a
 * soft obstacle would penalize nearly every connector for no benefit.
 */
function containerRectsFor(scene: Scene): ContainerRect[] {
  const cached = containerRectsCache.get(scene);
  if (cached && cached.mutationCount === scene.mutationCount)
    return cached.rects;

  const rects: ContainerRect[] = [];
  for (const el of scene.all()) {
    if (el.type === "box" || el.type === "group" || el.type === "zone") {
      rects.push({ id: el.id, rect: { x: el.x, y: el.y, w: el.w, h: el.h } });
    }
  }
  containerRectsCache.set(scene, { mutationCount: scene.mutationCount, rects });
  return rects;
}

/**
 * Containers a connector should prefer to route around, but may still cross if that's genuinely
 * the only reasonable option, distinct from obstaclesFor's hard, never-crossable leaf obstacles.
 * A container is exempt (never a soft obstacle) for a given connector if it's related to either
 * endpoint: the endpoint itself, an ancestor of the endpoint (the connector's own containing
 * box/zone, legitimately crossed per the M4 "connectors routinely cross a box/zone boundary"
 * decision), or a descendant of the endpoint (the endpoint is itself a container, and this
 * candidate lives inside it). Everything else is a soft obstacle: an unrelated sibling container
 * that neither endpoint has anything to do with, which is what actually produced the ugly
 * cross-diagram routes this was built to fix.
 *
 * The descendant case is deliberately checked as ancestorsOf(candidate).includes(endpoint)
 * rather than descendantsOf(endpoint).includes(candidate): Scene.descendantsOf calls scene.all()
 * (a full sort) on every BFS step, while Scene.ancestorsOf is a cheap O(depth) walk with no
 * scene.all() calls at all. Same order-of-magnitude cost class as the O(n^2) bug M22.5 introduced
 * and fixed in this same file, worth avoiding here from the start.
 */
export function containerAvoidanceRectsFor(
  scene: Scene,
  fromId: string,
  toId: string,
): Rect[] {
  const fromAncestors = new Set(scene.ancestorsOf(fromId).map((el) => el.id));
  const toAncestors = new Set(scene.ancestorsOf(toId).map((el) => el.id));

  const isRelated = (containerId: string): boolean => {
    if (containerId === fromId || containerId === toId) return true;
    if (fromAncestors.has(containerId) || toAncestors.has(containerId))
      return true;
    const candidateAncestors = scene.ancestorsOf(containerId);
    return candidateAncestors.some((a) => a.id === fromId || a.id === toId);
  };

  return containerRectsFor(scene)
    .filter((c) => !isRelated(c.id))
    .map((c) => c.rect);
}

interface LabelRectsCacheEntry {
  mutationCount: number;
  rects: Rect[];
}

/** One entry per Scene, invalidated by Scene.mutationCount, mirrors containerRectsCache above. */
const labelRectsCache = new WeakMap<Scene, LabelRectsCacheEntry>();

/**
 * Every Box/Group/Zone's own label footprint (containerLabelRect), as a soft obstacle every
 * connector should prefer to avoid — unlike containerAvoidanceRectsFor, applied with no
 * relatedness exemption at all: even a connector's own legitimately-entered ancestor container's
 * label is worth avoiding, since crossing literal text is a visual defect regardless of whether
 * the crossing itself is otherwise legitimate per M4. That also means this list doesn't depend on
 * which connector is asking, so (unlike containerAvoidanceRectsFor) it's the same for every
 * connector in the scene and cacheable without a per-connector key.
 *
 * Frame is excluded by construction (filtered out before containerLabelRect is ever called, same
 * as containerRectsFor above) - it titles itself via a separate `name` field through its own
 * render path, never `.label`, so it has no label footprint to protect even if a `.label` were
 * hand-set on one via raw .icad JSON.
 */
export function containerLabelRectsFor(scene: Scene): Rect[] {
  const cached = labelRectsCache.get(scene);
  if (cached && cached.mutationCount === scene.mutationCount)
    return cached.rects;

  const rects = containerRectsFor(scene)
    .map((c) => scene.get(c.id))
    .filter((el): el is NonNullable<typeof el> => el !== undefined)
    .map((el) => containerLabelRect(el))
    .filter((r): r is Rect => r !== undefined);

  labelRectsCache.set(scene, { mutationCount: scene.mutationCount, rects });
  return rects;
}

/** Matches svgRenderer.ts's renderConnector/annotationLabel/cardinalityLabel font-size (11px). */
const CONNECTOR_TEXT_FONT_SIZE_PX = 11;
/** Sequence badge circle radius — matches svgRenderer.ts's sequenceBadge (r=9). */
const SEQUENCE_BADGE_RADIUS_PX = 9;

/**
 * Approximate on-screen footprint of a piece of connector-adjacent text, anchor-centered
 * horizontally (every connector text helper in svgRenderer.ts uses text-anchor="middle") at `at`,
 * with its SVG baseline offset vertically from `at.y` by `baselineOffsetY` — mirroring each
 * helper's own y formula (renderConnector's label: -10, annotationLabel: +20, cardinalityLabel:
 * -4). Height approximates a real glyph's ascent+descent as a multiple of font-size, the same
 * "tunable by eye, not derived" precedent as containerLabel.ts's own heuristics; there being no
 * real font-metrics API anywhere in this package (textMetrics.ts's own module doc comment).
 */
function centeredTextRect(
  at: Point,
  text: string,
  baselineOffsetY: number,
): Rect {
  const w = measureText(text, CONNECTOR_TEXT_FONT_SIZE_PX);
  const h = CONNECTOR_TEXT_FONT_SIZE_PX * 1.2;
  return {
    x: at.x - w / 2,
    y: at.y + baselineOffsetY - CONNECTOR_TEXT_FONT_SIZE_PX,
    w,
    h,
  };
}

/**
 * Every OTHER connector's own rendered text (label / protocol annotation / cardinality / sequence
 * badge), as a soft obstacle a connector currently being routed should prefer to avoid — mirrors
 * containerLabelRectsFor's "avoid literal text, not just container padding" intent, but for text
 * that floats along a connector's own path rather than sitting beside a container's corner icon.
 *
 * Excludes `selfId`: a connector's own text sits at fractions along *its own* path
 * (connectorPathPoints), which doesn't exist yet while that very path is being decided by this
 * function's caller — a route can't be steered around a rect that's a function of the route itself.
 * Every OTHER connector's rect, by contrast, is derived from that connector's already-known current
 * path (its stored waypoints plus its live anchor points), so reading it here isn't circular. When
 * several connectors are (re-)routed in the same batch (e.g. routeTemplateConnectors,
 * scene_apply's batch authoring), routing order determines which connectors' text is already
 * visible to which later ones — accepted, the same order-dependence every other soft-obstacle list
 * in this router already carries (e.g. containerAvoidanceRectsFor's per-connector relatedness).
 */
export function connectorLabelRectsFor(scene: Scene, selfId: string): Rect[] {
  const rects: Rect[] = [];
  for (const el of scene.all()) {
    if (el.type !== "connector" || el.id === selfId) continue;
    const hasText =
      el.label?.text ||
      el.annotation ||
      el.cardinality?.from ||
      el.cardinality?.to ||
      el.sequence;
    if (!hasText) continue;

    const points = connectorPathPoints(scene, el);
    if (points.length < 2) continue;

    if (el.label?.text) {
      rects.push(
        centeredTextRect(pointAtFraction(points, 0.5), el.label.text, -10),
      );
    }
    if (el.annotation) {
      rects.push(
        centeredTextRect(
          pointAtFraction(points, 0.5),
          formatConnectorAnnotation(el.annotation),
          20,
        ),
      );
    }
    if (el.cardinality?.from) {
      rects.push(
        centeredTextRect(pointAtFraction(points, 0.1), el.cardinality.from, -4),
      );
    }
    if (el.cardinality?.to) {
      rects.push(
        centeredTextRect(pointAtFraction(points, 0.9), el.cardinality.to, -4),
      );
    }
    if (el.sequence) {
      const at = pointAtFraction(points, 0.5);
      rects.push({
        x: at.x - SEQUENCE_BADGE_RADIUS_PX,
        y: at.y - SEQUENCE_BADGE_RADIUS_PX,
        w: SEQUENCE_BADGE_RADIUS_PX * 2,
        h: SEQUENCE_BADGE_RADIUS_PX * 2,
      });
    }
  }
  return rects;
}

/**
 * Where a connector sharing its start/end port with sibling connectors falls in that port's
 * fan-out order — factored out of connectorAnchorPoint (below) so portStubStagger (further down)
 * can order its own, separate effect (staggered stub length) the same way, rather than the two
 * independently re-deriving what "sibling order" means and risking drifting apart. `index` is
 * 0-based, ordered the same way the other endpoints are actually laid out (top-to-bottom for an
 * e/w side, left-to-right for an n/s side) — a non-crossing fan, not an arbitrary id-order one.
 */
function siblingFanIndex(
  scene: Scene,
  elementId: string,
  side: PortSide,
  connectorId: string,
): { index: number; count: number } | undefined {
  if (side !== "n" && side !== "e" && side !== "s" && side !== "w")
    return undefined;
  const siblings = portGroupsFor(scene).get(portGroupKey(elementId, side));
  if (!siblings || siblings.length <= 1) return undefined;

  const spreadOnY = side === "e" || side === "w";
  const ordered = siblings
    .map((s) => {
      const other = scene.get(s.otherElementId);
      const pos = other
        ? spreadOnY
          ? other.y + other.h / 2
          : other.x + other.w / 2
        : 0;
      return { ...s, pos };
    })
    .sort((a, b) => a.pos - b.pos);

  const index = ordered.findIndex((s) => s.connectorId === connectorId);
  if (index === -1) return undefined;
  return { index, count: ordered.length };
}

/**
 * The point a connector's line actually draws from/to at one of its two ends — `portPoint`'s
 * exact port center, unless 2+ connectors in the scene share that same (element, side), in which
 * case each gets spread along the side instead of stacking on the same point. Real port side
 * selection (`pickPorts.ts`) only looks at one connector's own two endpoints, so a fan-out —
 * one element with several connectors that all happen to land on the same dominant-axis side, e.g.
 * a load balancer's east side to three app instances all roughly east of it — is entirely
 * plausible and, before this, rendered as visually indistinguishable overlapping lines.
 *
 * Distinct from `portPoint` (kept as the exact, canonical port location for hit-testing, the
 * hover-to-connect affordance, and anything reasoning about "which port is this") — this is only
 * for where a connector's own line/handle should visually draw.
 */
export function connectorAnchorPoint(
  scene: Scene,
  elementId: string,
  side: PortSide,
  connectorId: string,
): Point {
  const el = scene.get(elementId);
  if (!el) return { x: 0, y: 0 };
  const base = portPoint(el, side);
  if (side !== "n" && side !== "e" && side !== "s" && side !== "w") return base;

  const fan = siblingFanIndex(scene, elementId, side, connectorId);
  if (!fan) return base;

  const spreadOnY = side === "e" || side === "w";
  const fraction = (fan.index + 1) / (fan.count + 1);
  const ratioSpan = (spreadOnY ? el.h : el.w) * PORT_FAN_SPAN_RATIO;
  const minSpan = MIN_PORT_SEPARATION_PX * (fan.count + 1);
  const span = Math.max(ratioSpan, minSpan);
  const delta = (fraction - 0.5) * span;
  return spreadOnY
    ? { x: base.x, y: base.y + delta }
    : { x: base.x + delta, y: base.y };
}

/**
 * Extra px added atop the router's own base stub length (orthogonalRouter.ts's STUB) for a
 * connector sharing its port with siblings — each sibling's first allowed bend point staggers by
 * one step, so connectors fanning out of (or into) the same side don't all bend at the identical
 * x/y and produce an uneven or overlapping shared trunk before diverging toward their own distinct
 * targets (M27.5 - "parallel connectors should stay evenly spaced"). Ordered via the same
 * siblingFanIndex connectorAnchorPoint itself uses, so the two effects compose into one consistent
 * cascade instead of fighting each other (e.g. the topmost sibling both exits highest *and* bends
 * soonest).
 */
const STUB_STAGGER_PX = 14;

function portStubStagger(
  scene: Scene,
  elementId: string,
  side: PortSide,
  connectorId: string,
): number {
  const fan = siblingFanIndex(scene, elementId, side, connectorId);
  return fan ? fan.index * STUB_STAGGER_PX : 0;
}

/**
 * Obstacles the router avoids: leaf shapes only. Containers (box/group/zone/
 * frame) are excluded deliberately — IBM deployment diagrams routinely draw
 * a connector crossing a box or zone boundary, so treating those as
 * obstacles would make most real diagrams unroutable cleanly.
 *
 * Uses rotatedBounds rather than the element's raw x/y/w/h: a rotated element's stored box
 * describes its *unrotated* footprint (rotation is applied about that box's own center, see
 * scene/bounds.ts's rotatedCorners), so for anything with a non-zero rotation — most commonly a
 * standalone Text element rotated to run vertically alongside a boundary — the raw box can miss
 * where the shape actually paints entirely. This was the direct cause of a connector visibly
 * painting straight through a rotated text label's real footprint despite an obstacle "covering"
 * its unrotated one.
 */
function obstaclesFor(scene: Scene, excludeIds: Set<string>): Rect[] {
  return scene
    .all()
    .filter(
      (el) =>
        (el.type === "iconNode" || el.type === "actor" || el.type === "text") &&
        !excludeIds.has(el.id),
    )
    .map((el) => rotatedBounds(el));
}

/**
 * Computes an obstacle-avoiding orthogonal route between a connector's two
 * ports and returns it as inner waypoints (endpoints are re-derived from the
 * live port positions at render time, so they aren't included here).
 */
export function routeConnectorInScene(
  scene: Scene,
  connector: ConnectorElement,
): Point[] {
  const fromEl = scene.get(connector.from.elementId);
  const toEl = scene.get(connector.to.elementId);
  if (!fromEl || !toEl) return connector.waypoints ?? [];

  const obstacles = obstaclesFor(scene, new Set([fromEl.id, toEl.id]));
  const softObstacles: SoftObstacle[] = [
    ...containerAvoidanceRectsFor(scene, fromEl.id, toEl.id).map((rect) => ({
      rect,
      penalty: CONTAINER_SOFT_OBSTACLE_PENALTY,
    })),
    ...containerLabelRectsFor(scene).map((rect) => ({
      rect,
      penalty: LABEL_SOFT_OBSTACLE_PENALTY,
    })),
    ...connectorLabelRectsFor(scene, connector.id).map((rect) => ({
      rect,
      penalty: CONNECTOR_LABEL_SOFT_OBSTACLE_PENALTY,
    })),
  ];
  const containers = containerRectsFor(scene)
    .filter((c) => c.id !== fromEl.id && c.id !== toEl.id)
    .map((c) => c.rect);
  const path = routeOrthogonal(
    {
      point: connectorAnchorPoint(
        scene,
        fromEl.id,
        connector.from.port,
        connector.id,
      ),
      side: connector.from.port,
      stubExtraPx: portStubStagger(
        scene,
        fromEl.id,
        connector.from.port,
        connector.id,
      ),
    },
    {
      point: connectorAnchorPoint(
        scene,
        toEl.id,
        connector.to.port,
        connector.id,
      ),
      side: connector.to.port,
      stubExtraPx: portStubStagger(
        scene,
        toEl.id,
        connector.to.port,
        connector.id,
      ),
    },
    obstacles,
    softObstacles,
    containers,
  );
  return path.slice(1, -1);
}

/** Full rendered path (endpoints + waypoints) used by both the renderer and the linter. */
export function connectorPathPoints(
  scene: Scene,
  connector: ConnectorElement,
): Point[] {
  const fromEl = scene.get(connector.from.elementId);
  const toEl = scene.get(connector.to.elementId);
  const start = fromEl
    ? connectorAnchorPoint(scene, fromEl.id, connector.from.port, connector.id)
    : { x: connector.x, y: connector.y };
  const end = toEl
    ? connectorAnchorPoint(scene, toEl.id, connector.to.port, connector.id)
    : { x: connector.x + connector.w, y: connector.y + connector.h };
  return [start, ...(connector.waypoints ?? []), end];
}

export { obstaclesFor };
