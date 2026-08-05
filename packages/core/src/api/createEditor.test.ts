import { beforeEach, describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { moveElements } from "../commands/commands.js";
import {
  createEditor,
  ExportBlockedError,
  type Editor,
} from "./createEditor.js";

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
  const assets = new Map([
    ["vpc", '<rect width="20" height="20" fill="#0f62fe" />'],
  ]);
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
    expect(editor.scene.get(id)).toMatchObject({
      type: "box",
      semantic: "deployedOn",
    });
    expect(
      container.querySelector(`[data-icad-id="${id}"][data-icad-type="box"]`),
    ).not.toBeNull();
  });

  it("adds a catalog icon and renders its glyph", () => {
    const id = editor.addIcon("test/vpc", { at: { x: 40, y: 40 } });
    expect(editor.scene.get(id)).toMatchObject({
      type: "iconNode",
      catalogRef: "test/vpc",
    });
    expect(
      container.querySelector(`[data-icad-id="${id}"] svg rect`),
    ).not.toBeNull();
  });

  it("throws when adding an unknown catalog icon", () => {
    expect(() =>
      editor.addIcon("does/not-exist", { at: { x: 0, y: 0 } }),
    ).toThrow(/Unknown catalog icon/);
  });

  it("adds a text element and renders its content", () => {
    const id = editor.addText({
      at: { x: 10, y: 10 },
      text: "Payments platform",
    });
    expect(editor.scene.get(id)).toMatchObject({
      type: "text",
      text: "Payments platform",
    });
    expect(
      container.querySelector(`[data-icad-id="${id}"] text`)?.textContent,
    ).toBe("Payments platform");
  });

  it("auto-sizes a new text element's width from its actual string, not a flat default (M27.4)", () => {
    const short = editor.addText({ at: { x: 0, y: 0 }, text: "OK" });
    const long = editor.addText({
      at: { x: 0, y: 100 },
      text: "A much longer label describing this component in detail",
    });
    const shortW = (editor.scene.get(short) as { w: number }).w;
    const longW = (editor.scene.get(long) as { w: number }).w;
    expect(longW).toBeGreaterThan(shortW);
  });

  it("still honors an explicit w/h override for a new text element", () => {
    const id = editor.addText({
      at: { x: 0, y: 0 },
      text: "OK",
      w: 300,
      h: 40,
    });
    expect(editor.scene.get(id)).toMatchObject({ w: 300, h: 40 });
  });

  it("adds named frames with presentation order through the public API", () => {
    const overview = editor.addFrame({
      at: { x: 0, y: 0 },
      w: 600,
      h: 400,
      name: "Overview",
    });
    const deployment = editor.addFrame({
      at: { x: 700, y: 0 },
      w: 600,
      h: 400,
      name: "Deployment",
    });

    expect(editor.scene.get(overview)).toMatchObject({
      type: "frame",
      order: 1,
    });
    expect(editor.scene.get(deployment)).toMatchObject({
      type: "frame",
      order: 2,
    });
    expect(
      container.querySelector(`[data-icad-id="${overview}"] text`)?.textContent,
    ).toBe("Overview");
  });

  it("reorders every frame as one undoable operation", () => {
    const overview = editor.addFrame({ at: { x: 0, y: 0 }, name: "Overview" });
    const deployment = editor.addFrame({
      at: { x: 900, y: 0 },
      name: "Deployment",
    });

    editor.reorderFrames([deployment, overview]);
    expect(editor.scene.get(deployment)).toMatchObject({ order: 1 });
    expect(editor.scene.get(overview)).toMatchObject({ order: 2 });

    editor.commands.undo();
    expect(editor.scene.get(overview)).toMatchObject({ order: 1 });
    expect(editor.scene.get(deployment)).toMatchObject({ order: 2 });
    expect(() => editor.reorderFrames([overview])).toThrow(
      /every frame exactly once/,
    );
  });

  it("starts a template document and clears history from the replaced document", () => {
    editor.addBox({ at: { x: 0, y: 0 }, label: "Old document" });
    expect(editor.commands.canUndo()).toBe(true);

    editor.newDocument("system-context");

    expect(editor.scene.meta.diagramLevel).toBe("system-context");
    expect(editor.scene.all().some((element) => element.type === "frame")).toBe(
      true,
    );
    expect(editor.commands.canUndo()).toBe(false);
    expect(editor.selection.get()).toEqual([]);
  });

  it("moves a box's contents along with it (move-with)", () => {
    const parent = editor.addBox({ at: { x: 0, y: 0 }, label: "Subnet" });
    const child = editor.addIcon("test/vpc", {
      at: { x: 20, y: 20 },
      parentId: parent,
    });

    editor.commands.dispatch(moveElements(editor.scene, [parent], 50, 30));

    expect(editor.scene.get(parent)).toMatchObject({ x: 50, y: 30 });
    expect(editor.scene.get(child)).toMatchObject({ x: 70, y: 50 });
  });

  it("edits inspector properties as one undoable move-with operation", () => {
    const parent = editor.addBox({ at: { x: 0, y: 0 }, label: "Subnet" });
    const child = editor.addIcon("test/vpc", {
      at: { x: 20, y: 20 },
      parentId: parent,
    });

    editor.updateElementProperties(parent, {
      x: 80,
      y: 40,
      w: 300,
      label: { text: "Application subnet" },
    });

    expect(editor.scene.get(parent)).toMatchObject({
      x: 80,
      y: 40,
      w: 300,
      label: { text: "Application subnet" },
    });
    expect(editor.scene.get(child)).toMatchObject({ x: 100, y: 60 });

    editor.commands.undo();
    expect(editor.scene.get(parent)).toMatchObject({
      x: 0,
      y: 0,
      w: 240,
      label: { text: "Subnet" },
    });
    expect(editor.scene.get(child)).toMatchObject({ x: 20, y: 20 });
  });

  it("reroutes an attached automatic connector after an inspector resize", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connectorId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
    );

    editor.updateElementProperties(a, { h: 400 });

    expect(editor.scene.get(a)).toMatchObject({ h: 400 });
    expect(
      (editor.scene.get(connectorId) as { waypoints?: unknown[] }).waypoints
        ?.length,
    ).toBeGreaterThan(0);
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
    expect(() => editor.setElementParent(child, nonContainer)).toThrow(
      /cannot contain/,
    );
  });

  it("re-derives the old parent's aria-owns/child count and the moved container's own alternating fill on reparent (M17.6 fix)", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 300, h: 300, label: "a" });
    const b = editor.addBox({
      at: { x: 20, y: 20 },
      w: 200,
      h: 200,
      parentId: a,
      label: "b",
    });
    const c = editor.addBox({
      at: { x: 40, y: 40 },
      w: 100,
      h: 100,
      parentId: b,
      label: "c",
    });
    const nodeOf = (id: string) =>
      container.querySelector(`[data-icad-id="${id}"]`)!;
    // c is 2 containers deep under a (a > b > c) — an even depth, so it starts on the same
    // (non-white) fill family as "a" itself.
    const fillBefore = nodeOf(c).querySelector("rect")?.getAttribute("fill");

    editor.setElementParent(c, a); // now only 1 container deep (a > c) — depth parity flips

    // "b" no longer owns "c" — a fix regression (this used to leave "b"'s aria-owns/accessible
    // name stale, still claiming "c" as a child, since reparentElement's own "update"-reason
    // change event never repainted "b" — only "c" itself was ever `_put`).
    expect(nodeOf(b).getAttribute("aria-owns")).toBeNull();
    expect(nodeOf(b).getAttribute("aria-label")).toContain("0 elements");
    // "a" still owns "b" (never moved) and now also directly owns "c" too.
    expect(nodeOf(a).getAttribute("aria-owns")?.split(" ")).toEqual(
      expect.arrayContaining([b, c]),
    );

    // "c" itself re-renders at its new (odd) depth, flipping its alternating fill.
    const fillAfter = nodeOf(c).querySelector("rect")?.getAttribute("fill");
    expect(fillAfter).not.toBe(fillBefore);
  });

  it("re-derives a reparented container's own descendants' fill too, not just its own (M17.7)", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 400, h: 400, label: "a" });
    const b = editor.addBox({
      at: { x: 20, y: 20 },
      w: 300,
      h: 300,
      parentId: a,
      label: "b",
    });
    const c = editor.addBox({
      at: { x: 40, y: 40 },
      w: 200,
      h: 200,
      parentId: b,
      label: "c",
    });
    const d = editor.addBox({
      at: { x: 60, y: 60 },
      w: 100,
      h: 100,
      parentId: c,
      label: "d",
    });
    const nodeOf = (id: string) =>
      container.querySelector(`[data-icad-id="${id}"]`)!;
    // "d" is 3 containers deep (a > b > c > d) before the reparent below.
    const dFillBefore = nodeOf(d).querySelector("rect")?.getAttribute("fill");

    // Reparents "c" (with "d" still nested inside it) directly under "a" — "d" itself is never
    // passed to setElementParent, but its own ancestor depth shifts from 3 to 2 as a side effect
    // of its parent "c" moving up one level.
    editor.setElementParent(c, a);

    const dFillAfter = nodeOf(d).querySelector("rect")?.getAttribute("fill");
    expect(dFillAfter).not.toBe(dFillBefore);
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
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
    );

    const polyline = container.querySelector(
      `[data-icad-id="${connId}"] polyline`,
    );
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")).toContain("100,30");
  });

  it("routes a connector around an icon placed in its path", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    editor.addIcon("test/vpc", { at: { x: 180, y: 5 } });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
    );

    expect(editor.scene.get(connId)).toMatchObject({ routing: "auto" });
    const waypoints = (editor.scene.get(connId) as { waypoints?: unknown[] })
      .waypoints;
    expect(waypoints?.length).toBeGreaterThan(0);
  });

  it("renders a dashed line and a hollow arrowhead for an implementation connector", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "implementation" },
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("stroke-dasharray")).toBe("4 3");
    expect(line?.getAttribute("marker-end")).toBe("url(#icad-arrow-hollow)");
  });

  it("colors a connection-type connector by flowColor", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", flowColor: "public" },
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("stroke")).toBe("#4376BB");
  });

  it("renders IBM endpoint dots at both ends of a bidirectional connection", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", direction: "bidirectional" },
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("marker-start")).toBe("url(#icad-dot)");
    expect(line?.getAttribute("marker-end")).toBe("url(#icad-dot)");
  });

  it("renders an IBM source dot and destination arrow for a unidirectional connection", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
      { connectorType: "connection", direction: "unidirectional" },
    );

    const line = container.querySelector(`[data-icad-id="${connId}"] polyline`);
    expect(line?.getAttribute("marker-start")).toBe("url(#icad-dot)");
    expect(line?.getAttribute("marker-end")).toBe("url(#icad-arrow)");
  });

  it("overrides the route with manual waypoints and can switch back to auto", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
    );

    editor.setConnectorWaypoints(connId, [{ x: 150, y: 200 }]);
    expect(editor.scene.get(connId)).toMatchObject({
      routing: "manual",
      waypoints: [{ x: 150, y: 200 }],
    });

    editor.commands.dispatch(moveElements(editor.scene, [b], 0, 50));
    expect(editor.scene.get(connId)).toMatchObject({
      waypoints: [{ x: 150, y: 200 }],
    });

    editor.autoRouteConnector(connId);
    const reRouted = editor.scene.get(connId) as {
      routing?: string;
      waypoints?: unknown[];
    };
    expect(reRouted.routing).toBe("auto");
    expect(reRouted.waypoints).not.toEqual([{ x: 150, y: 200 }]);
  });

  it("retargets a connector to a new endpoint and re-routes it automatically", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const c = editor.addBox({
      at: { x: 300, y: 200 },
      w: 100,
      h: 60,
      label: "C",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
    );

    // Retarget the `to` endpoint from B to C.
    editor.retargetConnector(connId, undefined, { elementId: c, port: "w" });
    const after = editor.scene.get(connId) as {
      to: { elementId: string };
      routing?: string;
    };
    expect(after.to.elementId).toBe(c);
    // Auto-routing connector should have been re-routed.
    expect(after.routing ?? "auto").toBe("auto");

    // Undo brings back the original `to`.
    editor.commands.undo();
    const restored = editor.scene.get(connId) as { to: { elementId: string } };
    expect(restored.to.elementId).toBe(b);
  });

  it("retargets a manual connector without touching its waypoints", () => {
    const a = editor.addBox({ at: { x: 0, y: 0 }, w: 100, h: 60, label: "A" });
    const b = editor.addBox({
      at: { x: 300, y: 0 },
      w: 100,
      h: 60,
      label: "B",
    });
    const c = editor.addBox({
      at: { x: 300, y: 200 },
      w: 100,
      h: 60,
      label: "C",
    });
    const connId = editor.connect(
      { elementId: a, port: "e" },
      { elementId: b, port: "w" },
    );
    const manualWps = [{ x: 150, y: 30 }];
    editor.setConnectorWaypoints(connId, manualWps);

    editor.retargetConnector(connId, undefined, { elementId: c, port: "w" });
    const after = editor.scene.get(connId) as {
      to: { elementId: string };
      routing?: string;
      waypoints?: Array<{ x: number; y: number }>;
    };
    expect(after.to.elementId).toBe(c);
    // Manual routing: waypoints unchanged.
    expect(after.routing).toBe("manual");
    expect(after.waypoints).toEqual(manualWps);
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

  it("selects validation targets and renders editor-only validation badges", async () => {
    const id = editor.addBox({ at: { x: 0, y: 0 } });
    editor.lint();
    expect(
      container.querySelector(`[data-icad-validation-badge="${id}"]`),
    ).not.toBeNull();

    editor.selection.set([id]);
    expect(
      container.querySelector('[data-icad-layer="overlays"] rect'),
    ).not.toBeNull();

    const svg = await editor.export({ format: "svg" });
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
    // Clear of the box's own default 240px width (sibling-overlap, M27.7) - this test is about
    // severity summarization machinery, not spacing, so the fixture shouldn't incidentally trip
    // an unrelated rule.
    editor.addGroup({
      at: { x: 500, y: 0 },
      label: "Security group",
      style: { dashed: false },
    });
    editor.setRuleSeverity("missing-label", "error");
    editor.setRuleSeverity("container-border", "info");

    expect(editor.complianceSummary()).toMatchObject({
      counts: { error: 1, warn: 0, info: 1 },
      blocked: false,
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
      h: 40,
    });
    editor.lint();

    const badge = container.querySelector(
      '[data-icad-validation-badge="invalid-icon"]',
    );
    expect(badge?.querySelector("circle")?.getAttribute("fill")).toBe(
      "#da1e28",
    );
    expect(badge?.querySelector("text")?.textContent).toBe("2");
  });

  it("round-trips the scene via toIcad/loadIcad", () => {
    editor.addBox({ at: { x: 5, y: 5 }, label: "VPC" });
    const doc = editor.toIcad();

    const other = createEditor({
      container: document.createElement("div"),
      catalog: testCatalog(),
    });
    other.loadIcad(doc);

    expect(other.toIcad().elements).toEqual(doc.elements);
  });

  it("exports SVG with an embedded, reopenable .icad source by default", async () => {
    editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const svg = await editor.export({ format: "svg" });
    expect(svg).toContain('id="icad:source"');
  });

  it("omits the embedded source when embedSource is false", async () => {
    editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const svg = await editor.export({ format: "svg", embedSource: false });
    expect(svg).not.toContain('id="icad:source"');
  });

  it("pins the host page's font stack onto the exported SVG root", async () => {
    document.body.appendChild(container);
    container.style.fontFamily = '"IBM Plex Sans", system-ui, sans-serif';
    editor.addBox({ at: { x: 0, y: 0 }, label: "VPC" });
    const svg = await editor.export({ format: "svg" });
    expect(svg).toContain(
      'font-family="&quot;IBM Plex Sans&quot;, system-ui, sans-serif"',
    );
    document.body.removeChild(container);
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
      const id = editor.addBox({
        at: { x: 500, y: 500 },
        w: 100,
        h: 100,
        label: "Far away",
      });
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

    it("ensureVisible pans the viewport for an off-screen element (Layers-panel selection, M24.3)", () => {
      const before = editor.viewport.get();
      const id = editor.addBox({ at: { x: 5000, y: 5000 }, label: "far away" });

      editor.ensureVisible(id);

      expect(editor.viewport.get()).not.toEqual(before);
    });

    it("ensureVisible is a no-op for an element already fully in view", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      const before = editor.viewport.get();

      editor.ensureVisible(id);

      expect(editor.viewport.get()).toEqual(before);
    });

    it("nudges every given element by the same delta, undoably", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });
      editor.nudgeElements([id], 5, -5);
      expect(editor.scene.get(id)).toMatchObject({ x: 15, y: 5 });
      editor.commands.undo();
      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 });
    });

    it("moves nested contents along when nudging a container (move-with)", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });
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

    it("grows a parent to fit a nudged child that no longer comfortably fits, as one undo step (M17.4)", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });
      const childBefore = { ...editor.scene.get(child)! };
      const parentBefore = { ...editor.scene.get(parent)! };

      editor.nudgeElements([child], 1000, 1000);

      const childAfter = editor.scene.get(child)!;
      const parentAfter = editor.scene.get(parent)!;
      expect(childAfter.x).toBe(childBefore.x + 1000);
      // The parent grew to keep the child's own 16px buffer, rather than the child getting stuck.
      expect(parentAfter.x + parentAfter.w).toBe(
        childAfter.x + childAfter.w + 16,
      );
      expect(parentAfter.y + parentAfter.h).toBe(
        childAfter.y + childAfter.h + 16,
      );
      // Its own top-left, never approached, is untouched.
      expect(parentAfter.x).toBe(parentBefore.x);
      expect(parentAfter.y).toBe(parentBefore.y);

      // One undo reverts both the child's move and the parent's grow together.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(child)).toMatchObject(childBefore);
      expect(editor.scene.get(parent)).toMatchObject(parentBefore);
    });

    it("does not grow the parent when the nudged child still comfortably fits", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });
      const parentBefore = { ...editor.scene.get(parent)! };

      editor.nudgeElements([child], 5, 5);

      expect(editor.scene.get(parent)).toMatchObject(parentBefore);
    });

    it("attempts no auto-grow for a top-level (parentless) nudge — one undo entry still", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });

      editor.nudgeElements([a, b], 1000, 1000);

      expect(editor.scene.get(a)).toMatchObject({ x: 1000, y: 1000 });
      expect(editor.scene.get(b)).toMatchObject({ x: 1200, y: 1000 });

      // Exactly one undo reverts both moves together, proving no separate auto-grow step (a no-op
      // here — there's no shared parent) was appended on top of it.
      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 });
      expect(editor.scene.get(b)).toMatchObject({ x: 200, y: 0 });
    });

    it("deletes an element and its descendants as one undoable step, then clears selection", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });
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
      expect(
        editor.scene
          .all()
          .map((el) => el.id)
          .sort(),
      ).toEqual([a, b].sort());
    });

    it("does nothing when deleting only unknown ids", () => {
      editor.deleteElements(["missing"]);
      expect(editor.commands.canUndo()).toBe(false);
    });
  });

  describe("beginInteraction (ephemeral drag preview, D26)", () => {
    it("previews a move as a DOM transform without touching the scene, then commits as one command", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });
      const node = () => container.querySelector(`[data-icad-id="${id}"]`);

      const interaction = editor.beginInteraction([id]);
      interaction.update(5, -5);

      // Preview only: the scene (and thus the box's rendered x/y) is untouched.
      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 });
      expect(node()?.getAttribute("transform")).toBe("translate(5, -5)");

      interaction.commit();

      // Committed: the scene reflects the real move and the preview transform is cleared.
      expect(editor.scene.get(id)).toMatchObject({ x: 15, y: 5 });
      expect(node()?.getAttribute("transform")).toBeNull();
      // The underlying shape's own rendered geometry moved too, not just the (now-cleared)
      // transform — proof the scoped repaint (Scene._transaction + renderElements, M16.1) actually
      // redrew this element at its committed position rather than leaving stale coordinates.
      expect(node()?.querySelector("rect")?.getAttribute("x")).toBe("15");
      expect(node()?.querySelector("rect")?.getAttribute("y")).toBe("5");

      // The whole gesture collapsed into exactly one undo step on top of the box's own add: one
      // undo reverts just the move, a second reverts the add itself — not a third, orphaned step.
      editor.commands.undo();
      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 });
      editor.commands.undo();
      expect(editor.scene.get(id)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("previews move-with: a container's descendants get the same live transform", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });

      const interaction = editor.beginInteraction([parent]);
      interaction.update(10, 10);

      expect(
        container
          .querySelector(`[data-icad-id="${parent}"]`)
          ?.getAttribute("transform"),
      ).toBe("translate(10, 10)");
      expect(
        container
          .querySelector(`[data-icad-id="${child}"]`)
          ?.getAttribute("transform"),
      ).toBe("translate(10, 10)");

      interaction.commit();
      expect(editor.scene.get(child)).toMatchObject({ x: 30, y: 30 });
    });

    it("abort discards the preview without dispatching any command", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });
      const interaction = editor.beginInteraction([id]);
      interaction.update(50, 50);

      interaction.abort();

      expect(editor.scene.get(id)).toMatchObject({ x: 10, y: 10 });
      expect(
        container
          .querySelector(`[data-icad-id="${id}"]`)
          ?.getAttribute("transform"),
      ).toBeNull();

      // A single undo removes the box's own add — proving abort() pushed nothing on top of it.
      editor.commands.undo();
      expect(editor.scene.get(id)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("commit is a no-op when the delta never left zero, or the id list was empty/unknown", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });

      const noMove = editor.beginInteraction([id]);
      noMove.commit();

      const unknown = editor.beginInteraction(["missing"]);
      unknown.update(5, 5);
      unknown.commit();

      // Neither commit() pushed a command: one undo removes only the box's own original add.
      editor.commands.undo();
      expect(editor.scene.get(id)).toBeUndefined();
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("reparents into update()'s dropTargetId on commit, growing it to fit, as one undo step (M17.6)", () => {
      const box = editor.addBox({
        at: { x: 300, y: 0 },
        w: 60,
        h: 60,
        label: "box",
      });
      const icon = editor.addIcon("test/vpc", { at: { x: 0, y: 0 } });
      const boxBefore = { ...editor.scene.get(box)! };

      const interaction = editor.beginInteraction([icon]);
      interaction.update(320, 20, box); // lands the 48x48 icon inside "box", which is too small

      interaction.commit();

      const iconAfter = editor.scene.get(icon)!;
      expect(iconAfter.parentId).toBe(box);
      expect(iconAfter).toMatchObject({ x: 320, y: 20 });
      const boxAfter = editor.scene.get(box)!;
      expect(boxAfter.w).toBeGreaterThan(boxBefore.w); // grew to keep the icon's own buffer

      editor.commands.undo();
      expect(editor.scene.get(icon)?.parentId).toBeUndefined();
      expect(editor.scene.get(icon)).toMatchObject({ x: 0, y: 0 });
      expect(editor.scene.get(box)).toMatchObject(boxBefore);
    });

    it("does not reparent when dropTargetId matches the element's own current parent", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });

      const interaction = editor.beginInteraction([child]);
      interaction.update(5, 5, parent); // "moving into" the parent it's already in

      interaction.commit();

      expect(editor.scene.get(child)).toMatchObject({
        parentId: parent,
        x: 25,
        y: 25,
      });
      // One undo reverts the whole thing back to the original add-with-parent — proving no
      // separate reparent command was pushed on top of the move.
      editor.commands.undo();
      expect(editor.scene.get(child)).toMatchObject({
        parentId: parent,
        x: 20,
        y: 20,
      });
    });

    it("also moves the element's own selection outline in lockstep during the preview", () => {
      const id = editor.addBox({ at: { x: 10, y: 10 }, label: "box" });
      editor.selection.set([id]);

      const interaction = editor.beginInteraction([id]);
      interaction.update(7, 3);

      // Both the element's own <g> and its selection-outline overlay share data-icad-id, and
      // both must carry the same live transform or the outline visibly desyncs from the shape.
      const withThatId = container.querySelectorAll(`[data-icad-id="${id}"]`);
      expect(withThatId.length).toBeGreaterThanOrEqual(2);
      withThatId.forEach((el) =>
        expect(el.getAttribute("transform")).toBe("translate(7, 3)"),
      );
    });
  });

  describe("group / ungroup", () => {
    it("groups two elements into a new Group container sized to their bounds, and selects it", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 100 },
        w: 50,
        h: 50,
        label: "b",
      });

      const groupId = editor.groupElements([a, b]);

      expect(groupId).toBeDefined();
      expect(editor.scene.get(groupId!)).toMatchObject({
        type: "group",
        semantic: "deployedTo",
      });
      expect(editor.scene.get(a)?.parentId).toBe(groupId);
      expect(editor.scene.get(b)?.parentId).toBe(groupId);
      // bbox of a (0,0,50,50) + b (200,100,50,50) is x:0 y:0 w:250 h:150, padded by 16 on each side.
      expect(editor.scene.get(groupId!)).toMatchObject({
        x: -16,
        y: -16,
        w: 282,
        h: 182,
      });
      expect(editor.selection.get()).toEqual([groupId]);
    });

    it("paints the new group behind its own members, not over them (M18.1 fix — a freshly-added group with no explicit z used to tie at 0 with everything else, and Map insertion order put it last)", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 100 },
        w: 50,
        h: 50,
        label: "b",
      });

      const groupId = editor.groupElements([a, b]);

      const order = editor.scene.all().map((el) => el.id);
      expect(order.indexOf(groupId!)).toBeLessThan(order.indexOf(a));
      expect(order.indexOf(groupId!)).toBeLessThan(order.indexOf(b));
    });

    it("nests the new group under a shared parent", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 400,
        h: 400,
        label: "parent",
      });
      const a = editor.addIcon("test/vpc", {
        at: { x: 10, y: 10 },
        parentId: parent,
      });
      const b = editor.addIcon("test/vpc", {
        at: { x: 100, y: 10 },
        parentId: parent,
      });

      const groupId = editor.groupElements([a, b]);
      expect(editor.scene.get(groupId!)?.parentId).toBe(parent);
    });

    it("defaults to canvas root when grouped elements don't share a parent", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 400,
        h: 400,
        label: "parent",
      });
      const a = editor.addIcon("test/vpc", {
        at: { x: 10, y: 10 },
        parentId: parent,
      });
      const b = editor.addBox({
        at: { x: 500, y: 0 },
        w: 50,
        h: 50,
        label: "root box",
      });

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
      const outer = editor.addBox({
        at: { x: 0, y: 0 },
        w: 400,
        h: 400,
        label: "outer",
      });
      const group = editor.addGroup({
        at: { x: 10, y: 10 },
        w: 200,
        h: 200,
        parentId: outer,
        label: "inner",
      });
      const a = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: group,
      });
      const b = editor.addIcon("test/vpc", {
        at: { x: 100, y: 20 },
        parentId: group,
      });

      editor.ungroupElement(group);

      expect(editor.scene.get(group)).toBeUndefined();
      expect(editor.scene.get(a)?.parentId).toBe(outer);
      expect(editor.scene.get(b)?.parentId).toBe(outer);
      expect(editor.selection.get().sort()).toEqual([a, b].sort());
    });

    it("ungroups a root-level container to canvas root", () => {
      const group = editor.addGroup({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "group",
      });
      const a = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: group,
      });

      editor.ungroupElement(group);
      expect(editor.scene.get(a)?.parentId).toBeUndefined();
    });

    it("undoes an ungroup as a single step", () => {
      const group = editor.addGroup({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "group",
      });
      const a = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: group,
      });

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

  describe("z-order (M18.1, docs/10-canvas-parity-plan.md)", () => {
    function paintOrderIds(): string[] {
      return editor.scene.all().map((el) => el.id);
    }

    function domOrder(): (string | null)[] {
      const layer = container.querySelector('[data-icad-layer="elements"]')!;
      return [...layer.children].map((child) =>
        child.getAttribute("data-icad-id"),
      );
    }

    it("bringToFront/sendToBack/bringForward/sendBackward reorder within a sibling bracket, and undo restores exactly", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 100, y: 0 }, label: "b" });
      const c = editor.addBox({ at: { x: 200, y: 0 }, label: "c" });
      expect(paintOrderIds()).toEqual([a, b, c]);

      expect(editor.bringToFront([a])).toBe(true);
      expect(paintOrderIds()).toEqual([b, c, a]);
      editor.commands.undo();
      expect(paintOrderIds()).toEqual([a, b, c]);

      expect(editor.sendToBack([c])).toBe(true);
      expect(paintOrderIds()).toEqual([c, a, b]);
      editor.commands.undo();
      expect(paintOrderIds()).toEqual([a, b, c]);

      expect(editor.bringForward([a])).toBe(true);
      expect(paintOrderIds()).toEqual([b, a, c]);
      editor.commands.undo();
      expect(paintOrderIds()).toEqual([a, b, c]);

      expect(editor.sendBackward([c])).toBe(true);
      expect(paintOrderIds()).toEqual([a, c, b]);
      editor.commands.undo();
      expect(paintOrderIds()).toEqual([a, b, c]);
    });

    it("scopes to siblings — reordering inside one container never reorders an unrelated sibling container's own children", () => {
      const left = editor.addBox({ at: { x: 0, y: 0 }, w: 200, h: 200 });
      const right = editor.addBox({ at: { x: 300, y: 0 }, w: 200, h: 200 });
      const leftA = editor.addIcon("test/vpc", {
        at: { x: 10, y: 10 },
        parentId: left,
      });
      const leftB = editor.addIcon("test/vpc", {
        at: { x: 60, y: 10 },
        parentId: left,
      });
      const rightA = editor.addIcon("test/vpc", {
        at: { x: 310, y: 10 },
        parentId: right,
      });

      editor.bringToFront([leftA]);

      const order = paintOrderIds();
      expect(order.indexOf(leftB)).toBeLessThan(order.indexOf(leftA));
      // "right" and its own child are untouched by a bracket that doesn't include them.
      const rightOrder = editor.scene.childrenOf(right).map((el) => el.id);
      expect(rightOrder).toEqual([rightA]);
    });

    it("regression: sending a container's sibling to the back never lets that container paint after its own descendants (the dense-per-bracket-renumbering bug this design avoids)", () => {
      // Mirrors the real system-context template shape: deeply-negative-z containers nested
      // several levels deep, default-z leaves — the exact shape that broke a naive
      // "z = index within this bracket" renumbering scheme.
      const frame = editor.addFrame({ at: { x: 0, y: 0 }, name: "Frame" });
      const outer = editor.addBox({
        at: { x: 10, y: 10 },
        w: 500,
        h: 500,
        parentId: frame,
        label: "outer",
      });
      const inner = editor.addBox({
        at: { x: 20, y: 20 },
        w: 300,
        h: 300,
        parentId: outer,
        label: "inner",
      });
      const leafInInner = editor.addIcon("test/vpc", {
        at: { x: 30, y: 30 },
        parentId: inner,
      });
      const sibling = editor.addBox({
        at: { x: 400, y: 10 },
        w: 50,
        h: 50,
        parentId: frame,
        label: "sibling",
      });

      editor.sendToBack([sibling]);

      const order = paintOrderIds();
      const indexOf = (id: string) => order.indexOf(id);
      for (const [ancestor, descendant] of [
        [frame, outer],
        [frame, inner],
        [frame, leafInInner],
        [frame, sibling],
        [outer, inner],
        [outer, leafInInner],
        [inner, leafInInner],
      ]) {
        expect(indexOf(ancestor!)).toBeLessThan(indexOf(descendant!));
      }
    });

    it("multi-select spanning two different parents reorders both brackets as one undo step", () => {
      const left = editor.addBox({ at: { x: 0, y: 0 }, w: 200, h: 200 });
      const right = editor.addBox({ at: { x: 300, y: 0 }, w: 200, h: 200 });
      const leftA = editor.addIcon("test/vpc", {
        at: { x: 10, y: 10 },
        parentId: left,
      });
      const leftB = editor.addIcon("test/vpc", {
        at: { x: 60, y: 10 },
        parentId: left,
      });
      const rightA = editor.addIcon("test/vpc", {
        at: { x: 310, y: 10 },
        parentId: right,
      });
      const rightB = editor.addIcon("test/vpc", {
        at: { x: 360, y: 10 },
        parentId: right,
      });

      expect(editor.bringToFront([leftA, rightA])).toBe(true);
      const order = paintOrderIds();
      expect(order.indexOf(leftB)).toBeLessThan(order.indexOf(leftA));
      expect(order.indexOf(rightB)).toBeLessThan(order.indexOf(rightA));

      editor.commands.undo();
      expect(paintOrderIds().indexOf(leftA)).toBeLessThan(
        paintOrderIds().indexOf(leftB),
      );
      expect(paintOrderIds().indexOf(rightA)).toBeLessThan(
        paintOrderIds().indexOf(rightB),
      );
    });

    it("returns false and pushes no undo entry for an empty or unknown selection, or once nothing moves further", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      editor.addBox({ at: { x: 100, y: 0 }, label: "b" });

      expect(editor.bringToFront([])).toBe(false);
      expect(editor.bringToFront(["missing"])).toBe(false);

      // "a" is added first, so it's already at the back of a fresh bracket — but the very first
      // z op on this document still legitimately normalizes untouched z values (a real write, a
      // real undo entry). Canonicalize once so the *second* identical call is the genuine no-op.
      editor.sendToBack([a]);
      const canonicalOrder = paintOrderIds();

      expect(editor.sendToBack([a])).toBe(false);
      expect(paintOrderIds()).toEqual(canonicalOrder);

      // No undo entry was pushed for that no-op call: undoing once reverts past it, all the way
      // back to before the canonicalizing call.
      editor.commands.undo();
      expect(editor.scene.get(a)?.z).toBeUndefined();
    });

    it("reorders the live DOM to match the new paint order (command -> scene -> syncDomOrder -> DOM)", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 100, y: 0 }, label: "b" });
      const c = editor.addBox({ at: { x: 200, y: 0 }, label: "c" });
      expect(domOrder()).toEqual([a, b, c]);

      editor.bringToFront([a]);
      expect(domOrder()).toEqual([b, c, a]);
    });
  });

  describe("align (M18.2, docs/10-canvas-parity-plan.md)", () => {
    it("alignLeft/alignCenterHorizontal/alignRight/alignTop/alignMiddle/alignBottom align to the selection's own bbox edge/center, and undo restores exactly", () => {
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "a",
      });
      const b = editor.addBox({
        at: { x: 50, y: 200 },
        w: 200,
        h: 50,
        label: "b",
      });
      // overall bbox: x 0..250, y 0..250

      expect(editor.alignLeft([a, b])).toBe(true);
      expect(editor.scene.get(b)).toMatchObject({ x: 0 });
      editor.commands.undo();
      expect(editor.scene.get(b)).toMatchObject({ x: 50 });

      expect(editor.alignRight([a, b])).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ x: 150 });
      editor.commands.undo();
      expect(editor.scene.get(a)).toMatchObject({ x: 0 });

      expect(editor.alignCenterHorizontal([a, b])).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ x: 75 });
      expect(editor.scene.get(b)).toMatchObject({ x: 25 });
      editor.commands.undo();
      expect(editor.scene.get(a)).toMatchObject({ x: 0 });
      expect(editor.scene.get(b)).toMatchObject({ x: 50 });

      expect(editor.alignTop([a, b])).toBe(true);
      expect(editor.scene.get(b)).toMatchObject({ y: 0 });
      editor.commands.undo();
      expect(editor.scene.get(b)).toMatchObject({ y: 200 });

      expect(editor.alignBottom([a, b])).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ y: 150 });
      editor.commands.undo();
      expect(editor.scene.get(a)).toMatchObject({ y: 0 });

      expect(editor.alignMiddle([a, b])).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ y: 75 });
      expect(editor.scene.get(b)).toMatchObject({ y: 100 });
      editor.commands.undo();
      expect(editor.scene.get(a)).toMatchObject({ y: 0 });
      expect(editor.scene.get(b)).toMatchObject({ y: 200 });
    });

    it("moves a container's children along with it (cascade)", () => {
      const outer = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "outer",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: outer,
      });
      const solo = editor.addBox({
        at: { x: 400, y: 0 },
        w: 100,
        h: 100,
        label: "solo",
      });
      const childBefore = editor.scene.get(child)!;
      const outerBefore = editor.scene.get(outer)!;

      expect(editor.alignRight([outer, solo])).toBe(true);

      const outerAfter = editor.scene.get(outer)!;
      const childAfter = editor.scene.get(child)!;
      const dx = outerAfter.x - outerBefore.x;
      expect(dx).not.toBe(0);
      expect(childAfter.x).toBe(childBefore.x + dx);
      expect(childAfter.y).toBe(childBefore.y);
    });

    it("reroutes an attached automatic connector after an aligned endpoint moves, and undo restores its exact waypoints", () => {
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 60,
        label: "A",
      });
      const b = editor.addBox({
        at: { x: 300, y: 200 },
        w: 100,
        h: 60,
        label: "B",
      });
      const connectorId = editor.connect(
        { elementId: a, port: "e" },
        { elementId: b, port: "w" },
      );
      const before = (
        editor.scene.get(connectorId) as {
          waypoints?: Array<{ x: number; y: number }>;
        }
      ).waypoints;

      expect(editor.alignTop([a, b])).toBe(true);
      expect(editor.scene.get(b)).toMatchObject({ y: 0 });
      const after = (
        editor.scene.get(connectorId) as {
          waypoints?: Array<{ x: number; y: number }>;
        }
      ).waypoints;
      expect(after).not.toEqual(before);

      editor.commands.undo();
      expect(editor.scene.get(b)).toMatchObject({ y: 200 });
      expect(
        (
          editor.scene.get(connectorId) as {
            waypoints?: Array<{ x: number; y: number }>;
          }
        ).waypoints,
      ).toEqual(before);
    });

    it("excludes a connector from the aligned selection instead of throwing or moving it", () => {
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "a",
      });
      const b = editor.addBox({
        at: { x: 50, y: 200 },
        w: 100,
        h: 100,
        label: "b",
      });
      const connectorId = editor.connect(
        { elementId: a, port: "e" },
        { elementId: b, port: "w" },
      );

      expect(editor.alignLeft([a, b, connectorId])).toBe(true);
      expect(editor.scene.get(b)).toMatchObject({ x: 0 });
    });

    it("returns false for fewer than two alignable elements, unknown ids, or an already-aligned selection", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      expect(editor.alignLeft([a])).toBe(false);
      expect(editor.alignLeft([])).toBe(false);
      expect(editor.alignLeft(["missing"])).toBe(false);

      const b = editor.addBox({ at: { x: 0, y: 200 }, label: "b" });
      expect(editor.alignLeft([a, b])).toBe(false);
    });
  });

  describe("distribute (M18.3, docs/10-canvas-parity-plan.md)", () => {
    it("distributeHorizontal/distributeVertical space elements evenly and undo restores exactly", () => {
      // Three boxes: a at x 0 w 50, b at x 200 w 50, c at x 300 w 100
      // Horizontal: anchor a & c; gap = (300-50-50)/2 = 100; b target x = 150 → dx -50
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "a",
      });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      const c = editor.addBox({
        at: { x: 300, y: 0 },
        w: 100,
        h: 50,
        label: "c",
      });

      expect(editor.distributeHorizontal([a, b, c])).toBe(true);
      expect(editor.scene.get(a)).toMatchObject({ x: 0 }); // anchor unmoved
      expect(editor.scene.get(c)).toMatchObject({ x: 300 }); // anchor unmoved
      expect(editor.scene.get(b)).toMatchObject({ x: 150 });
      editor.commands.undo();
      expect(editor.scene.get(b)).toMatchObject({ x: 200 });

      // Vertical: same three boxes, stacked along y
      const d = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "d",
      });
      const e = editor.addBox({
        at: { x: 0, y: 200 },
        w: 50,
        h: 50,
        label: "e",
      });
      const f = editor.addBox({
        at: { x: 0, y: 300 },
        w: 50,
        h: 100,
        label: "f",
      });

      expect(editor.distributeVertical([d, e, f])).toBe(true);
      expect(editor.scene.get(d)).toMatchObject({ y: 0 });
      expect(editor.scene.get(f)).toMatchObject({ y: 300 });
      expect(editor.scene.get(e)).toMatchObject({ y: 150 });
      editor.commands.undo();
      expect(editor.scene.get(e)).toMatchObject({ y: 200 });
    });

    it("moves a container's children along with it (cascade)", () => {
      const left = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "left",
      });
      // mid is the interior (redistributed) element, not an anchor, so it actually moves.
      // Sized 100x100 so the 48x48 icon child sits fully inside it — its bbox (which is what
      // the anchor/gap math uses) stays equal to mid's own x/w rather than being stretched by
      // the child.
      const mid = editor.addBox({
        at: { x: 200, y: 0 },
        w: 100,
        h: 100,
        label: "mid",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 210, y: 10 },
        parentId: mid,
      });
      const right = editor.addBox({
        at: { x: 600, y: 0 },
        w: 100,
        h: 50,
        label: "right",
      });

      const childBefore = editor.scene.get(child)!;
      const leftBefore = editor.scene.get(left)!;
      const rightBefore = editor.scene.get(right)!;

      // left x 0 hi 50, mid x 200 hi 300, right x 600 hi 700
      // total space = 600 - 50 = 550; interior = 100 (mid); gap = (550-100)/2 = 225
      // mid target lo = 50 + 225 = 275; currently at 200 → dx = 75
      editor.distributeHorizontal([left, mid, right]);

      // left/right are anchors: not moved
      expect(editor.scene.get(left)!.x).toBe(leftBefore.x);
      expect(editor.scene.get(right)!.x).toBe(rightBefore.x);
      const midAfter = editor.scene.get(mid)!;
      const dx = midAfter.x - 200;
      expect(dx).not.toBe(0);
      // child cascades with mid by the same delta
      expect(editor.scene.get(child)!.x).toBe(childBefore.x + dx);
      expect(editor.scene.get(child)!.y).toBe(childBefore.y);
    });

    it("reroutes an attached auto-connector and undo restores its waypoints", () => {
      // b is positioned so it has a non-trivial route to a: offset on both axes so the
      // auto-router generates real waypoints, not an empty straight-line path.
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 60,
        label: "A",
      });
      const b = editor.addBox({
        at: { x: 200, y: 200 },
        w: 100,
        h: 60,
        label: "B",
      });
      const cc = editor.addBox({
        at: { x: 500, y: 200 },
        w: 100,
        h: 60,
        label: "C",
      });
      const connectorId = editor.connect(
        { elementId: a, port: "e" },
        { elementId: b, port: "w" },
      );
      const bBefore = editor.scene.get(b)!.x;
      const wpBefore = (
        editor.scene.get(connectorId) as {
          waypoints?: Array<{ x: number; y: number }>;
        }
      ).waypoints;

      expect(editor.distributeHorizontal([a, b, cc])).toBe(true);
      // b should have moved (distribute changed its x)
      const bAfter = editor.scene.get(b)!.x;
      expect(bAfter).not.toBe(bBefore);
      // connector was rerouted after b moved
      const wpAfter = (
        editor.scene.get(connectorId) as {
          waypoints?: Array<{ x: number; y: number }>;
        }
      ).waypoints;
      expect(wpAfter).not.toEqual(wpBefore);

      editor.commands.undo();
      expect(editor.scene.get(b)).toMatchObject({ x: bBefore });
      expect(
        (
          editor.scene.get(connectorId) as {
            waypoints?: Array<{ x: number; y: number }>;
          }
        ).waypoints,
      ).toEqual(wpBefore);
    });

    it("excludes a connector from the distribute set instead of throwing", () => {
      const a = editor.addBox({
        at: { x: 0, y: 0 },
        w: 50,
        h: 50,
        label: "a",
      });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      const c = editor.addBox({
        at: { x: 300, y: 0 },
        w: 100,
        h: 50,
        label: "c",
      });
      const conn = editor.connect(
        { elementId: a, port: "e" },
        { elementId: b, port: "w" },
      );
      // connector is silently excluded; three real elements remain → distributable
      expect(editor.distributeHorizontal([a, b, c, conn])).toBe(true);
    });

    it("returns false for fewer than three distributable elements or an already-even selection", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      expect(editor.distributeHorizontal([])).toBe(false);
      expect(editor.distributeHorizontal([a])).toBe(false);
      expect(editor.distributeHorizontal([a, b])).toBe(false);

      // Three elements already evenly spaced → no-op → false
      const c = editor.addBox({
        at: { x: 100, y: 0 },
        w: 50,
        h: 50,
        label: "c",
      });
      // a: 0..50, c: 100..150, b: 200..250 — gaps 50 each → already even
      expect(editor.distributeHorizontal([a, b, c])).toBe(false);
    });
  });

  describe("clipboard (M16.5, docs/10-canvas-parity-plan.md)", () => {
    it("copy then paste clones with fresh ids, offset by the paste cascade, and selects the copy", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });

      editor.copy([a]);
      const [pasted] = editor.paste();

      expect(pasted).toBeDefined();
      expect(pasted).not.toBe(a);
      expect(editor.scene.get(a)).toMatchObject({ x: 0, y: 0 }); // original untouched
      expect(editor.scene.get(pasted!)).toMatchObject({
        x: 16,
        y: 16,
        w: 50,
        h: 50,
        label: { text: "a" },
      });
      expect(editor.selection.get()).toEqual([pasted]);
    });

    it("each successive paste (no explicit point) cascades further from the original", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.copy([a]);

      const [first] = editor.paste();
      const [second] = editor.paste();

      expect(editor.scene.get(first!)).toMatchObject({ x: 16, y: 16 });
      expect(editor.scene.get(second!)).toMatchObject({ x: 32, y: 32 });
    });

    it("paste(at) centers the pasted content's combined bbox at the given point", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 40, h: 20, label: "a" });
      editor.copy([a]);

      const [pasted] = editor.paste({ x: 100, y: 100 });

      // Original bbox is (0,0,40,20), centered at (20,10) — shifting that center to (100,100)
      // moves the top-left corner to (80,90).
      expect(editor.scene.get(pasted!)).toMatchObject({ x: 80, y: 90 });
    });

    it("copying a container also copies its descendants and re-parents them under the new copy", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 100,
        h: 100,
        label: "box",
      });
      const icon = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: box,
      });

      editor.copy([box]);
      const [pastedBox] = editor.paste();

      const pastedChildren = editor.scene.childrenOf(pastedBox!);
      expect(pastedChildren).toHaveLength(1);
      expect(pastedChildren[0]!.id).not.toBe(icon);
      expect(pastedChildren[0]).toMatchObject({ x: 36, y: 36 }); // 20+16
      // Original subtree is completely untouched.
      expect(editor.scene.get(icon)).toMatchObject({
        x: 20,
        y: 20,
        parentId: box,
      });
    });

    it("copies a connector between two copied elements, remapped to the new pair", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      const connId = editor.connectNearest(a, b)!;

      editor.copy([a, b]);
      const [pastedA, pastedB] = editor.paste();

      const pastedConnectors = editor.scene
        .all()
        .filter((el) => el.type === "connector" && el.id !== connId);
      expect(pastedConnectors).toHaveLength(1);
      expect(pastedConnectors[0]).toMatchObject({
        from: { elementId: pastedA },
        to: { elementId: pastedB },
      });
    });

    it("excludes a connector with only one endpoint in the copied set", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.connectNearest(a, b);

      editor.copy([a]); // b, and the connector to it, are left out
      const pasted = editor.paste();

      expect(pasted).toHaveLength(1); // just the copy of `a`, no connector
    });

    it("copying a child without its container keeps the copy parented to the same original container", () => {
      const box = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "box",
      });
      const icon = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: box,
      });

      editor.copy([icon]); // box itself isn't copied
      const [pastedIcon] = editor.paste();

      expect(editor.scene.get(pastedIcon!)?.parentId).toBe(box);
    });

    it("paste is undoable as a single step", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.copy([a]);
      const [pasted] = editor.paste();

      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(pasted!)).toBeUndefined();
      expect(editor.scene.get(a)).toBeDefined(); // the original, from before copy, is untouched
    });

    it("cut copies then removes the originals as one undoable step", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });

      editor.cut([a]);

      expect(editor.scene.get(a)).toBeUndefined();
      const [pasted] = editor.paste();
      expect(editor.scene.get(pasted!)).toMatchObject({ x: 16, y: 16 });

      // One undo restores `a` (the cut), independent of the paste dispatched afterward.
      editor.commands.undo(); // undoes the paste
      expect(editor.commands.undo()).toBe(true); // undoes the cut
      expect(editor.scene.get(a)).toBeDefined();
    });

    it("paste is a no-op with nothing copied yet", () => {
      expect(editor.paste()).toEqual([]);
      expect(editor.commands.canUndo()).toBe(false);
    });

    it("copy/cut with no existing ids is a no-op and leaves any prior clipboard intact", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      editor.copy([a]);

      expect(editor.copy(["missing"])).toEqual([]);
      expect(editor.cut(["missing"])).toEqual([]);

      const [pasted] = editor.paste();
      expect(editor.scene.get(pasted!)).toMatchObject({
        x: 16,
        y: 16,
        label: { text: "a" },
      });
    });

    it("duplicateElements clones in place without touching the pending clipboard", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 200, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.copy([b]); // pending clipboard, unrelated to the duplicate below

      const [duplicated] = editor.duplicateElements([a]);

      expect(duplicated).not.toBe(a);
      expect(editor.scene.get(duplicated!)).toMatchObject({ x: 16, y: 16 });
      expect(editor.selection.get()).toEqual([duplicated]);

      // The clipboard from the earlier copy([b]) is untouched — paste() still yields a copy of b.
      const [pastedB] = editor.paste();
      expect(editor.scene.get(pastedB!)).toMatchObject({ x: 216, y: 16 });
    });

    it("duplicateElements is undoable as a single step", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const [duplicated] = editor.duplicateElements([a]);

      expect(editor.commands.undo()).toBe(true);
      expect(editor.scene.get(duplicated!)).toBeUndefined();
      expect(editor.scene.get(a)).toBeDefined();
    });
  });

  describe("connectNearest", () => {
    it("connects two elements using a port pair inferred from their relative position", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 300, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });

      const connId = editor.connectNearest(a, b);

      expect(connId).toBeDefined();
      expect(editor.scene.get(connId!)).toMatchObject({
        type: "connector",
        from: { elementId: a, port: "e" },
        to: { elementId: b, port: "w" },
      });
      expect(editor.selection.get()).toEqual([connId]);
    });

    it("passes through connector type/direction/flowColor options", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      const b = editor.addBox({ at: { x: 300, y: 0 }, label: "b" });
      const connId = editor.connectNearest(a, b, {
        connectorType: "dependency",
      });
      expect(editor.scene.get(connId!)).toMatchObject({
        connectorType: "dependency",
      });
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
      expect(
        container.querySelector(`[data-icad-port^="${a}:"]`),
      ).not.toBeNull();
      editor.setHoveredElement(undefined);
      expect(container.querySelector(`[data-icad-port^="${a}:"]`)).toBeNull();
    });

    it("draws a connector preview snapped to the nearest ports between two elements", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, w: 50, h: 50, label: "a" });
      const b = editor.addBox({
        at: { x: 300, y: 0 },
        w: 50,
        h: 50,
        label: "b",
      });
      editor.previewConnectorBetween(a, b);

      const line = container.querySelector(
        '[data-icad-layer="overlays"] line',
      )!;
      expect(line.getAttribute("x1")).toBe("50"); // a's east port
      expect(line.getAttribute("x2")).toBe("300"); // b's west port
    });

    it("draws a connector preview at arbitrary points for a mouse drag in progress", () => {
      editor.setConnectorDraftPoints({ x: 5, y: 5 }, { x: 40, y: 60 });
      const line = container.querySelector(
        '[data-icad-layer="overlays"] line',
      )!;
      expect(line.getAttribute("x2")).toBe("40");
      expect(line.getAttribute("y2")).toBe("60");
    });

    it("clears the connector draft", () => {
      editor.setConnectorDraftPoints({ x: 0, y: 0 }, { x: 1, y: 1 });
      editor.clearConnectorDraft();
      expect(
        container.querySelector('[data-icad-layer="overlays"] line'),
      ).toBeNull();
    });

    it("does nothing when previewing between an unknown element", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 }, label: "a" });
      editor.previewConnectorBetween(a, "missing");
      expect(
        container.querySelector('[data-icad-layer="overlays"] line'),
      ).toBeNull();
    });
  });

  describe("lock / hide (M18.4, docs/10-canvas-parity-plan.md)", () => {
    it("lockElements sets locked:true, prevents a second lock from pushing an undo entry, and undo restores exactly", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      expect(editor.scene.get(id)?.locked).toBeUndefined();

      expect(editor.lockElements([id])).toBe(true);
      expect(editor.scene.get(id)?.locked).toBe(true);

      // Already locked → no-op, returns false, no undo entry pushed.
      expect(editor.lockElements([id])).toBe(false);

      editor.commands.undo();
      expect(editor.scene.get(id)?.locked).toBeUndefined();
    });

    it("unlockElements removes locked field and undo restores it", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      editor.lockElements([id]);
      expect(editor.scene.get(id)?.locked).toBe(true);

      expect(editor.unlockElements([id])).toBe(true);
      expect(editor.scene.get(id)?.locked).toBeUndefined();

      editor.commands.undo();
      expect(editor.scene.get(id)?.locked).toBe(true);
    });

    it("hideElements / showElements toggle hidden with undo", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      expect(editor.scene.get(id)?.hidden).toBeUndefined();

      expect(editor.hideElements([id])).toBe(true);
      expect(editor.scene.get(id)?.hidden).toBe(true);

      // Already hidden → no-op.
      expect(editor.hideElements([id])).toBe(false);

      expect(editor.showElements([id])).toBe(true);
      expect(editor.scene.get(id)?.hidden).toBeUndefined();

      editor.commands.undo(); // undo showElements
      expect(editor.scene.get(id)?.hidden).toBe(true);

      editor.commands.undo(); // undo hideElements
      expect(editor.scene.get(id)?.hidden).toBeUndefined();
    });

    it("cascades lock/hide to all descendants", () => {
      const parent = editor.addBox({
        at: { x: 0, y: 0 },
        w: 200,
        h: 200,
        label: "parent",
      });
      const child = editor.addIcon("test/vpc", {
        at: { x: 20, y: 20 },
        parentId: parent,
      });

      editor.lockElements([parent]);
      expect(editor.scene.get(parent)?.locked).toBe(true);
      expect(editor.scene.get(child)?.locked).toBe(true);

      editor.hideElements([parent]);
      expect(editor.scene.get(parent)?.hidden).toBe(true);
      expect(editor.scene.get(child)?.hidden).toBe(true);

      editor.commands.undo(); // undo hide — child hidden goes away too
      expect(editor.scene.get(child)?.hidden).toBeUndefined();

      editor.commands.undo(); // undo lock — child locked goes away too
      expect(editor.scene.get(child)?.locked).toBeUndefined();
    });

    it("returns false for an empty or unknown selection", () => {
      expect(editor.lockElements([])).toBe(false);
      expect(editor.lockElements(["missing"])).toBe(false);
      expect(editor.unlockElements([])).toBe(false);
      expect(editor.hideElements([])).toBe(false);
      expect(editor.showElements(["missing"])).toBe(false);
    });

    it("renders a hidden element at reduced opacity", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      editor.hideElements([id]);
      const node = container.querySelector(`[data-icad-id="${id}"]`);
      expect(node?.getAttribute("opacity")).toBe("0.3");

      editor.showElements([id]);
      expect(node?.getAttribute("opacity")).toBeNull();
    });

    it("sets data-icad-locked attribute on a locked element", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "box" });
      editor.lockElements([id]);
      const node = container.querySelector(`[data-icad-id="${id}"]`);
      expect(node?.getAttribute("data-icad-locked")).toBe("true");

      editor.unlockElements([id]);
      expect(node?.getAttribute("data-icad-locked")).toBeNull();
    });

    it("locked+hidden state suffix appears in accessible name", () => {
      const id = editor.addBox({ at: { x: 0, y: 0 }, label: "MyBox" });
      editor.lockElements([id]);
      const node = container.querySelector(`[data-icad-id="${id}"]`);
      expect(node?.getAttribute("aria-label")).toContain("locked");

      editor.hideElements([id]);
      expect(node?.getAttribute("aria-label")).toContain("locked, hidden");
    });
  });

  describe("applyBatch", () => {
    it("applies a mixed add+connect batch as one undo step", () => {
      expect(editor.commands.canUndo()).toBe(false);
      const before = editor.scene.all().length;

      const result = editor.applyBatch([
        { kind: "add_box", id: "box-a", at: { x: 0, y: 0 } },
        {
          kind: "add_icon",
          id: "icon-a",
          catalogRef: "test/vpc",
          at: { x: 20, y: 20 },
          parentId: "box-a",
        },
        { kind: "add_box", id: "box-b", at: { x: 300, y: 0 } },
        {
          kind: "add_icon",
          id: "icon-b",
          catalogRef: "test/vpc",
          at: { x: 320, y: 20 },
          parentId: "box-b",
        },
        { kind: "connect_nearest", fromId: "icon-a", toId: "icon-b" },
      ]);

      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error("unreachable");
      expect(result.results).toHaveLength(5);
      expect(editor.scene.all().length).toBe(before + 5);
      expect(editor.commands.canUndo()).toBe(true);

      editor.commands.undo();
      expect(editor.scene.all().length).toBe(before);
    });

    it("connect_nearest resolves ids created earlier in the same batch and routes around an obstacle also from this batch", () => {
      const result = editor.applyBatch([
        { kind: "add_box", id: "obstacle", at: { x: 140, y: 0 }, w: 40, h: 60 },
        {
          kind: "add_icon",
          id: "source",
          catalogRef: "test/vpc",
          at: { x: 0, y: 0 },
        },
        {
          kind: "add_icon",
          id: "target",
          catalogRef: "test/vpc",
          at: { x: 300, y: 0 },
        },
        { kind: "connect_nearest", fromId: "source", toId: "target" },
      ]);
      expect(result.applied).toBe(true);
      const connector = editor.scene
        .all()
        .find((el) => el.type === "connector");
      expect(connector).toBeDefined();
      expect((connector as { waypoints?: unknown[] }).waypoints).toBeDefined();
    });

    it("resolves a connect op referencing an element that existed before the batch", () => {
      const preExisting = editor.addBox({ at: { x: 0, y: 0 } });
      const result = editor.applyBatch([
        { kind: "add_box", id: "new-box", at: { x: 300, y: 0 } },
        {
          kind: "connect",
          from: { elementId: preExisting, port: "e" },
          to: { elementId: "new-box", port: "w" },
        },
      ]);
      expect(result.applied).toBe(true);
    });

    it("rejects an explicit id colliding with a pre-existing element, leaving it untouched", () => {
      const existingId = editor.addBox({
        at: { x: 0, y: 0 },
        label: "original",
      });
      const result = editor.applyBatch([
        {
          kind: "add_box",
          id: existingId,
          at: { x: 300, y: 0 },
          label: "collides",
        },
      ]);
      expect(result.applied).toBe(false);
      expect(editor.scene.get(existingId)).toMatchObject({
        label: { text: "original" },
      });
    });

    it("rejects an explicit id reused twice within the same batch", () => {
      const result = editor.applyBatch([
        { kind: "add_box", id: "dup", at: { x: 0, y: 0 } },
        { kind: "add_box", id: "dup", at: { x: 300, y: 0 } },
      ]);
      expect(result.applied).toBe(false);
    });

    it("rejects a connect op referencing an unknown id", () => {
      const result = editor.applyBatch([
        {
          kind: "connect",
          from: { elementId: "nope", port: "e" },
          to: { elementId: "also-nope", port: "w" },
        },
      ]);
      expect(result.applied).toBe(false);
      if (result.applied) throw new Error("unreachable");
      expect(result.errors[0]?.message).toMatch(/Unknown element/);
    });

    it("rejects connect_nearest self-connect and connector-as-endpoint", () => {
      const a = editor.addBox({ at: { x: 0, y: 0 } });
      const selfConnect = editor.applyBatch([
        { kind: "connect_nearest", fromId: a, toId: a },
      ]);
      expect(selfConnect.applied).toBe(false);

      const b = editor.addBox({ at: { x: 300, y: 0 } });
      const connId = editor.connectNearest(a, b)!;
      const c = editor.addBox({ at: { x: 0, y: 300 } });
      const connectorEndpoint = editor.applyBatch([
        { kind: "connect_nearest", fromId: connId, toId: c },
      ]);
      expect(connectorEndpoint.applied).toBe(false);
    });

    it("rejects an unknown catalogRef on an add_icon op", () => {
      const result = editor.applyBatch([
        {
          kind: "add_icon",
          catalogRef: "does/not-exist",
          at: { x: 0, y: 0 },
        },
      ]);
      expect(result.applied).toBe(false);
      if (result.applied) throw new Error("unreachable");
      expect(result.errors[0]?.message).toMatch(/Unknown catalog icon/);
    });

    it("is all-or-nothing: one bad op invalidates the whole batch, nothing leaked", () => {
      const before = editor.scene.all().length;
      const canUndoBefore = editor.commands.canUndo();

      const result = editor.applyBatch([
        { kind: "add_box", id: "ok-1", at: { x: 0, y: 0 } },
        { kind: "add_box", id: "ok-2", at: { x: 100, y: 0 } },
        { kind: "add_box", id: "ok-3", at: { x: 200, y: 0 } },
        {
          kind: "connect",
          from: { elementId: "unknown-from", port: "e" },
          to: { elementId: "ok-1", port: "w" },
        },
        { kind: "add_box", id: "ok-4", at: { x: 300, y: 0 } },
        { kind: "add_box", id: "ok-5", at: { x: 400, y: 0 } },
      ]);

      expect(result.applied).toBe(false);
      expect(editor.scene.all().length).toBe(before);
      expect(editor.commands.canUndo()).toBe(canUndoBefore);
    });

    it("collects every failing op, not just the first", () => {
      const result = editor.applyBatch([
        {
          kind: "add_icon",
          catalogRef: "does/not-exist-1",
          at: { x: 0, y: 0 },
        },
        { kind: "add_box", id: "ok", at: { x: 0, y: 0 } },
        {
          kind: "add_icon",
          catalogRef: "does/not-exist-2",
          at: { x: 100, y: 0 },
        },
      ]);
      expect(result.applied).toBe(false);
      if (result.applied) throw new Error("unreachable");
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map((e) => e.index)).toEqual([0, 2]);
    });

    it("gives two add_frame ops with no explicit order distinct sequential orders", () => {
      const result = editor.applyBatch([
        { kind: "add_frame", id: "frame-a", at: { x: 0, y: 0 }, name: "A" },
        { kind: "add_frame", id: "frame-b", at: { x: 0, y: 0 }, name: "B" },
      ]);
      expect(result.applied).toBe(true);
      const a = editor.scene.get("frame-a") as { order: number };
      const b = editor.scene.get("frame-b") as { order: number };
      expect(a.order).not.toBe(b.order);
    });

    it("is a no-op success for an empty batch, with no new undo entry", () => {
      const canUndoBefore = editor.commands.canUndo();
      const result = editor.applyBatch([]);
      expect(result).toEqual({ applied: true, results: [] });
      expect(editor.commands.canUndo()).toBe(canUndoBefore);
    });
  });
});
