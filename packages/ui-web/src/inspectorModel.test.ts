import type { BoxElement, ConnectorElement, SceneElement } from "@icad/core";
import { describe, expect, it } from "vitest";
import {
  buildLayerTree,
  elementDisplayName,
  eligibleParentElements,
} from "./inspectorModel.js";

function box(id: string, parentId?: string, label?: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    ...(parentId ? { parentId } : {}),
    ...(label ? { label: { text: label } } : {}),
  };
}

function connector(
  id: string,
  from: string,
  to: string,
  opts: Partial<ConnectorElement> = {},
): ConnectorElement {
  return {
    id,
    type: "connector",
    semantic: "node",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    from: { elementId: from, port: "e" },
    to: { elementId: to, port: "w" },
    connectorType: "association",
    ...opts,
  };
}

describe("inspector model", () => {
  it("builds a hierarchy from parentId with frontmost roots at the top (M18.5)", () => {
    // All elements have z=0 (undefined), so equal-z siblings reverse input order —
    // the last-inserted element is frontmost and appears first in the Layers panel.
    const elements: SceneElement[] = [
      box("vpc", undefined, "VPC"),
      box("subnet", "vpc", "Subnet"),
      {
        id: "app",
        type: "iconNode",
        semantic: "node",
        catalogRef: "ibm-cloud/virtual-server",
        parentId: "subnet",
        x: 20,
        y: 20,
        w: 48,
        h: 48,
      },
      box("external", undefined, "External"),
    ];

    const tree = buildLayerTree(elements);

    // "external" (last in the input at z=0) is frontmost → first row in the panel.
    expect(tree.map((node) => node.element.id)).toEqual(["external", "vpc"]);
    // Children are similarly reversed: only one child, no observable change.
    expect(tree[1]?.children[0]?.element.id).toBe("subnet");
    expect(tree[1]?.children[0]?.children[0]?.element.id).toBe("app");
  });

  it("keeps orphaned and cyclic elements reachable at the root (frontmost first)", () => {
    // All at z=0 → reversed from input order.
    const orphan = box("orphan", "missing");
    const a = box("a", "b");
    const b = box("b", "a");

    expect(
      buildLayerTree([orphan, a, b]).map((node) => node.element.id),
    ).toEqual(["b", "a", "orphan"]);
  });

  it("excludes self and descendants from parent choices", () => {
    const root = box("root");
    const child = box("child", "root");
    const grandchild = box("grandchild", "child");
    const other = box("other");

    expect(
      eligibleParentElements([root, child, grandchild, other], "root").map(
        (el) => el.id,
      ),
    ).toEqual(["other"]);
  });

  it("chooses a useful display name for each supported naming shape", () => {
    expect(elementDisplayName(box("box", undefined, "VPC"))).toBe("VPC");
    expect(
      elementDisplayName({
        id: "text",
        type: "text",
        semantic: "node",
        text: "Notes",
        x: 0,
        y: 0,
        w: 20,
        h: 20,
      }),
    ).toBe("Notes");
  });

  describe("connector display names (F3, M24.3)", () => {
    it("prefers the connector's own label over annotation.name or from/to", () => {
      const a = box("a");
      const b = box("b");
      const conn = connector("conn", "a", "b", {
        label: { text: "HTTPS" },
        annotation: { name: "Some Protocol" },
      });
      const byId = new Map([a, b, conn].map((el) => [el.id, el]));

      expect(elementDisplayName(conn, byId)).toBe("HTTPS");
    });

    it("falls back to annotation.name when there's no label", () => {
      const conn = connector("conn", "a", "b", {
        annotation: { name: "HTTPS/443" },
      });

      expect(elementDisplayName(conn)).toBe("HTTPS/443");
    });

    it("falls back to '{from} → {to}' when elementsById is given and neither label nor annotation.name is set", () => {
      const a = box("a", undefined, "Load Balancer");
      const b = box("b", undefined, "VSI 1");
      const conn = connector("conn", "a", "b");
      const byId = new Map([a, b, conn].map((el) => [el.id, el]));

      expect(elementDisplayName(conn, byId)).toBe("Load Balancer → VSI 1");
    });

    it("falls back to 'Untitled connector' when elementsById is omitted (backward compatible)", () => {
      const conn = connector("conn", "a", "b");

      expect(elementDisplayName(conn)).toBe("Untitled connector");
    });

    it("falls back to 'Untitled connector' when elementsById doesn't resolve the endpoints", () => {
      const conn = connector("conn", "a", "b");
      const byId = new Map<string, SceneElement>([[conn.id, conn]]);

      expect(elementDisplayName(conn, byId)).toBe("Untitled connector");
    });
  });
});
