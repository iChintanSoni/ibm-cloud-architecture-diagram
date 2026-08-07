import { ICAD_FORMAT, ICAD_VERSION, type IcadDocument } from "../io/icad.js";
import { routeConnectorInScene } from "../routing/routeConnector.js";
import { Scene } from "../scene/scene.js";
import type {
  CanvasSettings,
  CatalogRefPin,
  DocumentMeta,
  SceneElement,
} from "../scene/types.js";
import { actor, connector, frame, icon } from "./elementBuilders.js";
import {
  REFERENCE_ARCHITECTURE_TEMPLATES,
  referenceArchitectureElementsFor,
  type ReferenceArchitectureTemplateId,
} from "./referenceArchitectures.js";

export type { ReferenceArchitectureTemplateId } from "./referenceArchitectures.js";

/**
 * Distinct from `DocumentMeta["diagramLevel"]`: the 4 reference-architecture ids are all
 * "detailed/deployment"-level worked examples (see TEMPLATE_DIAGRAM_LEVEL below), not a 5th
 * diagram level of their own (docs/roadmap.md#m26--reference-architecture-templates).
 */
export type DiagramTemplateId =
  DocumentMeta["diagramLevel"] | ReferenceArchitectureTemplateId;

export interface DiagramTemplate {
  id: DiagramTemplateId;
  name: string;
  description: string;
}

/** Every template id maps to the diagram level whose linter rule set it should run under. */
const TEMPLATE_DIAGRAM_LEVEL: Record<
  DiagramTemplateId,
  DocumentMeta["diagramLevel"]
> = {
  blank: "blank",
  "system-context": "system-context",
  "high-level": "high-level",
  detailed: "detailed",
  "iks-sr-mz-classic": "detailed",
  "iks-sr-mz-vpc": "detailed",
  "roks-sr-mz-classic": "detailed",
  "roks-sr-mz-vpc": "detailed",
};

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "An empty canvas with the IBM Cloud library ready.",
  },
  {
    id: "system-context",
    name: "System context",
    description: "Actors, external systems, and a solution boundary.",
  },
  {
    id: "high-level",
    name: "High-level / logical",
    description: "Key IBM Cloud services and their main west-to-east flows.",
  },
  {
    id: "detailed",
    name: "Detailed / deployment",
    description: "Region, VPC, subnet, security-group, and workload structure.",
  },
] as const;

export interface CreateTemplateDocumentOptions {
  catalog: CatalogRefPin;
  theme?: CanvasSettings["theme"];
  /** Injectable for deterministic tests and non-browser authoring surfaces. */
  now?: string;
  /**
   * Seed the document with the level's worked example content (frame, boxes, icons, connectors).
   * Default true, matching the human editor's "New Diagram" dialog, where example content is the
   * point. Pass false for an empty canvas that still carries the level's `diagramLevel` meta — and
   * so still runs that level's full linter rule set (e.g. `nodeWithoutLocationRule`, which only
   * applies to high-level/detailed) — instead of `"blank"`'s empty canvas, which is exempt from
   * those rules entirely. Intended for agent-driven authoring (packages/mcp's `doc_create`), where
   * the seed content would otherwise just collide with whatever gets built next.
   */
  seedExampleContent?: boolean;
}

const TEMPLATE_TITLES: Record<DiagramTemplateId, string> = {
  blank: "Untitled diagram",
  "system-context": "System context",
  "high-level": "High-level architecture",
  detailed: "Detailed deployment",
  "iks-sr-mz-classic": "IKS, Single Region Multi-Zone (Classic)",
  "iks-sr-mz-vpc": "IKS, Single Region Multi-Zone (VPC)",
  "roks-sr-mz-classic": "ROKS, Single Region Multi-Zone (Classic)",
  "roks-sr-mz-vpc": "ROKS, Single Region Multi-Zone (VPC)",
};

function systemContextElements(): SceneElement[] {
  const frameId = "system-context-frame";
  const solutionId = "system-context-solution";
  const cloudId = "system-context-cloud";
  const applicationId = "system-context-application";
  return [
    frame(frameId, "System context", 960, 560),
    actor("system-context-customer", "Customer", 70, 190, frameId),
    actor(
      "system-context-external",
      "External system",
      70,
      330,
      frameId,
      "ibm-cloud/user-collaborate",
    ),
    {
      id: solutionId,
      type: "box",
      semantic: "deployedOn",
      style: { stroke: "#878d96" },
      label: { text: "Solution boundary" },
      x: 240,
      y: 80,
      w: 650,
      h: 400,
      parentId: frameId,
      z: -20,
    },
    {
      id: cloudId,
      type: "box",
      semantic: "deployedOn",
      catalogRef: "ibm-cloud/cloud-service-management",
      label: { text: "IBM Cloud" },
      x: 290,
      y: 130,
      w: 550,
      h: 300,
      parentId: solutionId,
      z: -10,
    },
    icon(
      applicationId,
      "ibm-cloud/virtual-application",
      "Application",
      520,
      250,
      cloudId,
    ),
    connector(
      "system-context-customer-flow",
      "system-context-customer",
      applicationId,
      "public",
    ),
    connector(
      "system-context-external-flow",
      "system-context-external",
      applicationId,
      "public",
    ),
  ];
}

function highLevelElements(): SceneElement[] {
  const frameId = "high-level-frame";
  const cloudId = "high-level-cloud";
  const vpcId = "high-level-vpc";
  const workloadId = "high-level-workload";
  return [
    frame(frameId, "High-level architecture", 1040, 600),
    actor("high-level-customer", "Customer", 55, 275, frameId),
    {
      id: cloudId,
      type: "box",
      semantic: "deployedOn",
      // Network blue per docs/04's confirmed "IBM Cloud | Box ✓ | Network (blue)" preset row.
      style: { stroke: "#1192e8" },
      catalogRef: "ibm-cloud/ibm-cloud",
      label: { text: "IBM Cloud" },
      x: 170,
      y: 70,
      w: 820,
      h: 470,
      parentId: frameId,
      z: -30,
    },
    {
      id: vpcId,
      type: "box",
      semantic: "deployedOn",
      style: { stroke: "#1192e8" },
      catalogRef: "ibm-cloud/vpc",
      label: { text: "VPC" },
      x: 220,
      y: 120,
      w: 720,
      h: 360,
      parentId: cloudId,
      z: -20,
    },
    {
      id: workloadId,
      type: "group",
      semantic: "deployedTo",
      label: { text: "Application tier" },
      x: 300,
      y: 180,
      w: 390,
      h: 230,
      parentId: vpcId,
      z: -10,
    },
    icon(
      "high-level-gateway",
      "ibm-cloud/gateway-api",
      "API Gateway",
      340,
      270,
      workloadId,
    ),
    icon(
      "high-level-app",
      "ibm-cloud/instance-bx",
      "Application",
      565,
      270,
      workloadId,
    ),
    icon(
      "high-level-storage",
      "ibm-cloud/object-storage-application",
      "Object storage",
      800,
      270,
      vpcId,
    ),
    connector(
      "high-level-public-flow",
      "high-level-customer",
      "high-level-gateway",
      "public",
    ),
    connector("high-level-app-flow", "high-level-gateway", "high-level-app"),
    connector(
      "high-level-storage-flow",
      "high-level-app",
      "high-level-storage",
    ),
  ];
}

function detailedElements(): SceneElement[] {
  const frameId = "detailed-frame";
  const regionId = "detailed-region";
  const vpcId = "detailed-vpc";
  const publicSubnetId = "detailed-public-subnet";
  const privateSubnetId = "detailed-private-subnet";
  const securityGroupId = "detailed-security-group";
  return [
    frame(frameId, "Detailed deployment", 1120, 640),
    actor("detailed-customer", "Customer", 45, 305, frameId),
    {
      id: regionId,
      type: "box",
      semantic: "deployedOn",
      // Cool Gray per docs/04's confirmed "Region | Box ✓ | Generic (gray)" preset row (D24).
      style: { stroke: "#878d96" },
      catalogRef: "ibm-cloud/location",
      label: { text: "IBM Cloud region" },
      x: 150,
      y: 60,
      w: 920,
      h: 520,
      parentId: frameId,
      z: -40,
    },
    {
      id: vpcId,
      type: "box",
      semantic: "deployedOn",
      style: { stroke: "#1192e8" },
      catalogRef: "ibm-cloud/vpc",
      label: { text: "VPC" },
      x: 190,
      y: 100,
      w: 840,
      h: 440,
      parentId: regionId,
      z: -30,
    },
    {
      id: publicSubnetId,
      type: "box",
      semantic: "deployedOn",
      style: { stroke: "#1192e8" },
      catalogRef: "ibm-cloud/subnet",
      label: { text: "Public subnet" },
      x: 230,
      y: 150,
      w: 220,
      h: 330,
      parentId: vpcId,
      z: -20,
    },
    {
      id: privateSubnetId,
      type: "box",
      semantic: "deployedOn",
      style: { stroke: "#1192e8" },
      catalogRef: "ibm-cloud/subnet",
      label: { text: "Private subnet" },
      x: 490,
      y: 150,
      w: 500,
      h: 330,
      parentId: vpcId,
      z: -20,
    },
    {
      id: securityGroupId,
      type: "group",
      semantic: "deployedTo",
      label: { text: "Security group" },
      x: 530,
      y: 190,
      w: 240,
      h: 240,
      parentId: privateSubnetId,
      z: -10,
    },
    icon(
      "detailed-gateway",
      "ibm-cloud/gateway-api",
      "Public gateway",
      315,
      285,
      publicSubnetId,
    ),
    icon(
      "detailed-app",
      "ibm-cloud/instance-bx",
      "Application server",
      575,
      245,
      securityGroupId,
    ),
    icon(
      "detailed-worker",
      "ibm-cloud/instance-bx",
      "Worker",
      675,
      345,
      securityGroupId,
    ),
    icon(
      "detailed-storage",
      "ibm-cloud/object-storage-application",
      "Object storage",
      865,
      285,
      privateSubnetId,
    ),
    connector(
      "detailed-public-flow",
      "detailed-customer",
      "detailed-gateway",
      "public",
    ),
    connector("detailed-app-flow", "detailed-gateway", "detailed-app"),
    connector("detailed-worker-flow", "detailed-app", "detailed-worker"),
    connector("detailed-storage-flow", "detailed-worker", "detailed-storage"),
  ];
}

function isReferenceArchitectureTemplateId(
  templateId: DiagramTemplateId,
): templateId is ReferenceArchitectureTemplateId {
  return REFERENCE_ARCHITECTURE_TEMPLATES.some(
    (template) => template.id === templateId,
  );
}

function elementsFor(templateId: DiagramTemplateId): SceneElement[] {
  if (isReferenceArchitectureTemplateId(templateId)) {
    return referenceArchitectureElementsFor(templateId);
  }
  switch (templateId) {
    case "blank":
      return [];
    case "system-context":
      return systemContextElements();
    case "high-level":
      return highLevelElements();
    case "detailed":
      return detailedElements();
  }
}

function routeTemplateConnectors(elements: SceneElement[]): SceneElement[] {
  const scene = new Scene();
  scene._replaceAll(elements);
  return scene
    .all()
    .map((element) =>
      element.type === "connector"
        ? { ...element, waypoints: routeConnectorInScene(scene, element) }
        : element,
    );
}

/** Builds a complete, portable .icad document for any supported IBM diagram level. */
export function createTemplateDocument(
  templateId: DiagramTemplateId,
  options: CreateTemplateDocumentOptions,
): IcadDocument {
  const descriptor = [
    ...DIAGRAM_TEMPLATES,
    ...REFERENCE_ARCHITECTURE_TEMPLATES,
  ].find((template) => template.id === templateId);
  if (!descriptor) throw new Error(`Unknown diagram template: "${templateId}"`);
  const now = options.now ?? new Date().toISOString();
  return {
    format: ICAD_FORMAT,
    version: ICAD_VERSION,
    catalog: { ...options.catalog },
    meta: {
      title: TEMPLATE_TITLES[templateId],
      diagramLevel: TEMPLATE_DIAGRAM_LEVEL[templateId],
      createdAt: now,
      updatedAt: now,
    },
    canvas: {
      theme: options.theme ?? "auto",
      grid: 8,
      background: "transparent",
    },
    conformance: {
      exportGate: "warn",
      ruleSeverities: {},
    },
    elements:
      options.seedExampleContent === false
        ? []
        : routeTemplateConnectors(elementsFor(templateId)),
  };
}
