import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { moveElements } from "../commands/commands.js";
import { createEditor, ExportBlockedError, type Editor } from "./createEditor.js";

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

  it("routes a connector around an icon placed in its path", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    editor.addIcon("test/vpc", { at: { x: 180, y: 5 } });
    const connId = editor.connect({ elementId: a, port: "e" }, { elementId: b, port: "w" });

    expect(editor.scene.get(connId)).toMatchObject({ routing: "auto" });
    const waypoints = (editor.scene.get(connId) as { waypoints?: unknown[] }).waypoints;
    expect(waypoints?.length).toBeGreaterThan(0);
  });

  it("renders a dashed line and a hollow arrowhead for an implementation connector", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "implementation" }
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("stroke-dasharray")).toBe("4 3");
    expect(line?.getAttribute("marker-end")).toBe("url(#icad-arrow-hollow)");
  });

  it("colors a connection-type connector by flowColor", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", flowColor: "public" }
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("stroke")).toBe("#0f62fe");
  });

  it("renders arrowheads at both ends of a bidirectional connection", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", direction: "bidirectional" }
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("marker-start")).toBe("url(#icad-arrow)");
    expect(line?.getAttribute("marker-end")).toBe("url(#icad-arrow)");
  });

  it("overrides the route with manual waypoints and can switch back to auto", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect({ elementId: a, port: "e" }, { elementId: b, port: "w" });

    editor.setConnectorWaypoints(connId, [{ x: 150, y: 200 }]);
    expect(editor.scene.get(connId)).toMatchObject({ routing: "manual", waypoints: [{ x: 150, y: 200 }] });

    editor.commands.dispatch(moveElements(editor.scene, [b], 0, 50));
    expect(editor.scene.get(connId)).toMatchObject({ waypoints: [{ x: 150, y: 200 }] });

    editor.autoRouteConnector(connId);
    const reRouted = editor.scene.get(connId) as { routing?: string; waypoints?: unknown[] };
    expect(reRouted.routing).toBe("auto");
    expect(reRouted.waypoints).not.toEqual([{ x: 150, y: 200 }]);
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

  it("applies all quick-fixes of one type as a single undo step", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 } });
    const b = editor.addBox({ at: { x: 200, y: 0 } });

    expect(editor.applyQuickFixes("missing-label")).toBe(2);
    expect(editor.scene.get(a)?.label?.text).toBe("Untitled");
    expect(editor.scene.get(b)?.label?.text).toBe("Untitled");

    editor.commands.undo();
    expect(editor.scene.get(a)?.label).toBeUndefined();
    expect(editor.scene.get(b)?.label).toBeUndefined();
  });

  it("selects validation targets and renders editor-only validation badges", () => {
    const id = editor.addBox({ at: { x: 0, y: 0 } });
    editor.lint();
    expect(container.querySelector(`[data-icad-validation-badge="${id}"]`)).not.toBeNull();

    editor.selection.set([id]);
    expect(container.querySelector('[data-icad-layer="overlays"] rect')).not.toBeNull();

    const svg = editor.export({ format: "svg" }) as string;
    expect(svg).not.toContain('data-icad-layer="overlays"');
  });

  it("blocks export on errors only when the document gate is set to block", () => {
    editor.addBox({ at: { x: 0, y: 0 } });
    editor.setRuleSeverity("missing-label", "error");
    expect(() => editor.export({ format: "svg" })).not.toThrow();

    editor.setExportGate("block");
    expect(() => editor.export({ format: "svg" })).toThrow(ExportBlockedError);

    editor.commands.undo();
    expect(editor.scene.conformance.exportGate).toBe("warn");
    expect(() => editor.export({ format: "svg" })).not.toThrow();
  });

  it("summarizes configured error, warning, and info diagnostics", () => {
    editor.addBox({ at: { x: 0, y: 0 } });
    editor.addGroup({ at: { x: 200, y: 0 }, label: "Security group" });
    editor.setRuleSeverity("missing-label", "error");
    editor.setRuleSeverity("group-without-box", "info");

    expect(editor.complianceSummary()).toMatchObject({
      counts: { error: 1, warn: 0, info: 1 },
      blocked: false
    });

    editor.setExportGate("block");
    expect(editor.complianceSummary().blocked).toBe(true);
  });

  it("renders the highest diagnostic severity and issue count on a shared badge", () => {
    editor.scene._put({
      id: "invalid-icon",
      type: "iconNode",
      semantic: "node",
      catalogRef: "test/missing",
      x: 0,
      y: 0,
      w: 64,
      h: 40
    });
    editor.lint();

    const badge = container.querySelector('[data-icad-validation-badge="invalid-icon"]');
    expect(badge?.querySelector("circle")?.getAttribute("fill")).toBe("#da1e28");
    expect(badge?.querySelector("text")?.textContent).toBe("2");
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
