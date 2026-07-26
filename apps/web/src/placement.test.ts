import { beforeEach, describe, expect, it } from "vitest";
import {
  Catalog,
  createEditor,
  type CatalogManifest,
  type Editor,
} from "@icad/core";
import { confirmedContainerPresets, type LibraryPlacement } from "@icad/ui-web";
import { placeLibraryItem } from "./placement";

const manifest: CatalogManifest = {
  id: "test",
  version: "1",
  categories: [{ id: "compute", name: "Compute" }],
  icons: [
    {
      id: "test/server",
      name: "Server",
      category: "compute",
      semantic: "node",
      container: "square",
      asset: "server.svg",
    },
    {
      id: "test/user",
      name: "User",
      category: "compute",
      semantic: "actor",
      container: "rounded",
      asset: "user.svg",
    },
  ],
};

describe("library placement", () => {
  let editor: Editor;

  beforeEach(() => {
    document.body.innerHTML = '<div id="canvas"></div>';
    editor = createEditor({
      container: document.querySelector("#canvas")!,
      catalog: new Catalog(manifest, new Map()),
    });
  });

  it("centers an icon at the chosen point and selects the correct semantic API", () => {
    const icon = manifest.icons[0]!;
    const id = placeLibraryItem(
      editor,
      { type: "icon", icon },
      { x: 100, y: 100 },
    );
    expect(editor.scene.get(id)).toMatchObject({
      type: "iconNode",
      x: 76,
      y: 76,
      catalogRef: "test/server",
    });

    const actor = manifest.icons[1]!;
    const actorId = placeLibraryItem(
      editor,
      { type: "icon", icon: actor },
      { x: 180, y: 100 },
    );
    expect(editor.scene.get(actorId)).toMatchObject({
      type: "actor",
      catalogRef: "test/user",
    });
  });

  it("automatically contains a placed icon and preserves the 16px inset", () => {
    const parentId = editor.addBox({ at: { x: 20, y: 20 }, w: 300, h: 220 });
    const id = placeLibraryItem(
      editor,
      { type: "icon", icon: manifest.icons[0]! },
      { x: 25, y: 25 },
    );
    expect(editor.scene.get(id)).toMatchObject({ parentId, x: 36, y: 36 });
  });

  it("applies preset label, color, kind, and corner glyph in one add command", () => {
    const placement: LibraryPlacement = {
      type: "preset",
      preset: {
        id: "cloud",
        name: "IBM Cloud",
        kind: "box",
        color: "#1192e8",
        cornerIcon: "test/server",
      },
    };
    const id = placeLibraryItem(editor, placement, { x: 200, y: 160 });
    expect(editor.scene.get(id)).toMatchObject({
      type: "box",
      label: { text: "IBM Cloud" },
      style: { stroke: "#1192e8" },
      catalogRef: "test/server",
    });
    expect(editor.commands.canUndo()).toBe(true);
    editor.commands.undo();
    expect(editor.scene.get(id)).toBeUndefined();
  });

  it("places a named top-level frame through the library", () => {
    const parentId = editor.addBox({ at: { x: 0, y: 0 }, w: 1200, h: 900 });
    const id = placeLibraryItem(
      editor,
      { type: "primitive", kind: "frame" },
      { x: 600, y: 450 },
    );

    expect(editor.scene.get(id)).toMatchObject({
      type: "frame",
      name: "Untitled frame",
      order: 1,
      x: 200,
      y: 200,
      w: 800,
      h: 500,
    });
    expect(editor.scene.get(id)?.parentId).toBeUndefined();
    expect(editor.scene.get(parentId)?.type).toBe("box");
  });

  it("contains later placements inside a frame with the standard inset", () => {
    const frameId = editor.addFrame({
      at: { x: 20, y: 20 },
      w: 800,
      h: 500,
      name: "Overview",
    });
    const id = placeLibraryItem(
      editor,
      { type: "icon", icon: manifest.icons[0]! },
      { x: 25, y: 25 },
    );

    expect(editor.scene.get(id)).toMatchObject({
      parentId: frameId,
      x: 36,
      y: 36,
    });
  });

  // Regression test: "Availability zone" was the one confirmed preset missing a `cornerIcon` —
  // every sibling preset (IBM Cloud, Public Network, OpenShift, Region, VPC) has one, so it silently
  // placed with no corner glyph at all instead of an oversight anyone would notice from the data
  // alone. Asserting this over the whole list, not just availability-zone, so any future preset
  // added without an icon fails loudly instead of shipping invisible.
  it("gives every confirmed container preset a corner icon", () => {
    for (const preset of confirmedContainerPresets) {
      expect(
        preset.cornerIcon,
        `expected "${preset.id}" to have a cornerIcon`,
      ).toBeTruthy();
    }
  });
});
