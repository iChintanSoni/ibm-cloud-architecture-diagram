import { describe, expect, it } from "vitest";
import { normalizeIcon } from "./extract.js";

const COLORED_SQUARE_TILE = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="48px" height="48px" viewBox="0 0 48 48" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <title>demo-node</title>
  <g id="V2-Icons" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="demo-node" transform="translate(0, 0)">
      <g fill="#198038">
        <polygon points="0 48 48 48 48 0 0 0"></polygon>
      </g>
      <g transform="translate(12, 12)">
        <circle cx="12" cy="12" r="6" fill="#FFFFFF"></circle>
        <rect id="_Transparent_Rectangle_" x="0" y="0" width="24" height="24"></rect>
      </g>
    </g>
  </g>
</svg>`;

const ROUNDED_ACTOR_TILE = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="48px" height="48px" viewBox="0 0 48 48" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <title>demo-actor</title>
  <g id="V2-Icons" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="demo-actor">
      <rect fill="#000000" x="0" y="0" width="48" height="48" rx="24"></rect>
      <g transform="translate(12, 12)">
        <path d="M9,3 L12,6 L9,9 Z" fill="#FFFFFF"></path>
      </g>
    </g>
  </g>
</svg>`;

const NO_BACKGROUND_ARTIFACT = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="26px" height="26px" viewBox="0 0 26 26" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <title>_Transparent_Rectangle_</title>
  <g stroke="#FFFFFF">
    <rect x="1" y="1" width="24" height="24"></rect>
  </g>
</svg>`;

describe("normalizeIcon", () => {
  it("extracts the tile color and recolors the white glyph so it renders on a white container", () => {
    const result = normalizeIcon(COLORED_SQUARE_TILE);
    expect(result?.color).toBe("#198038");
    expect(result?.rounded).toBe(false);
    expect(result?.fragment).not.toContain("#FFFFFF");
    expect(result?.fragment).toContain("#198038");
  });

  it("strips the invisible hit-area rect", () => {
    const result = normalizeIcon(COLORED_SQUARE_TILE);
    expect(result?.fragment).not.toContain("_Transparent_Rectangle_");
  });

  it("marks a rounded (rx-bearing) tile as an actor container", () => {
    const result = normalizeIcon(ROUNDED_ACTOR_TILE);
    expect(result?.rounded).toBe(true);
    expect(result?.color).toBe("#000000");
  });

  it("returns undefined when no canvas-covering background shape is found", () => {
    expect(normalizeIcon(NO_BACKGROUND_ARTIFACT)).toBeUndefined();
  });
});
