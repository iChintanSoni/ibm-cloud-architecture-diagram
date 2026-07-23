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

// Mirrors Compute/Chip.svg: no wrapping glyph group or hit-area rect at all — the
// ~12,12 canvas offset is baked directly into the path coordinates.
const BAKED_OFFSET_NO_WRAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="48px" height="49px" viewBox="0 0 48 49" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <title>demo-chip</title>
  <g id="V2-Icons" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="demo-chip" transform="translate(0.0042, 0.3421)">
      <polygon fill="#198038" points="0 48 48 48 48 0 0 0"></polygon>
      <path d="M19,20 L29,20 L29,29 L19,29 Z" fill="#FFFFFF"></path>
    </g>
  </g>
</svg>`;

// Mirrors Networking/Router.svg: a real translate(12,12) glyph wrapper, but no
// _Transparent_Rectangle_ hit-area rect declaring its size.
const NO_HITBOX_REAL_OFFSET = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="48px" height="48px" viewBox="0 0 48 48" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <title>demo-router</title>
  <g id="V2-Icons" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="demo-router" transform="translate(0, 0)">
      <rect fill="#1192E8" x="0" y="0" width="48" height="48"></rect>
      <g transform="translate(12, 12)" fill="#FFFFFF">
        <polygon points="16 4 12 0 8 4 9 5 11 3 11 9 13 9 13 3 15 5"></polygon>
      </g>
    </g>
  </g>
</svg>`;

// Mirrors Data & Storage/Object Storage Application.svg: the hit-area rect sits at
// (12,12) rather than (0,0), and its parent group is itself one half of a
// cancelling translate(-a,-b)/translate(a,b) pair with its own ancestor.
const HITBOX_OFFSET_WITH_CANCELLING_ANCESTORS = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="48px" height="48px" viewBox="0 0 48 48" version="1.1" xmlns="http://www.w3.org/2000/svg">
  <title>demo-object-storage</title>
  <g id="V2-Icons" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="IBM-Cloud-Storage" transform="translate(-670, -49)">
      <g id="object-storage" transform="translate(670, 49)">
        <polygon fill="#0F62FE" points="0 48 48 48 48 0 0 0"></polygon>
        <path d="M33,27 L15,27 L15,33 L33,33 Z" fill="#FFFFFF"></path>
        <rect id="_Transparent_Rectangle_" x="12" y="12" width="24" height="24"></rect>
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

  it("re-frames the hit-area rect's parent to fill the 0..20 viewBox instead of leaving it at the original 48-canvas offset", () => {
    const result = normalizeIcon(COLORED_SQUARE_TILE);
    expect(result?.fragment).toContain(`transform="scale(${20 / 24})"`);
    expect(result?.fragment).not.toContain("translate(12, 12)");
  });

  it("marks a rounded (rx-bearing) tile as an actor container", () => {
    const result = normalizeIcon(ROUNDED_ACTOR_TILE);
    expect(result?.rounded).toBe(true);
    expect(result?.color).toBe("#000000");
  });

  it("discards a real positioning translate even without a hit-area rect to size it from", () => {
    const result = normalizeIcon(NO_HITBOX_REAL_OFFSET);
    expect(result?.fragment).toContain(`transform="scale(${20 / 24})"`);
    expect(result?.fragment).not.toContain("translate(12");
  });

  it("compensates for an offset baked directly into path coordinates when no wrapper carries it", () => {
    const result = normalizeIcon(BAKED_OFFSET_NO_WRAPPER);
    expect(result?.fragment).toContain(`transform="scale(${20 / 24}) translate(-12, -12)"`);
  });

  it("compensates for a hit-area rect offset within its own parent, and clears cancelling ancestor translates that would otherwise shift it off-canvas", () => {
    const result = normalizeIcon(HITBOX_OFFSET_WITH_CANCELLING_ANCESTORS);
    expect(result?.fragment).toContain(`transform="scale(${20 / 24}) translate(-12, -12)"`);
    expect(result?.fragment).not.toContain("translate(-670");
    expect(result?.fragment).not.toContain("translate(670");
  });

  it("returns undefined when no canvas-covering background shape is found", () => {
    expect(normalizeIcon(NO_BACKGROUND_ARTIFACT)).toBeUndefined();
  });
});
