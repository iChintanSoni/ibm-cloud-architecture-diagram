import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { accessibleName, accessibleRole } from "./accessibleName.js";
import { Scene } from "./scene.js";
import type {
  BoxElement,
  ConnectorElement,
  FrameElement,
  IconNodeElement,
  TextElement,
} from "./types.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "test-catalog",
    version: "0.0.1",
    categories: [{ id: "network", name: "Network" }],
    icons: [
      {
        id: "test/vpc",
        name: "Virtual Private Cloud",
        category: "network",
        semantic: "node",
        container: "square",
        asset: "vpc",
        keywords: ["vpc"],
        tier: "ibm-cloud",
      },
    ],
  };
  return new Catalog(manifest, new Map([["vpc", "<rect />"]]));
}

const box: BoxElement = {
  id: "box-1",
  type: "box",
  semantic: "deployedOn",
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  label: { text: "VPC" },
};

const icon: IconNodeElement = {
  id: "icon-1",
  type: "iconNode",
  semantic: "node",
  catalogRef: "test/vpc",
  parentId: "box-1",
  x: 10,
  y: 10,
  w: 48,
  h: 48,
};

describe("accessibleRole", () => {
  it("treats containers as groups and everything else as buttons", () => {
    expect(accessibleRole(box)).toBe("group");
    expect(accessibleRole(icon)).toBe("button");
  });
});

describe("accessibleName", () => {
  it("uses the element's own label when present", () => {
    const scene = new Scene();
    scene._put(box);
    expect(accessibleName(box, scene, testCatalog())).toBe(
      "Box: VPC, contains 0 elements",
    );
  });

  it("counts children in a container's name, pluralizing correctly", () => {
    const scene = new Scene();
    scene._put(box);
    scene._put(icon);
    expect(accessibleName(box, scene, testCatalog())).toBe(
      "Box: VPC, contains 1 element",
    );
  });

  it("falls back to the resolved catalog icon name when there is no label", () => {
    const scene = new Scene();
    const unlabeled: IconNodeElement = {
      ...icon,
      id: "icon-2",
      parentId: undefined,
    };
    scene._put(unlabeled);
    expect(accessibleName(unlabeled, scene, testCatalog())).toBe(
      "Virtual Private Cloud",
    );
  });

  it("falls back to a generic name when nothing else is available", () => {
    const scene = new Scene();
    const bare: IconNodeElement = {
      ...icon,
      id: "icon-3",
      catalogRef: "unknown/ref",
      parentId: undefined,
    };
    scene._put(bare);
    expect(accessibleName(bare, scene, testCatalog())).toBe(
      "Untitled iconNode",
    );
  });

  it("uses text content for text elements", () => {
    const scene = new Scene();
    const text: TextElement = {
      id: "text-1",
      type: "text",
      semantic: "node",
      text: "Payments",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    };
    scene._put(text);
    expect(accessibleName(text, scene, testCatalog())).toBe("Payments");
  });

  it("uses the frame name and counts contents", () => {
    const scene = new Scene();
    const frame: FrameElement = {
      id: "frame-1",
      type: "frame",
      semantic: "boundary",
      name: "Checkout flow",
      order: 1,
      x: 0,
      y: 0,
      w: 800,
      h: 500,
    };
    scene._put(frame);
    expect(accessibleName(frame, scene, testCatalog())).toBe(
      "Frame: Checkout flow, contains 0 elements",
    );
  });

  it("describes a connector by its resolved endpoints and type", () => {
    const scene = new Scene();
    scene._put(box);
    scene._put(icon);
    const connector: ConnectorElement = {
      id: "conn-1",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "box-1", port: "e" },
      to: { elementId: "icon-1", port: "w" },
      connectorType: "association",
      routing: "auto",
    };
    scene._put(connector);
    expect(accessibleName(connector, scene, testCatalog())).toBe(
      "Connector: VPC to Virtual Private Cloud (association)",
    );
  });

  it("describes a connector with a dangling endpoint gracefully", () => {
    const scene = new Scene();
    const connector: ConnectorElement = {
      id: "conn-2",
      type: "connector",
      semantic: "node",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { elementId: "missing-from", port: "e" },
      to: { elementId: "missing-to", port: "w" },
      connectorType: "dependency",
      routing: "auto",
    };
    scene._put(connector);
    expect(accessibleName(connector, scene, testCatalog())).toBe(
      "Connector: unknown element to unknown element (dependency)",
    );
  });
});
