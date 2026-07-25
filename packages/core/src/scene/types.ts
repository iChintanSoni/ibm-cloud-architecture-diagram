/**
 * Scene data model — mirrors the .icad element schema documented in
 * docs/03-file-format.md. Every element carries an IBM `semantic` in
 * addition to its geometry, per docs/05-ibm-spec-conformance.md.
 */

export type ElementId = string;

export type Semantic = "deployedOn" | "deployedTo" | "node" | "actor" | "boundary";

export interface Style {
  stroke?: string;
  fill?: string;
  dashed?: boolean;
  strokeWidth?: number;
  colorToken?: string;
}

export interface Label {
  text: string;
  position?: "n" | "s" | "e" | "w" | "center";
}

export type PortSide = "n" | "e" | "s" | "w" | "center";

export interface PortRef {
  elementId: ElementId;
  port: PortSide;
}

/**
 * Physical/protocol connections and messages between elements
 * (docs/05-ibm-spec-conformance.md#connector-nomenclature).
 */
export type ConnectionType =
  | "logical-connection"
  | "connection"
  | "physical-connection"
  | "tunneling-connection"
  | "traffic-through-double-tunnel";

/** Logical relationships between elements, not network traffic. */
export type RelationshipType =
  | "dependency"
  | "association"
  | "aggregation"
  | "composition"
  | "implementation"
  | "extends";

export type ConnectorType = ConnectionType | RelationshipType;

/** Connection types render one arrowhead (unidirectional) or two (bidirectional). */
export type ConnectorDirection = "unidirectional" | "bidirectional";

/** Independent of connectorType: green = private connection, blue = public. */
export type FlowColor = "private" | "public";

/**
 * "auto" connectors are recomputed by the orthogonal router whenever an
 * endpoint moves or resizes; "manual" connectors keep whatever waypoints
 * were last set and are never touched by the router.
 */
export type RoutingMode = "auto" | "manual";

export interface EndpointLabels {
  from?: string;
  to?: string;
}

interface BaseElement {
  id: ElementId;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  parentId?: ElementId;
  label?: Label;
  style?: Style;
  z?: number;
}

export interface IconNodeElement extends BaseElement {
  type: "iconNode";
  semantic: "node";
  catalogRef: string;
}

export interface BoxElement extends BaseElement {
  type: "box";
  semantic: "deployedOn";
  /** Optional IBM glyph rendered in the container's top-left corner. */
  catalogRef?: string;
}

export interface GroupElement extends BaseElement {
  type: "group";
  semantic: "deployedTo";
  /** Optional IBM glyph rendered in the container's top-left corner. */
  catalogRef?: string;
}

/**
 * D24 (docs/00-decision-log.md): only availability-zone/on-prem geographic boundaries render
 * as the dotted Boundary primitive. Region, VPC, and Subnet are Box (`deployedOn`, solid,
 * sidebar tab) — see BoxElement / templates.ts.
 */
export type ZoneKind = "az" | "on-prem";

export interface ZoneElement extends BaseElement {
  type: "zone";
  semantic: "boundary";
  zoneKind: ZoneKind;
  /** Optional IBM glyph rendered in the container's top-left corner. */
  catalogRef?: string;
}

export interface ActorElement extends BaseElement {
  type: "actor";
  semantic: "actor";
  catalogRef?: string;
}

export interface ConnectorElement extends BaseElement {
  type: "connector";
  semantic: "node";
  from: PortRef;
  to: PortRef;
  connectorType: ConnectorType;
  /** Defaults to "unidirectional"; only meaningful for ConnectionType connectors. */
  direction?: ConnectorDirection;
  /** Only meaningful for ConnectionType connectors. */
  flowColor?: FlowColor;
  /** "0..N"-style cardinality labels; only meaningful for RelationshipType connectors. */
  cardinality?: EndpointLabels;
  waypoints?: Array<{ x: number; y: number }>;
  /** Defaults to "auto". See RoutingMode. */
  routing?: RoutingMode;
}

export interface TextElement extends BaseElement {
  type: "text";
  semantic: "node";
  text: string;
}

export interface FrameElement extends BaseElement {
  type: "frame";
  semantic: "boundary";
  name: string;
  order: number;
}

export type SceneElement =
  | IconNodeElement
  | BoxElement
  | GroupElement
  | ZoneElement
  | ActorElement
  | ConnectorElement
  | TextElement
  | FrameElement;

export type ContainerElement = BoxElement | GroupElement | ZoneElement | FrameElement;

export function isContainer(el: SceneElement): el is ContainerElement {
  return el.type === "box" || el.type === "group" || el.type === "zone" || el.type === "frame";
}

export interface DocumentMeta {
  title: string;
  diagramLevel: "system-context" | "high-level" | "detailed" | "blank";
  createdAt: string;
  updatedAt: string;
  author?: string;
}

export interface CanvasSettings {
  theme: "auto" | "light" | "dark";
  grid: number;
  background: "transparent" | "white";
}

export interface CatalogRefPin {
  id: string;
  version: string;
}

export type ConformanceSeverity = "error" | "warn" | "info" | "off";
export type ExportGate = "warn" | "block";

/**
 * Per-document linter configuration. Empty ruleSeverities means the IBM
 * recommended defaults declared by each rule.
 */
export interface ConformanceSettings {
  exportGate: ExportGate;
  ruleSeverities: Record<string, ConformanceSeverity>;
}
