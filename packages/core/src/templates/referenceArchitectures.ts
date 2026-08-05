import type {
  BoxElement,
  GroupElement,
  SceneElement,
  TextElement,
  ZoneElement,
} from "../scene/types.js";
import { actor, connector, icon } from "./elementBuilders.js";
import type { DiagramTemplate } from "./templates.js";

/**
 * IBM reference-architecture template ids (docs/09-roadmap.md#m26--reference-architecture-templates).
 * Distinct from `DocumentMeta["diagramLevel"]`: these are all "detailed/deployment"-level worked
 * examples, not a 5th diagram level of their own — see `TEMPLATE_DIAGRAM_LEVEL` in templates.ts.
 */
export type ReferenceArchitectureTemplateId =
  | "iks-sr-mz-classic"
  | "iks-sr-mz-vpc"
  | "roks-sr-mz-classic"
  | "roks-sr-mz-vpc";

export const REFERENCE_ARCHITECTURE_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: "iks-sr-mz-classic",
    name: "IKS, Single Region Multi-Zone (Classic)",
    description:
      "IBM Kubernetes Service spread across 3 availability zones on Classic infrastructure.",
  },
  {
    id: "iks-sr-mz-vpc",
    name: "IKS, Single Region Multi-Zone (VPC)",
    description:
      "IBM Kubernetes Service spread across 3 availability zones on VPC infrastructure.",
  },
  {
    id: "roks-sr-mz-classic",
    name: "ROKS, Single Region Multi-Zone (Classic)",
    description:
      "Red Hat OpenShift on IBM Cloud spread across 3 availability zones on Classic infrastructure.",
  },
  {
    id: "roks-sr-mz-vpc",
    name: "ROKS, Single Region Multi-Zone (VPC)",
    description:
      "Red Hat OpenShift on IBM Cloud spread across 3 availability zones on VPC infrastructure.",
  },
] as const;

/** IBM Compute category primary/secondary pair (docs/00-decision-log.md#d30) — used for the
 * translucent "Master" band so it stays on-palette (no off-palette-color lint diagnostic). */
const MASTER_BAND_STROKE = "#198038";
const MASTER_BAND_FILL = "#defbe6";

interface SrMzOptions {
  distribution: "iks" | "roks";
  infrastructure: "classic" | "vpc";
}

function box(
  id: string,
  catalogRef: string | undefined,
  label: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId: string,
  stroke: string,
  z: number,
  fill?: string,
): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    ...(catalogRef !== undefined && { catalogRef }),
    ...(label !== undefined && { label: { text: label } }),
    style: { stroke, ...(fill !== undefined && { fill }) },
    x,
    y,
    w,
    h,
    parentId,
    z,
  };
}

function zone(
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId: string,
  z: number,
): ZoneElement {
  return {
    id,
    type: "zone",
    semantic: "boundary",
    zoneKind: "az",
    label: { text: label },
    x,
    y,
    w,
    h,
    parentId,
    z,
  };
}

function clusterGroup(
  id: string,
  catalogRef: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId: string,
  z: number,
): GroupElement {
  return {
    id,
    type: "group",
    semantic: "deployedTo",
    catalogRef,
    style: { stroke: MASTER_BAND_STROKE },
    label: { text: label },
    x,
    y,
    w,
    h,
    parentId,
    z,
  };
}

/**
 * All four IBM "Single Region, Multi-Zone" reference diagrams
 * (IBM-Cloud/architecture-icons `drawio/templates/2.0/{iks,roks}_sr_mz_{classic,vpc}.drawio`)
 * share one skeleton — see docs/00-decision-log.md#d30 for the full source→catalog icon mapping
 * this was built from. `distribution` swaps the cluster icon/label (Kubernetes vs. OpenShift);
 * `infrastructure` adds the "IBM VPC" wrapping box and swaps load-balancer icons/labels.
 */
function srMzClusterElements(options: SrMzOptions): SceneElement[] {
  const { distribution, infrastructure } = options;
  const prefix = `${distribution}-sr-mz-${infrastructure}`;
  const isVpc = infrastructure === "vpc";
  const isRoks = distribution === "roks";

  const frameId = `${prefix}-frame`;
  const publicNetworkId = `${prefix}-public-network`;
  const ibmCloudId = `${prefix}-ibm-cloud`;
  const regionId = `${prefix}-region`;
  const vpcId = `${prefix}-vpc`;
  const clusterId = `${prefix}-cluster`;
  const masterId = `${prefix}-master`;
  const masterLabelId = `${prefix}-master-label`;

  // Layout computed bottom-up: each container's size is its content's size plus a fixed padding,
  // so nesting never collapses to zero inset (see docs/00-decision-log.md#d30). One shared
  // zone/subnet size for all 3 zones, stacked vertically. Workers stack vertically within a
  // subnet (rather than side-by-side, as IBM's source draws them) so a straight Load-Balancer to
  // -Worker connector never has to cross the *other* worker's icon — the auto-router's obstacle
  // avoidance doesn't guarantee a detour for that case, and stacking sidesteps it entirely instead
  // of fighting the router.
  const PAD = 20;
  const HEADER = 32;
  const ICON = 48;

  const SUBNET_CONTENT_W = 24 + ICON + 50 + ICON + 24; // pad, LB, gap, worker, pad
  const SUBNET_CONTENT_H = 12 + ICON + 20 + ICON + 12; // pad, worker, gap, worker, pad
  const SUBNET_W = SUBNET_CONTENT_W;
  const SUBNET_H = SUBNET_CONTENT_H;

  // Wide enough that the Master band (below) can sit clear of every zone's own "Zone N" label
  // (containerLabelRect estimates ~66px from a zone's left edge for that text) with room to spare
  // before the subnet starts.
  const MASTER_GUTTER_W = 130;
  const ZONE_W = MASTER_GUTTER_W + 10 + SUBNET_W + PAD;
  const ZONE_H = HEADER + SUBNET_H + PAD;
  const ZONE_GAP = 20;

  const CLUSTER_HEADER = 44;
  const clusterW = ZONE_W + PAD * 2;
  const clusterH = CLUSTER_HEADER + ZONE_H * 3 + ZONE_GAP * 2 + PAD;

  const VPC_PAD = 40;
  const vpcW = clusterW + VPC_PAD * 2;
  const vpcH = clusterH + VPC_PAD * 2;

  const REGION_PAD = 40;
  const regionInnerW = isVpc ? vpcW : clusterW;
  const regionInnerH = isVpc ? vpcH : clusterH;
  const regionW = regionInnerW + REGION_PAD * 2;
  const regionH = regionInnerH + REGION_PAD * 2;

  const IBM_CLOUD_PAD = 40;
  const LB_TO_REGION_GAP = 60;
  const regionOffsetX = IBM_CLOUD_PAD + ICON + LB_TO_REGION_GAP;
  const ibmCloudW = regionOffsetX + regionW + IBM_CLOUD_PAD;
  const ibmCloudH = regionH + IBM_CLOUD_PAD * 2;

  const PUBLIC_NETWORK_X = 140;
  const PUBLIC_NETWORK_W = 140;
  const frameW = PUBLIC_NETWORK_X + PUBLIC_NETWORK_W + 40 + ibmCloudW + 20;
  const frameH = ibmCloudH + 80;

  // Absolute canvas coordinates.
  const ibmCloudX = PUBLIC_NETWORK_X + PUBLIC_NETWORK_W + 40;
  const ibmCloudY = 40;
  const multiZoneLbX = ibmCloudX + IBM_CLOUD_PAD;
  const regionX = ibmCloudX + regionOffsetX;
  const regionY = ibmCloudY + IBM_CLOUD_PAD;
  const vpcX = regionX + REGION_PAD;
  const vpcY = regionY + REGION_PAD;
  const clusterX = (isVpc ? vpcX : regionX) + (isVpc ? VPC_PAD : REGION_PAD);
  const clusterY = (isVpc ? vpcY : regionY) + (isVpc ? VPC_PAD : REGION_PAD);
  const zoneX = clusterX + PAD;
  const zone1Y = clusterY + CLUSTER_HEADER;
  const subnetX = zoneX + MASTER_GUTTER_W + 10;

  const elements: SceneElement[] = [];

  elements.push({
    id: frameId,
    type: "frame",
    semantic: "boundary",
    name: `${isRoks ? "ROKS" : "IKS"}, Single Region Multi-Zone (${isVpc ? "VPC" : "Classic"})`,
    order: 1,
    x: 20,
    y: 20,
    w: frameW,
    h: frameH,
    z: -100,
  });

  const clientId = `${prefix}-client`;
  elements.push(
    actor(clientId, "Client", 40, ibmCloudY + ibmCloudH / 2 - 24, frameId),
  );

  elements.push(
    box(
      publicNetworkId,
      "ibm-cloud/public-network",
      "Public Network",
      PUBLIC_NETWORK_X,
      40,
      PUBLIC_NETWORK_W,
      frameH - 80,
      frameId,
      "#1192e8",
      -90,
    ),
  );

  elements.push(
    box(
      ibmCloudId,
      "ibm-cloud/ibm-cloud",
      "IBM Cloud",
      ibmCloudX,
      ibmCloudY,
      ibmCloudW,
      ibmCloudH,
      frameId,
      "#1192e8",
      -80,
    ),
  );

  const multiZoneLbId = `${prefix}-multi-zone-lb`;
  const multiZoneLbCatalogRef = isVpc
    ? "ibm-cloud/load-balancer-vpc"
    : "ibm-cloud/global-load-balancer";
  elements.push(
    icon(
      multiZoneLbId,
      multiZoneLbCatalogRef,
      isVpc ? "VPC Multi-zone LB" : "Multi-zone LB",
      multiZoneLbX,
      ibmCloudY + ibmCloudH / 2 - 24,
      ibmCloudId,
    ),
  );

  elements.push(
    box(
      regionId,
      "ibm-cloud/location",
      "Region",
      regionX,
      regionY,
      regionW,
      regionH,
      ibmCloudId,
      "#878d96",
      -70,
    ),
  );

  const clusterParentId = isVpc ? vpcId : regionId;
  if (isVpc) {
    elements.push(
      box(
        vpcId,
        "ibm-cloud/ibm-cloud-vpc",
        "IBM VPC",
        vpcX,
        vpcY,
        vpcW,
        vpcH,
        regionId,
        "#1192e8",
        -60,
      ),
    );
  }

  elements.push(
    clusterGroup(
      clusterId,
      isRoks ? "ibm-cloud/open-shift" : "ibm-cloud/kubernetes",
      isRoks ? "OpenShift" : "Kubernetes",
      clusterX,
      clusterY,
      clusterW,
      clusterH,
      clusterParentId,
      -50,
    ),
  );

  const loadBalancerCatalogRef = isVpc
    ? "ibm-cloud/load-balancer-application"
    : "ibm-cloud/local-load-balancer";
  const loadBalancerLabel = isVpc ? "ALB" : "Load Balancer";

  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    const zoneId = `${prefix}-zone-${n}`;
    const subnetId = `${prefix}-subnet-${n}`;
    const lbId = `${prefix}-lb-${n}`;
    const worker1Id = `${prefix}-worker-${n}-1`;
    const worker2Id = `${prefix}-worker-${n}-2`;
    const zoneY = zone1Y + i * (ZONE_H + ZONE_GAP);
    const subnetY = zoneY + HEADER;
    const subnetCenterY = subnetY + SUBNET_H / 2;

    elements.push(
      zone(zoneId, `Zone ${n}`, zoneX, zoneY, ZONE_W, ZONE_H, clusterId, -40),
    );
    elements.push(
      box(
        subnetId,
        "ibm-cloud/subnet-acl-rules",
        `Subnet ${n}`,
        subnetX,
        subnetY,
        SUBNET_W,
        SUBNET_H,
        zoneId,
        "#1192e8",
        -30,
      ),
    );
    elements.push(
      icon(
        lbId,
        loadBalancerCatalogRef,
        loadBalancerLabel,
        subnetX + 24,
        subnetCenterY - ICON / 2,
        subnetId,
      ),
    );
    elements.push(
      icon(
        worker1Id,
        "ibm-cloud/virtual-server-classic",
        "Worker Node 1",
        subnetX + 24 + ICON + 50,
        subnetY + 12,
        subnetId,
      ),
    );
    elements.push(
      icon(
        worker2Id,
        "ibm-cloud/virtual-server-classic",
        "Worker Node 2",
        subnetX + 24 + ICON + 50,
        subnetY + SUBNET_H - 12 - ICON,
        subnetId,
      ),
    );

    elements.push(
      connector(`${prefix}-mzlb-to-lb-${n}`, multiZoneLbId, lbId, "public"),
    );
    elements.push(connector(`${prefix}-lb-to-worker-${n}-1`, lbId, worker1Id));
    elements.push(connector(`${prefix}-lb-to-worker-${n}-2`, lbId, worker2Id));
  }

  // Decorative "Master" band: a translucent strip in the cluster's left gutter, spanning zone 1's
  // top to zone 3's bottom, showing masters are distributed across zones. Not a real container —
  // a plain sibling Box (on-palette Compute fill/stroke, D30) plus an independently-rotated Text
  // label. `masterX` clears every zone's own "Zone N" label text (containerLabelRect estimates
  // ~66px reach from the zone's left edge for that string) since Master is drawn after — and thus
  // on top of — all 3 zones and spans their combined height continuously, so it would otherwise
  // paint over each zone's label row in turn. Stops 10px short of the subnet's left edge. The
  // label's own bounding box (used for rotation pivot and as a hard routing obstacle, see
  // routeConnector.ts's obstaclesFor) is kept small and centered on the band so it doesn't
  // encroach on the Multi-zone-LB-to-zone connectors that cross this gutter. Both elements are
  // marked gutterExempt (M27.6/M27.7): the band deliberately spans and overlaps all 3 zones, which
  // siblingOverlapRule would otherwise read as a coordinate mistake rather than the intentional
  // decorative overlay it is.
  const masterX = zoneX + 72;
  const masterY = zone1Y;
  const zone3Y = zone1Y + 2 * (ZONE_H + ZONE_GAP);
  const masterBottom = zone3Y + ZONE_H;
  const masterWidth = subnetX - 10 - masterX;
  const masterHeight = masterBottom - masterY;
  const masterCenterX = masterX + masterWidth / 2;
  const masterCenterY = masterY + masterHeight / 2;
  elements.push({
    ...box(
      masterId,
      undefined,
      undefined,
      masterX,
      masterY,
      masterWidth,
      masterHeight,
      clusterId,
      MASTER_BAND_STROKE,
      -35,
      MASTER_BAND_FILL,
    ),
    gutterExempt: true,
  });
  const masterLabel: TextElement = {
    id: masterLabelId,
    type: "text",
    semantic: "node",
    text: "Master",
    style: { stroke: MASTER_BAND_STROKE },
    rotation: -90,
    x: masterCenterX - 10,
    y: masterCenterY - 10,
    w: 20,
    h: 20,
    parentId: clusterId,
    z: -20,
    gutterExempt: true,
  };
  elements.push(masterLabel);

  elements.push(
    connector(`${prefix}-client-flow`, clientId, multiZoneLbId, "public"),
  );

  return elements;
}

export function referenceArchitectureElementsFor(
  templateId: ReferenceArchitectureTemplateId,
): SceneElement[] {
  switch (templateId) {
    case "iks-sr-mz-classic":
      return srMzClusterElements({
        distribution: "iks",
        infrastructure: "classic",
      });
    case "iks-sr-mz-vpc":
      return srMzClusterElements({
        distribution: "iks",
        infrastructure: "vpc",
      });
    case "roks-sr-mz-classic":
      return srMzClusterElements({
        distribution: "roks",
        infrastructure: "classic",
      });
    case "roks-sr-mz-vpc":
      return srMzClusterElements({
        distribution: "roks",
        infrastructure: "vpc",
      });
  }
}
