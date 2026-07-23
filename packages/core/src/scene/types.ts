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

export type ConnectorType =
  | "association"
  | "flow"
  | "dependency"
  | "actor-to-node";

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
}

export interface GroupElement extends BaseElement {
  type: "group";
  semantic: "deployedTo";
}

export type ZoneKind = "region" | "az" | "vpc" | "subnet" | "on-prem";

export interface ZoneElement extends BaseElement {
  type: "zone";
  semantic: "boundary";
  zoneKind: ZoneKind;
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
  waypoints?: Array<{ x: number; y: number }>;
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
