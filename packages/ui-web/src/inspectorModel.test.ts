import type { BoxElement, SceneElement } from "@icad/core";
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

describe("inspector model", () => {
  it("builds a hierarchy from parentId while preserving scene order", () => {
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

    expect(tree.map((node) => node.element.id)).toEqual(["vpc", "external"]);
    expect(tree[0]?.children[0]?.element.id).toBe("subnet");
    expect(tree[0]?.children[0]?.children[0]?.element.id).toBe("app");
  });

  it("keeps orphaned and cyclic elements reachable at the root", () => {
    const orphan = box("orphan", "missing");
    const a = box("a", "b");
    const b = box("b", "a");

    expect(
      buildLayerTree([orphan, a, b]).map((node) => node.element.id),
    ).toEqual(["orphan", "a", "b"]);
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
});
