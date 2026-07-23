import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { moveElements } from "../commands/commands.js";
import { createEditor, type Editor } from "./createEditor.js";

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
        tier: "ibm-cloud"
      }
    ]
  };
  const assets = new Map([["vpc", '<rect width="20" height="20" fill="#0f62fe" />']]);
  return new Catalog(manifest, assets);
}

describe("createEditor", () => {
  let container: HTMLDivElement;
  let editor: Editor;

  beforeEach(() => {
    container = document.createElement("div");
    editor = createEditor({ container, catalog: testCatalog() });
  });

  it("mounts an SVG root into the container", () => {
    expect(container.querySelector("svg[data-icad-root]")).not.toBeNull();
  });

  it("adds a box and renders a DOM node keyed by element id", () => {
    const id = editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    expect(editor.scene.get(id)).toMatchObject({ type: "box", semantic: "deployedOn" });
    expect(container.querySelector(`[data-icad-id="${id}"][data-icad-type="box"]`)).not.toBeNull();
  });

  it("adds a catalog icon and renders its glyph", () => {
    const id = editor.addIcon("test/vpc", { at: { x: 40, y: 40 } });
    expect(editor.scene.get(id)).toMatchObject({ type: "iconNode", catalogRef: "test/vpc" });
    expect(container.querySelector(`[data-icad-id="${id}"] svg rect`)).not.toBeNull();
  });

  it("throws when adding an unknown catalog icon", () => {
    expect(() => editor.addIcon("does/not-exist", { at: { x: 0, y: 0 } })).toThrow(/Unknown catalog icon/);
  });

  it("adds a text element and renders its content", () => {
    const id = editor.addText({ at: { x: 10, y: 10 }, text: "Payments platform" });
    expect(editor.scene.get(id)).toMatchObject({ type: "text", text: "Payments platform" });
    expect(container.querySelector(`[data-icad-id="${id}"] text`)?.textContent).toBe("Payments platform");
  });

  it("moves a box's contents along with it (move-with)", () => {
    const parent = editor.addBox({ at: { x: 0, y: 0 }, label: "Subnet" });
    const child = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: parent });

    editor.commands.dispatch(moveElements(editor.scene, [parent], 50, 30));

    expect(editor.scene.get(parent)).toMatchObject({ x: 50, y: 30 });
    expect(editor.scene.get(child)).toMatchObject({ x: 70, y: 50 });
  });

  it("connects two elements and renders a routed polyline", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect({ elementId: a, port: "e" }, { elementId: b, port: "w" });

    const polyline = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")).toContain("100,30");
  });

  it("undoes and redoes through the shared command bus", () => {
    const id = editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    expect(editor.scene.has(id)).toBe(true);

    editor.commands.undo();
    expect(editor.scene.has(id)).toBe(false);

    editor.commands.redo();
    expect(editor.scene.has(id)).toBe(true);
  });

  it("lints the scene and surfaces a missing-label warning", () => {
    editor.addBox({ at: { x: 0, y: 0 } });
    const diagnostics = editor.lint();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ ruleId: "missing-label" });
  });

  it("round-trips the scene via toIcad/loadIcad", () => {
    editor.addBox({ at: { x: 5, y: 5 }, label: "VPC" });
    const doc = editor.toIcad();

    const other = createEditor({ container: document.createElement("div"), catalog: testCatalog() });
    other.loadIcad(doc);

    expect(other.toIcad().elements).toEqual(doc.elements);
  });

  it("exports SVG with an embedded, reopenable .icad source by default", () => {
    editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const svg = editor.export({ format: "svg" }) as string;
    expect(svg).toContain('id="icad:source"');
  });

  it("omits the embedded source when embedSource is false", () => {
    editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const svg = editor.export({ format: "svg", embedSource: false }) as string;
    expect(svg).not.toContain('id="icad:source"');
  });
});
