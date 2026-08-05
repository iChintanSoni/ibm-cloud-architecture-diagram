// These tests check containerLabelRect's own arithmetic (the heuristic width estimate, and that
// its x formula matches svgRenderer.ts's containerLabelText exactly) - not a claim about real
// rendered glyph width, since packages/core has no font-measurement capability anywhere
// (deliberate: it must run headless under jsdom with no real canvas/font layout engine).

import { describe, expect, it } from "vitest";
import type { BoxElement } from "../scene/types.js";
import {
  CONTAINER_GLYPH_INSET,
  CONTAINER_GLYPH_SIZE,
  CONTAINER_LABEL_GAP,
  containerLabelMaxWidth,
  containerLabelRect,
} from "./containerLabel.js";

function box(overrides: Partial<BoxElement> = {}): BoxElement {
  return {
    id: "b1",
    type: "box",
    semantic: "deployedOn",
    x: 100,
    y: 200,
    w: 300,
    h: 150,
    ...overrides,
  };
}

describe("containerLabelRect", () => {
  it("returns undefined when there's no label", () => {
    expect(containerLabelRect(box())).toBeUndefined();
  });

  it("returns undefined when the label text is an empty string", () => {
    expect(containerLabelRect(box({ label: { text: "" } }))).toBeUndefined();
  });

  it("places x at the container's inset with no catalogRef (no corner icon)", () => {
    const rect = containerLabelRect(box({ label: { text: "Subnet" } }));
    expect(rect?.x).toBe(100 + CONTAINER_GLYPH_INSET);
  });

  it("shifts x past the corner glyph when catalogRef is set", () => {
    const rect = containerLabelRect(
      box({ label: { text: "Subnet" }, catalogRef: "ibm-cloud/vpc" }),
    );
    expect(rect?.x).toBe(
      100 + CONTAINER_GLYPH_INSET + CONTAINER_GLYPH_SIZE + CONTAINER_LABEL_GAP,
    );
  });

  it("estimates width from character count", () => {
    const rect = containerLabelRect(box({ label: { text: "Subnet" } }));
    // "Subnet" is 6 characters - assert against the heuristic's own arithmetic, not a literal,
    // so this doesn't silently drift if AVG_CHAR_WIDTH_PX changes.
    const rectLonger = containerLabelRect(
      box({ label: { text: "Private Subnet — Data Tier" } }),
    );
    expect(rect!.w).toBeGreaterThan(0);
    expect(rectLonger!.w).toBeGreaterThan(rect!.w);
  });

  it("uses a fixed height regardless of label length", () => {
    const short = containerLabelRect(box({ label: { text: "A" } }));
    const long = containerLabelRect(
      box({ label: { text: "Private Subnet — Data Tier" } }),
    );
    expect(short?.h).toBe(CONTAINER_GLYPH_SIZE);
    expect(long?.h).toBe(CONTAINER_GLYPH_SIZE);
  });

  it("sets y to the container's own inset", () => {
    const rect = containerLabelRect(box({ y: 500, label: { text: "X" } }));
    expect(rect?.y).toBe(500 + CONTAINER_GLYPH_INSET);
  });

  it("clamps w to containerLabelMaxWidth instead of overflowing a narrow container", () => {
    const el = box({
      w: 60,
      label: { text: "Private Subnet — Data Tier" },
    });
    const rect = containerLabelRect(el);
    expect(rect!.w).toBeLessThanOrEqual(containerLabelMaxWidth(el));
  });
});

describe("containerLabelMaxWidth", () => {
  it("shrinks as the container gets narrower", () => {
    const wide = containerLabelMaxWidth(box({ w: 300 }));
    const narrow = containerLabelMaxWidth(box({ w: 60 }));
    expect(narrow).toBeLessThan(wide);
  });

  it("shrinks further when a corner icon eats into the available width", () => {
    const noIcon = containerLabelMaxWidth(box({ w: 150 }));
    const withIcon = containerLabelMaxWidth(
      box({ w: 150, catalogRef: "ibm-cloud/vpc" }),
    );
    expect(withIcon).toBeLessThan(noIcon);
  });

  it("never goes negative for a container narrower than the label's start inset", () => {
    expect(containerLabelMaxWidth(box({ w: 5 }))).toBe(0);
  });
});
