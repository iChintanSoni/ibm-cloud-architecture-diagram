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

  it("adds named frames with presentation order through the public API", () => {
    const overview = editor.addFrame({
      at: { x: 0, y: 0 },
      w: 600,
      h: 400,
      name: "Overview"
    });
    const deployment = editor.addFrame({
      at: { x: 700, y: 0 },
      w: 600,
      h: 400,
      name: "Deployment"
    });

    expect(editor.scene.get(overview)).toMatchObject({ type: "frame", order: 1 });
    expect(editor.scene.get(deployment)).toMatchObject({ type: "frame", order: 2 });
    expect(container.querySelector(`[data-icad-id="${overview}"] text`)?.textContent).toBe("Overview");
  });

  it("reorders every frame as one undoable operation", () => {
    const overview = editor.addFrame({ at: { x: 0, y: 0 }, name: "Overview" });
    const deployment = editor.addFrame({ at: { x: 900, y: 0 }, name: "Deployment" });

    editor.reorderFrames([deployment, overview]);
    expect(editor.scene.get(deployment)).toMatchObject({ order: 1 });
    expect(editor.scene.get(overview)).toMatchObject({ order: 2 });

    editor.commands.undo();
    expect(editor.scene.get(overview)).toMatchObject({ order: 1 });
    expect(editor.scene.get(deployment)).toMatchObject({ order: 2 });
    expect(() => editor.reorderFrames([overview])).toThrow(/every frame exactly once/);
  });

  it("starts a template document and clears history from the replaced document", () => {
    editor.addBox({ at: { x: 0, y: 0 }, label: "Old document" });
    expect(editor.commands.canUndo()).toBe(true);

    editor.newDocument("system-context");

    expect(editor.scene.meta.diagramLevel).toBe("system-context");
    expect(editor.scene.all().some((element) => element.type === "frame")).toBe(true);
    expect(editor.commands.canUndo()).toBe(false);
    expect(editor.selection.get()).toEqual([]);
  });

  it("moves a box's contents along with it (move-with)", () => {
    const parent = editor.addBox({ at: { x: 0, y: 0 }, label: "Subnet" });
    const child = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: parent });

    editor.commands.dispatch(moveElements(editor.scene, [parent], 50, 30));

    expect(editor.scene.get(parent)).toMatchObject({ x: 50, y: 30 });
    expect(editor.scene.get(child)).toMatchObject({ x: 70, y: 50 });
  });

  it("edits inspector properties as one undoable move-with operation", () => {
    const parent = editor.addBox({ at: { x: 0, y: 0 }, label: "Subnet" });
    const child = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: parent });

    editor.updateElementProperties(parent, {
      x: 80,
      y: 40,
      w: 300,
      label: { text: "Application subnet" }
    });

    expect(editor.scene.get(parent)).toMatchObject({
      x: 80,
      y: 40,
      w: 300,
      label: { text: "Application subnet" }
    });
    expect(editor.scene.get(child)).toMatchObject({ x: 100, y: 60 });

    editor.commands.undo();
    expect(editor.scene.get(parent)).toMatchObject({
      x: 0,
      y: 0,
      w: 240,
      label: { text: "Subnet" }
    });
    expect(editor.scene.get(child)).toMatchObject({ x: 20, y: 20 });
  });

  it("reroutes an attached automatic connector after an inspector resize", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connectorId = editor.connect({ elementId: a, port: "e" }, { elementId: b, port: "w" });

    editor.updateElementProperties(a, { h: 400 });

    expect(editor.scene.get(a)).toMatchObject({ h: 400 });
    expect((editor.scene.get(connectorId) as { waypoints?: unknown[] }).waypoints?.length).toBeGreaterThan(0);
    editor.commands.undo();
    expect(editor.scene.get(a)).toMatchObject({ h: 60 });
    expect(editor.scene.get(connectorId)).toMatchObject({ waypoints: [] });
  });

  it("reparents through the public editor API and rejects non-container parents", () => {
    const parent = editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const child = editor.addIcon("test/vpc", { at: { x: 20, y: 20 } });
    const nonContainer = editor.addIcon("test/vpc", { at: { x: 80, y: 20 } });

    editor.setElementParent(child, parent);
    expect(editor.scene.get(child)).toMatchObject({ parentId: parent });

    editor.commands.undo();
    expect(editor.scene.get(child)?.parentId).toBeUndefined();
    expect(() => editor.setElementParent(child, nonContainer)).toThrow(/cannot contain/);
  });

  it("notifies shell listeners when selection changes", () => {
    const id = editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const seen: string[][] = [];
    const unsubscribe = editor.onSelectionChange((ids) => seen.push(ids));

    editor.selection.set([id]);
    editor.selection.clear();
    unsubscribe();

    expect(seen).toEqual([[id], []]);
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

  it("renders IBM endpoint dots at both ends of a bidirectional connection", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", direction: "bidirectional" }
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("marker-start")).toBe("url(#icad-dot)");
    expect(line?.getAttribute("marker-end")).toBe("url(#icad-dot)");
  });

  it("renders an IBM source dot and destination arrow for a unidirectional connection", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({ at: { x: 300, y: 0 }, w: 100, h: 60, label: "B" });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", direction: "unidirectional" }
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("marker-start")).toBe("url(#icad-dot)");
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
    editor.addGroup({
      at: { x: 200, y: 0 },
      label: "Security group",
      style: { dashed: false }
    });
    editor.setRuleSeverity("missing-label", "error");
    editor.setRuleSeverity("container-border", "info");

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

  describe("viewport", () => {
    it("starts unscaled at the origin", () => {
      expect(editor.viewport.get()).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it("zooms in and out around the viewport center", () => {
      editor.zoomIn();
      expect(editor.viewport.get().scale).toBeGreaterThan(1);
      editor.resetView();
      editor.zoomOut();
      expect(editor.viewport.get().scale).toBeLessThan(1);
    });

    it("resets to the identity view", () => {
      editor.viewport.set({ x: 100, y: 100, scale: 2 });
      editor.resetView();
      expect(editor.viewport.get()).toEqual({ x: 0, y: 0, scale: 1 });
    });

    it("focuses the viewport on the given elements' bounding box", () => {
      const id = editor.addBox({ at: { x: 500, y: 500 }, w: 100, h: 100, label: "Far away" });
      editor.focusOnElements([id]);
      const state = editor.viewport.get();
      // The box's center (550,550) should now be roughly centered in the (fallback) 800x600 viewport.
      expect(state.x + 800 / (2 * state.scale)).toBeCloseTo(550, 0);
      expect(state.y + 600 / (2 * state.scale)).toBeCloseTo(550, 0);
    });

    it("does nothing when focusing on elements that don't exist", () => {
      const before = editor.viewport.get();
      editor.focusOnElements(["missing"]);
      expect(editor.viewport.get()).toEqual(before);
    });

    it("computes a bounding box for a set of elements via boundsOf", () => {
      const id = editor.addIcon("test/vpc", { at: { x: 10, y: 10 } });
      expect(editor.boundsOf([id])).toEqual({ x: 10, y: 10, w: 48, h: 48 });
    });
  });

  describe("keyboard accessibility", () => {
    it("exposes the tab order as element ids, west to east", () => {
      const east = editor.addBox({ at: { x: 200, y: 0 }, label: "east" });
      const west = editor.addBox({ at: { x: 0, y: 0 }, label: "west" });
      expect(editor.tabOrder()).toEqual([west, east]);
    });

    it("focusNext/focusPrevious step keyboard focus through the tab order and wrap around, without touching selection", () => {
      const west = editor.addBox({ at: { x: 0, y: 0 }, label: "west" });
      const east = editor.addBox({ at: { x: 200, y: 0 }, label: "east" });

      editor.focusNext();
      expect(editor.focusedElement()).toBe(west);
      editor.focusNext();
      expect(editor.focusedElement()).toBe(east);
      editor.focusNext();
      expect(editor.focusedElement()).toBe(west);

      editor.focusPrevious();
      expect(editor.focusedElement()).toBe(east);

      // Tab navigation alone never selects anything (docs/07-accessibility.md).
      expect(editor.selection.get()).toEqual([]);
    });

    it("focusElement moves keyboard focus directly without changing selection", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      editor.focusElement(id);
      expect(editor.focusedElement()).toBe(id);
      expect(editor.selection.get()).toEqual([]);
    });

    it("ignores focusElement for an unknown id", () => {
      editor.focusElement("missing");
      expect(editor.focusedElement()).toBeUndefined();
    });

    it("clears focusedElement when the focused element is deleted", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      editor.focusElement(id);
      editor.deleteElements([id]);
      expect(editor.focusedElement()).toBeUndefined();
    });

    it("does nothing for focusNext/focusPrevious on an empty scene", () => {
      editor.focusNext();
      expect(editor.selection.get()).toEqual([]);
      editor.focusPrevious();
      expect(editor.selection.get()).toEqual([]);
    });

    it("pans the viewport into view when focusNext lands on an off-screen element", () => {
      editor.addBox({ at: { x: 0, y: 0 }, label: "west" });
      editor.addBox({ at: { x: 5000, y: 5000 }, label: "far away" });

      editor.focusNext();
      editor.focusNext();

      const state = editor.viewport.get();
      expect(state.x).toBeGreaterThan(0);
    });

    it("nudges every given element by the same delta, undoably", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });
      editor.nudgeElements([id], 5, -5);
      expect(editor.scene.get(id)).toMatchObject({ x: 15, y: 5 });
      editor.commands.undo();
      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 });
    });

    it("moves nested contents along when nudging a container (move-with)", () => {
      const parent = editor.addBox({ at: { x: 0, y: 0 }, w: 200, h: 200, label: "parent" });
      const child = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: parent });
      editor.nudgeElements([parent], 10, 10);
      expect(editor.scene.get(child)).toMatchObject({ x: 30, y: 30 });
    });

    it("ignores unknown ids and a zero delta when nudging (no extra undo step pushed)", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });
      editor.nudgeElements(["missing"], 5, 5);
      editor.nudgeElements([id], 0, 0);
      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 });

      // A single undo fully removes the box, proving no no-op nudge command was pushed in between.
      editor.commands.undo();
      expect(editor.scene.get(id)).toBeUndefined();
    });

    it("deletes an element and its descendants as one undoable step, then clears selection", () => {
      const parent = editor.addBox({ at: { x: 0, y: 0 }, w: 200, h: 200, label: "parent" });
      const child = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: parent });
      editor.selection.set([parent]);

      editor.deleteElements([parent]);

      expect(editor.scene.get(parent)).toBeUndefined();
      expect(editor.scene.get(child)).toBeUndefined();
      expect(editor.selection.get()).toEqual([]);

      editor.commands.undo();
      expect(editor.scene.get(parent)).toBeDefined();
      expect(editor.scene.get(child)).toBeDefined();
    });

    it("deletes multiple elements as a single undo step", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 200, y: 0 }, label: "b" });

      editor.deleteElements([a, b]);
      expect(editor.scene.all()).toHaveLength(0);

      editor.commands.undo();
      expect(editor.scene.all().map((el) => el.id).sort()).toEqual([a, b].sort());
    });

    it("does nothing when deleting only unknown ids", () => {
      editor.deleteElements(["missing"]);
      expect(editor.commands.canUndo()).toBe(false);
    });
  });

  describe("group / ungroup", () => {
    it("groups two elements into a new Group container sized to their bounds, and selects it", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({ at: { x: 200, y: 100 }, w: 50, h: 50, label: "b" });

      const groupId = editor.groupElements([a, b]);

      expect(groupId).toBeDefined();
      expect(editor.scene.get(groupId!)).toMatchObject({ type: "group", semantic: "deployedTo" });
      expect(editor.scene.get(a)?.parentId).toBe(groupId);
      expect(editor.scene.get(b)?.parentId).toBe(groupId);
      // bbox of a (0,0,50,50) + b (200,100,50,50) is x:0 y:0 w:250 h:150, padded by 16 on each side.
      expect(editor.scene.get(groupId!)).toMatchObject({ x: -16, y: -16, w: 282, h: 182 });
      expect(editor.selection.get()).toEqual([groupId]);
    });

    it("nests the new group under a shared parent", () => {
      const parent = editor.addBox({ at: { x: 0, y: 0 }, w: 400, h: 400, label: "parent" });
      const a = editor.addIcon("test/vpc", { at: { x: 10, y: 10 }, parentId: parent });
      const b = editor.addIcon("test/vpc", { at: { x: 100, y: 10 }, parentId: parent });

      const groupId = editor.groupElements([a, b]);
      expect(editor.scene.get(groupId!)?.parentId).toBe(parent);
    });

    it("defaults to canvas root when grouped elements don't share a parent", () => {
      const parent = editor.addBox({ at: { x: 0, y: 0 }, w: 400, h: 400, label: "parent" });
      const a = editor.addIcon("test/vpc", { at: { x: 10, y: 10 }, parentId: parent });
      const b = editor.addBox({ at: { x: 500, y: 0 }, w: 50, h: 50, label: "root box" });

      const groupId = editor.groupElements([a, b]);
      expect(editor.scene.get(groupId!)?.parentId).toBeUndefined();
    });

    it("undoes grouping as a single step, restoring original parents", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 200, y: 0 }, label: "b" });

      const groupId = editor.groupElements([a, b]);
      editor.commands.undo();

      expect(editor.scene.get(groupId!)).toBeUndefined();
      expect(editor.scene.get(a)?.parentId).toBeUndefined();
      expect(editor.scene.get(b)?.parentId).toBeUndefined();
    });

    it("does nothing when grouping fewer than two known elements", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      expect(editor.groupElements([a])).toBeUndefined();
      expect(editor.groupElements(["missing-1", "missing-2"])).toBeUndefined();

      // A single undo fully removes `a`, proving no group command was pushed in between.
      editor.commands.undo();
      expect(editor.scene.get(a)).toBeUndefined();
    });

    it("ungroups a container, reparenting its children to the container's own parent, and selects them", () => {
      const outer = editor.addBox({ at: { x: 0, y: 0 }, w: 400, h: 400, label: "outer" });
      const group = editor.addGroup({ at: { x: 10, y: 10 }, w: 200, h: 200, parentId: outer, label: "inner" });
      const a = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: group });
      const b = editor.addIcon("test/vpc", { at: { x: 100, y: 20 }, parentId: group });

      editor.ungroupElement(group);

      expect(editor.scene.get(group)).toBeUndefined();
      expect(editor.scene.get(a)?.parentId).toBe(outer);
      expect(editor.scene.get(b)?.parentId).toBe(outer);
      expect(editor.selection.get().sort()).toEqual([a, b].sort());
    });

    it("ungroups a root-level container to canvas root", () => {
      const group = editor.addGroup({ at: { x: 0, y: 0 }, w: 200, h: 200, label: "group" });
      const a = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: group });

      editor.ungroupElement(group);
      expect(editor.scene.get(a)?.parentId).toBeUndefined();
    });

    it("undoes an ungroup as a single step", () => {
      const group = editor.addGroup({ at: { x: 0, y: 0 }, w: 200, h: 200, label: "group" });
      const a = editor.addIcon("test/vpc", { at: { x: 20, y: 20 }, parentId: group });

      editor.ungroupElement(group);
      editor.commands.undo();

      expect(editor.scene.get(group)).toBeDefined();
      expect(editor.scene.get(a)?.parentId).toBe(group);
    });

    it("does nothing for an unknown id or a non-container element", () => {
      const icon = editor.addIcon("test/vpc", { at: { x: 0, y: 0 } });
      editor.ungroupElement("missing");
      editor.ungroupElement(icon);

      // A single undo fully removes the icon, proving no ungroup command was pushed in between.
      editor.commands.undo();
      expect(editor.scene.get(icon)).toBeUndefined();
    });
  });

  describe("connectNearest", () => {
    it("connects two elements using a port pair inferred from their relative position", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({ at: { x: 300, y: 0 }, w: 50, h: 50, label: "b" });

      const connId = editor.connectNearest(a, b);

      expect(connId).toBeDefined();
      expect(editor.scene.get(connId!)).toMatchObject({
        type: "connector",
        from: { elementId: a, port: "e" },
        to: { elementId: b, port: "w" }
      });
      expect(editor.selection.get()).toEqual([connId]);
    });

    it("passes through connector type/direction/flowColor options", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 300, y: 0 }, label: "b" });
      const connId = editor.connectNearest(a, b, { connectorType: "dependency" });
      expect(editor.scene.get(connId!)).toMatchObject({ connectorType: "dependency" });
    });

    it("does nothing for unknown ids, self-connections, or connector endpoints", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 300, y: 0 }, label: "b" });
      const connId = editor.connectNearest(a, b);

      expect(editor.connectNearest(a, "missing")).toBeUndefined();
      expect(editor.connectNearest(a, a)).toBeUndefined();
      expect(editor.connectNearest(connId!, b)).toBeUndefined();
    });
  });

  describe("connector draft preview + port hover", () => {
    it("shows a port-marker hover ring on an element and clears it", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      editor.setHoveredElement(a);
      expect(container.querySelector(`[data-icad-port^="${a}:"]`)).not.toBeNull();
      editor.setHoveredElement(undefined);
      expect(container.querySelector(`[data-icad-port^="${a}:"]`)).toBeNull();
    });

    it("draws a connector preview snapped to the nearest ports between two elements", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({ at: { x: 300, y: 0 }, w: 50, h: 50, label: "b" });
      editor.previewConnectorBetween(a, b);

      const line = container.querySelector('[data-icad-layer="overlays"] line')!;
      expect(line.getAttribute("x1")).toBe("50"); // a's east port
      expect(line.getAttribute("x2")).toBe("300"); // b's west port
    });

    it("draws a connector preview at arbitrary points for a mouse drag in progress", () => {
      editor.setConnectorDraftPoints({ x: 5, y: 5 }, { x: 40, y: 60 });
      const line = container.querySelector('[data-icad-layer="overlays"] line')!;
      expect(line.getAttribute("x2")).toBe("40");
      expect(line.getAttribute("y2")).toBe("60");
    });

    it("clears the connector draft", () => {
      editor.setConnectorDraftPoints({ x: 0, y: 0 }, { x: 1, y: 1 });
      editor.clearConnectorDraft();
      expect(container.querySelector('[data-icad-layer="overlays"] line')).toBeNull();
    });

    it("does nothing when previewing between an unknown element", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      editor.previewConnectorBetween(a, "missing");
      expect(container.querySelector('[data-icad-layer="overlays"] line')).toBeNull();
    });
  });
});
