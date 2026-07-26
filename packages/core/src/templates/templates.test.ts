import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { fromIcad } from "../io/icad.js";
import { Linter } from "../linter/linter.js";
import type { SceneElement } from "../scene/types.js";
import {
  DIAGRAM_TEMPLATES,
  createTemplateDocument,
  type DiagramTemplateId,
} from "./templates.js";

const catalogPin = { id: "ibm-cloud", version: "2.0.0" };

function catalogFor(elements: SceneElement[]): Catalog {
  const iconRefs = [
    ...new Set(
      elements.flatMap((element) =>
        element.type === "iconNode" ? [element.catalogRef] : [],
      ),
    ),
  ];
  const manifest: CatalogManifest = {
    ...catalogPin,
    categories: [{ id: "template", name: "Template" }],
    icons: iconRefs.map((id) => ({
      id,
      name: id,
      category: "template",
      semantic: "node",
      container: "square",
      asset: id,
      keywords: [],
      tier: "ibm-cloud",
    })),
  };
  return new Catalog(
    manifest,
    new Map(iconRefs.map((id) => [id, '<path d="M0 0h20v20H0z" />'])),
  );
}

describe("diagram templates", () => {
  it("publishes the four IBM diagram-level choices", () => {
    expect(DIAGRAM_TEMPLATES.map((template) => template.id)).toEqual([
      "blank",
      "system-context",
      "high-level",
      "detailed",
    ]);
  });

  it.each(DIAGRAM_TEMPLATES.map((template) => template.id))(
    "builds a structurally valid, serializable %s document",
    (templateId) => {
      const doc = createTemplateDocument(templateId, {
        catalog: catalogPin,
        theme: "dark",
        now: "2026-07-23T00:00:00.000Z",
      });
      const scene = fromIcad(doc);
      const ids = new Set(scene.all().map((element) => element.id));

      expect(doc.meta.diagramLevel).toBe(templateId);
      expect(doc.meta.title).not.toContain("/");
      expect(doc.canvas.theme).toBe("dark");
      expect(scene.all()).toEqual(doc.elements);
      for (const element of scene.all()) {
        if (element.parentId) expect(ids.has(element.parentId)).toBe(true);
        if (element.type === "connector") {
          expect(ids.has(element.from.elementId)).toBe(true);
          expect(ids.has(element.to.elementId)).toBe(true);
          expect(element.waypoints).toBeDefined();
        }
      }
    },
  );

  it.each([
    "system-context",
    "high-level",
    "detailed",
  ] satisfies DiagramTemplateId[])(
    "seeds an on-spec %s architecture inside a named frame",
    (templateId) => {
      const doc = createTemplateDocument(templateId, {
        catalog: catalogPin,
        now: "2026-07-23T00:00:00.000Z",
      });
      const scene = fromIcad(doc);
      const frames = scene.all().filter((element) => element.type === "frame");

      expect(frames).toHaveLength(1);
      expect(frames[0]?.name).toBeTruthy();
      expect(scene.all().some((element) => element.type === "connector")).toBe(
        true,
      );
      expect(
        new Linter({ catalog: catalogFor(scene.all()) }).run(scene),
      ).toEqual([]);
    },
  );

  it("keeps blank genuinely empty", () => {
    expect(
      createTemplateDocument("blank", {
        catalog: catalogPin,
        now: "2026-07-23T00:00:00.000Z",
      }).elements,
    ).toEqual([]);
  });
});
