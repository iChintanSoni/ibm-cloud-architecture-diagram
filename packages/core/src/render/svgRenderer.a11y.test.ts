import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { Scene } from "../scene/scene.js";
import type { BoxElement, IconNodeElement } from "../scene/types.js";
import { SvgRenderer } from "./svgRenderer.js";

function testCatalog(): Catalog {
  const manifest: CatalogManifest = {
    id: "a11y-fixtures",
    version: "1",
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

function box(id: string, x: number, parentId?: string): BoxElement {
  return {
    id,
    type: "box",
    semantic: "deployedOn",
    x,
    y: 0,
    w: 200,
    h: 200,
    label: { text: id },
    ...(parentId ? { parentId } : {}),
  };
}

function icon(id: string, x: number, parentId?: string): IconNodeElement {
  return {
    id,
    type: "iconNode",
    semantic: "node",
    catalogRef: "test/vpc",
    x,
    y: 10,
    w: 48,
    h: 48,
    ...(parentId ? { parentId } : {}),
  };
}

describe("SvgRenderer accessibility", () => {
  let container: HTMLDivElement;
  let scene: Scene;
  let renderer: SvgRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    scene = new Scene();
    renderer = new SvgRenderer(container, testCatalog(), "light");
  });

  afterEach(() => {
    container.remove();
  });

  it("gives every element a role and an accessible name", () => {
    scene._put(box("vpc", 0));
    scene._put(icon("server", 10, "vpc"));
    renderer.render(scene);

    expect(renderer.nodeFor("vpc")?.getAttribute("role")).toBe("group");
    expect(renderer.nodeFor("vpc")?.getAttribute("aria-label")).toBe(
      "Box: vpc, contains 1 element",
    );
    expect(renderer.nodeFor("server")?.getAttribute("role")).toBe("button");
    expect(renderer.nodeFor("server")?.getAttribute("aria-label")).toBe(
      "Virtual Private Cloud",
    );
  });

  it("gives every element a real id so aria-owns can reference it", () => {
    scene._put(box("vpc", 0));
    renderer.render(scene);
    expect(renderer.nodeFor("vpc")?.getAttribute("id")).toBe("vpc");
  });

  it("exposes containment via aria-owns, forming a screen-reader object tree", () => {
    scene._put(box("vpc", 0));
    scene._put(icon("server-1", 10, "vpc"));
    scene._put(icon("server-2", 60, "vpc"));
    renderer.render(scene);

    expect(renderer.nodeFor("vpc")?.getAttribute("aria-owns")).toBe(
      "server-1 server-2",
    );
    expect(renderer.nodeFor("server-1")?.hasAttribute("aria-owns")).toBe(false);
  });

  it("keeps aria-owns in sync as children are added, reparented, and removed", () => {
    scene._put(box("vpc", 0));
    scene._put(icon("server-1", 10, "vpc"));
    renderer.render(scene);
    expect(renderer.nodeFor("vpc")?.getAttribute("aria-owns")).toBe("server-1");

    scene._remove("server-1");
    renderer.render(scene);
    expect(renderer.nodeFor("vpc")?.hasAttribute("aria-owns")).toBe(false);
  });

  it("defaults the roving tabindex to the first element in tab order when nothing is selected", () => {
    scene._put(box("east", 200));
    scene._put(box("west", 0));
    renderer.render(scene);

    expect(renderer.nodeFor("west")?.getAttribute("tabindex")).toBe("0");
    expect(renderer.nodeFor("east")?.getAttribute("tabindex")).toBe("-1");
  });

  it("moves the roving tabindex to the selected element without stealing DOM focus", () => {
    scene._put(box("east", 200));
    scene._put(box("west", 0));
    renderer.render(scene);

    renderer.setSelection(["east"]);

    expect(renderer.nodeFor("east")?.getAttribute("tabindex")).toBe("0");
    expect(renderer.nodeFor("west")?.getAttribute("tabindex")).toBe("-1");
    // Selection alone (e.g. from Find or frame presentation) must not yank focus away
    // from whatever the user is currently typing into.
    expect(document.activeElement).not.toBe(renderer.nodeFor("east"));
  });

  it("focusElement moves real DOM focus for deliberate keyboard navigation (Tab/Shift+Tab)", () => {
    scene._put(box("east", 200));
    scene._put(box("west", 0));
    renderer.render(scene);

    renderer.focusElement("east");

    expect(document.activeElement).toBe(renderer.nodeFor("east"));
  });

  it("falls back to the first tab-order element when the selection is cleared", () => {
    scene._put(box("east", 200));
    scene._put(box("west", 0));
    renderer.render(scene);
    renderer.setSelection(["east"]);

    renderer.setSelection([]);

    expect(renderer.nodeFor("west")?.getAttribute("tabindex")).toBe("0");
    expect(renderer.nodeFor("east")?.getAttribute("tabindex")).toBe("-1");
  });

  it("does not force focus onto any one element during a multi-selection", () => {
    scene._put(box("east", 200));
    scene._put(box("west", 0));
    renderer.render(scene);

    renderer.setSelection(["east", "west"]);

    const tabbable = ["east", "west"].filter(
      (id) => renderer.nodeFor(id)?.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);
  });

  it("keeps exactly one tabbable element after the focused element is removed", () => {
    scene._put(box("east", 200));
    scene._put(box("west", 0));
    renderer.render(scene);
    renderer.setSelection(["west"]);

    scene._remove("west");
    renderer.render(scene);

    expect(renderer.nodeFor("east")?.getAttribute("tabindex")).toBe("0");
  });
});
