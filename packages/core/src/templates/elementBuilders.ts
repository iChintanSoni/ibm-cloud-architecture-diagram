import type {
  ActorElement,
  ConnectorElement,
  FrameElement,
  IconNodeElement,
} from "../scene/types.js";

/** Small element-builder helpers shared by every template (docs/09-roadmap.md#m73). */

export function frame(
  id: string,
  name: string,
  w: number,
  h: number,
): FrameElement {
  return {
    id,
    type: "frame",
    semantic: "boundary",
    name,
    order: 1,
    x: 20,
    y: 20,
    w,
    h,
    z: -100,
  };
}

export function actor(
  id: string,
  label: string,
  x: number,
  y: number,
  parentId: string,
  catalogRef = "ibm-cloud/user",
): ActorElement {
  return {
    id,
    type: "actor",
    semantic: "actor",
    catalogRef,
    label: { text: label },
    x,
    y,
    w: 48,
    h: 48,
    parentId,
  };
}

export function icon(
  id: string,
  catalogRef: string,
  label: string,
  x: number,
  y: number,
  parentId: string,
): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef,
    label: { text: label },
    x,
    y,
    w: 48,
    h: 48,
    parentId,
  };
}

export function connector(
  id: string,
  from: string,
  to: string,
  flowColor: "public" | "private" = "private",
): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    from: { elementId: from, port: "e" },
    to: { elementId: to, port: "w" },
    connectorType: "connection",
    direction: "unidirectional",
    flowColor,
    routing: "auto",
  };
}
