import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractDrawioLibraryIcons } from "./extractDrawioLibrary.js";

// Base64 of a minimal flat 32x32 glyph with a cancelling translate(-100,-200)/translate(100,200)
// ancestor pair, matching the real shape confirmed in not_released_in_drawio.xml's "Cloud" entry.
const FLAT_GLYPH_B64 =
  "PHN2ZyB3aWR0aD0iMzJweCIgaGVpZ2h0PSIzMnB4IiB2aWV3Qm94PSIwIDAgMzIgMzIiIHZlcnNpb249IjEuMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU+ZGVtbzwvdGl0bGU+PGcgaWQ9InYyLTQ4eDQ4IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMTAwLCAtMjAwKSI+PGcgaWQ9ImRlbW8iIHRyYW5zZm9ybT0idHJhbnNsYXRlKDEwMCwgMjAwKSI+PHBhdGggZD0iTTQsNCBMMjgsNCBMMjgsMjggTDQsMjggWiIgZmlsbD0iIzExOTJFOCI+PC9wYXRoPjwvZz48L2c+PC9zdmc+";

function library(entries: Array<{ title?: string; image?: string }>): string {
  const jsonEntries = entries.map((e) => {
    const image = e.image ?? FLAT_GLYPH_B64;
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" style="shape=image;image=data:image/svg+xml,${image};" vertex="1" parent="1"/></root></mxGraphModel>`;
    const escaped = xml.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return { xml: escaped, w: 220, h: 140, aspect: "fixed", ...(e.title ? { title: e.title } : {}) };
  });
  return `<mxlibrary title="test">${JSON.stringify(jsonEntries)}</mxlibrary>`;
}

describe("extractDrawioLibraryIcons", () => {
  const files: string[] = [];

  afterEach(() => {
    files.length = 0;
  });

  function writeFixture(xml: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "drawio-lib-"));
    const file = path.join(dir, "not_released_in_drawio.xml");
    writeFileSync(file, xml, "utf8");
    files.push(file);
    return file;
  }

  it("extracts a titled flat-glyph entry, reframed into the 24x24 glyph viewBox", () => {
    const file = writeFixture(library([{ title: "Cloud" }]));
    const icons = extractDrawioLibraryIcons(file);

    expect(icons).toHaveLength(1);
    expect(icons[0]!.title).toBe("Cloud");
    expect(icons[0]!.normalized.color).toBe("#1192E8");
    expect(icons[0]!.normalized.fragment).toContain("scale(0.75)"); // 24 / 32
  });

  it("skips untitled entries", () => {
    const file = writeFixture(library([{}, { title: "Named" }]));
    const icons = extractDrawioLibraryIcons(file);
    expect(icons.map((i) => i.title)).toEqual(["Named"]);
  });

  it("keeps only the first occurrence when a title repeats", () => {
    const file = writeFixture(
      library([
        { title: "Network ACL Rules" },
        { title: "Network ACL Rules", image: FLAT_GLYPH_B64 }
      ])
    );
    const icons = extractDrawioLibraryIcons(file);
    expect(icons).toHaveLength(1);
  });

  it("returns an empty array when the file has no <mxlibrary> array", () => {
    const file = writeFixture("<mxfile></mxfile>");
    expect(extractDrawioLibraryIcons(file)).toEqual([]);
  });
});
