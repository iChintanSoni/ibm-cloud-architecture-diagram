import { describe, expect, it } from "vitest";
import { Catalog } from "../catalog/catalog.js";
import type { CatalogManifest } from "../catalog/types.js";
import { fromIcad } from "../io/icad.js";
import { Linter } from "../linter/linter.js";
import type { SceneElement } from "../scene/types.js";
import { REFERENCE_ARCHITECTURE_TEMPLATES } from "./referenceArchitectures.js";
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

  it.each([
    "system-context",
    "high-level",
    "detailed",
  ] satisfies DiagramTemplateId[])(
    "seedExampleContent: false keeps %s's diagramLevel meta but skips the worked example",
    (templateId) => {
      const doc = createTemplateDocument(templateId, {
        catalog: catalogPin,
        now: "2026-07-23T00:00:00.000Z",
        seedExampleContent: false,
      });
      expect(doc.meta.diagramLevel).toBe(templateId);
      expect(doc.elements).toEqual([]);
    },
  );
});

describe("reference architecture templates (docs/00-decision-log.md#d30)", () => {
  it("publishes the four IKS/ROKS Single Region Multi-Zone choices", () => {
    expect(
      REFERENCE_ARCHITECTURE_TEMPLATES.map((template) => template.id),
    ).toEqual([
      "iks-sr-mz-classic",
      "iks-sr-mz-vpc",
      "roks-sr-mz-classic",
      "roks-sr-mz-vpc",
    ]);
  });

  it.each(REFERENCE_ARCHITECTURE_TEMPLATES.map((template) => template.id))(
    "builds a structurally valid, serializable %s document at the detailed diagram level",
    (templateId) => {
      const doc = createTemplateDocument(templateId, {
        catalog: catalogPin,
        theme: "dark",
        now: "2026-07-23T00:00:00.000Z",
      });
      const scene = fromIcad(doc);
      const ids = new Set(scene.all().map((element) => element.id));

      expect(doc.meta.diagramLevel).toBe("detailed");
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

  it.each(REFERENCE_ARCHITECTURE_TEMPLATES.map((template) => template.id))(
    "seeds %s inside a named frame with 3 zones, 3 subnets, and only the documented warnings",
    (templateId) => {
      const doc = createTemplateDocument(templateId, {
        catalog: catalogPin,
        now: "2026-07-23T00:00:00.000Z",
      });
      const scene = fromIcad(doc);
      const frames = scene.all().filter((element) => element.type === "frame");
      const zones = scene.all().filter((element) => element.type === "zone");
      const subnets = scene
        .all()
        .filter(
          (element) =>
            element.type === "box" &&
            element.catalogRef === "ibm-cloud/subnet-acl-rules",
        );

      expect(frames).toHaveLength(1);
      expect(frames[0]?.name).toBeTruthy();
      expect(zones).toHaveLength(3);
      expect(subnets).toHaveLength(3);

      // Four documented, advisory-only diagnostic categories (docs/00-decision-log.md#d30). Two
      // are stable across the whole M27 epic: the decorative "Master" band is an unlabeled Box
      // (missing-label) carrying a separately-rotated Text label (non-zero-rotation) so the
      // band's own border isn't rotated - both are marked gutterExempt (M27.6/M27.7) so the
      // band's own deliberate overlap with all 3 zones doesn't trip sibling-overlap; and IBM's
      // source diagrams themselves reuse "Load Balancer"/"Worker Node 1"/"Worker Node 2" labels
      // identically across all 3 zones (duplicate-label ×9 — 3 labels each shared by 3 elements).
      //
      // M27.8 reverted the worker vertical-stack workaround to IBM's authentic side-by-side
      // layout (see the layout comment above) — genuinely resolved, not just hidden: the previous
      // attempt at this revert (kept only in git history) left WORKER_GAP=30, which measurably
      // failed (routeOrthogonal, tested directly against that exact geometry, silently fell back
      // to a straight line through Worker-1 because every candidate vertical bend line between
      // the two icons landed inside Worker-1's own router-padded footprint); WORKER_GAP=40 clears
      // that threshold, and container-child-padding's prior ×6 (the vertical stack's own worker-
      // to-subnet-edge symptom) is gone too. What remains: a minor, expected residual -
      // mzlb-to-lb-2's route grazes subnet-2's bottom edge by ~1.5px over a ~10px stretch while
      // legitimately entering it to reach its own target (connector-border-hug ×1) - exactly the
      // "brief, unavoidable graze" BORDER_HUG_PENALTY_PER_PX's own doc comment (orthogonalRouter.ts)
      // says costs little enough that the router correctly prefers it over a full detour; and the
      // "Public Network" container's label still doesn't fit its own fixed width and renders
      // ellipsized (text-overflow-needs-wrap ×1) - PUBLIC_NETWORK_W feeds frameW/ibmCloudX
      // downstream, so widening it is a wider layout change than this pass takes on.
      const diagnostics = new Linter({ catalog: catalogFor(scene.all()) }).run(
        scene,
      );
      const counts: Record<string, number> = {};
      for (const d of diagnostics)
        counts[d.ruleId] = (counts[d.ruleId] ?? 0) + 1;
      expect(counts).toEqual({
        "missing-label": 1,
        "non-zero-rotation": 1,
        "duplicate-label": 9,
        "connector-border-hug": 1,
        "text-overflow-needs-wrap": 1,
      });
    },
  );
});
