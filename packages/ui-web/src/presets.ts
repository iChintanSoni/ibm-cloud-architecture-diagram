import type { ZoneKind } from "@icad/core";

export type ContainerKind = "box" | "group" | "zone";
export type PrimitiveKind = ContainerKind | "frame";

/** `zone` remains the file-format primitive; Boundary is its non-normative UI label. */
export function containerKindLabel(kind: PrimitiveKind): string {
  if (kind === "zone") return "Boundary";
  return kind[0]!.toUpperCase() + kind.slice(1);
}

export interface ContainerPreset {
  id: string;
  name: string;
  kind: ContainerKind;
  color: string;
  cornerIcon?: string;
  zoneKind?: ZoneKind;
}

/**
 * Presets confirmed by worked examples in IBM's architecture diagram kit.
 * Inferred rows from docs/04 remain withheld pending IBM Design sign-off.
 */
export const confirmedContainerPresets: readonly ContainerPreset[] = [
  {
    id: "ibm-cloud",
    name: "IBM Cloud",
    kind: "box",
    color: "#1192e8",
    cornerIcon: "ibm-cloud/ibm-cloud"
  },
  {
    id: "public-network",
    name: "Public Network",
    kind: "box",
    color: "#1192e8",
    cornerIcon: "ibm-cloud/public-network"
  },
  {
    id: "open-shift",
    name: "OpenShift",
    kind: "group",
    color: "#198038",
    cornerIcon: "ibm-cloud/open-shift"
  },
  {
    id: "availability-zone",
    name: "Availability zone",
    kind: "zone",
    color: "#8d8d8d",
    zoneKind: "az"
  },
  // Region/VPC newly confirmed by D24 (docs/00-decision-log.md) — Box, not Boundary/Zone.
  {
    id: "region",
    name: "Region",
    kind: "box",
    color: "#878d96",
    cornerIcon: "ibm-cloud/location"
  },
  {
    id: "vpc",
    name: "VPC",
    kind: "box",
    color: "#1192e8",
    cornerIcon: "ibm-cloud/vpc"
  }
];
