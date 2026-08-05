// These tests check measureText/ellipsize/wrapText's own arithmetic (a categorized advance-width
// estimate) - not a claim about real rendered glyph width, since packages/core has no
// font-measurement capability anywhere (deliberate: it must run headless under jsdom with no real
// canvas/font layout engine). See this file's own module doc comment.

import { describe, expect, it } from "vitest";
import { ellipsize, measureText, wrapText } from "./textMetrics.js";

describe("measureText", () => {
  it("is 0 for an empty string", () => {
    expect(measureText("")).toBe(0);
  });

  it("grows with more characters", () => {
    expect(measureText("Worker Node 12")).toBeGreaterThan(
      measureText("Worker Node 1"),
    );
  });

  it("weighs wide characters more than narrow ones, not a flat per-character average", () => {
    // Same length, deliberately opposite ends of the width table.
    expect(measureText("MMMM")).toBeGreaterThan(measureText("iiii") * 2);
  });

  it("scales linearly with font size", () => {
    const at16 = measureText("Subnet", 16);
    const at32 = measureText("Subnet", 32);
    expect(at32).toBeCloseTo(at16 * 2, 5);
  });

  it("weighs a space less than a typical letter", () => {
    expect(measureText(" ")).toBeLessThan(measureText("n"));
  });
});

describe("ellipsize", () => {
  it("returns text unchanged when it already fits", () => {
    const text = "ALB";
    expect(ellipsize(text, measureText(text) + 50)).toBe(text);
  });

  it("truncates with a trailing ellipsis when it doesn't fit (end mode)", () => {
    const text = "Worker Node 1";
    const result = ellipsize(text, measureText(text) / 2, "end");
    expect(result.length).toBeLessThan(text.length);
    expect(result.endsWith("…")).toBe(true);
    expect(measureText(result)).toBeLessThanOrEqual(measureText(text) / 2);
  });

  it("keeps a prefix and suffix with the ellipsis in between (middle mode)", () => {
    const text = "VPC Multi-zone Load Balancer";
    const result = ellipsize(text, measureText(text) / 2, "middle");
    expect(result).toContain("…");
    expect(result.startsWith(text[0]!)).toBe(true);
    expect(result.endsWith(text[text.length - 1]!)).toBe(true);
    expect(measureText(result)).toBeLessThanOrEqual(measureText(text) / 2);
  });

  it("falls back to a bare ellipsis when maxWidth fits the ellipsis but not one real character", () => {
    const ellipsisWidth = measureText("…");
    expect(ellipsize("Worker Node 1", ellipsisWidth)).toBe("…");
  });

  it("falls back to an empty string when maxWidth can't even fit the ellipsis mark itself", () => {
    expect(ellipsize("Worker Node 1", 1)).toBe("");
    expect(ellipsize("Worker Node 1", 0)).toBe("");
  });

  it("never returns something wider than maxWidth, across varied inputs", () => {
    const cases = [
      "A",
      "Worker Node 1",
      "VPC Multi-zone Load Balancer",
      "iiiiiiiiii",
    ];
    for (const text of cases) {
      const maxWidth = measureText(text) * 0.6;
      expect(measureText(ellipsize(text, maxWidth, "end"))).toBeLessThanOrEqual(
        maxWidth,
      );
      expect(
        measureText(ellipsize(text, maxWidth, "middle")),
      ).toBeLessThanOrEqual(maxWidth);
    }
  });
});

describe("wrapText", () => {
  it("returns the whole text as one line when it fits", () => {
    expect(wrapText("ALB", 500)).toEqual(["ALB"]);
  });

  it("returns an empty array for empty/whitespace-only input", () => {
    expect(wrapText("", 500)).toEqual([]);
    expect(wrapText("   ", 500)).toEqual([]);
  });

  it("wraps onto a second line instead of overflowing the first", () => {
    // 4 equal-width words: greedy word-wrapping is boundary-sensitive (a maxWidth that's merely
    // "half the total" doesn't guarantee a clean 2-line split for arbitrary text - the leftover
    // chunk after a greedy first line can legitimately be wider than half, even though the true
    // 2-line total fits), so this picks a maxWidth from the actual word width, not a fraction of
    // the whole, to make a clean unellipsized 2-line wrap deterministic.
    const text = "Node Node Node Node";
    const pairWidth = measureText("Node Node");
    const lines = wrapText(text, pairWidth + 5, { maxLines: 2 });

    expect(lines).toEqual(["Node Node", "Node Node"]);
    // No words lost - rejoining reconstructs the original text exactly (nothing needed
    // ellipsizing, since maxWidth comfortably covers each line's actual word pairing).
    expect(lines.join(" ")).toBe(text);
  });

  it("ellipsizes the last line when the text still overflows maxLines", () => {
    const text = "VPC Multi-zone Load Balancer For Public Traffic";
    const lines = wrapText(text, measureText("VPC Multi-zone") * 1.1, {
      maxLines: 2,
    });

    expect(lines.length).toBe(2);
    expect(lines[lines.length - 1]!.endsWith("…")).toBe(true);
  });

  it("behaves like a single-line ellipsize when maxLines is 1", () => {
    const text = "Worker Node 1";
    const maxWidth = measureText(text) / 2;
    expect(wrapText(text, maxWidth, { maxLines: 1 })).toEqual([
      ellipsize(text, maxWidth, "end"),
    ]);
  });

  it("keeps a single word too wide for maxWidth whole rather than splitting it mid-word", () => {
    const word = "Interconnectivity";
    const lines = wrapText(word, measureText(word) / 2, { maxLines: 2 });
    // Still ellipsized (the width guarantee has no exception), but the pre-ellipsis kept portion
    // is a prefix of the real word, not some hyphenated/split fragment mixed with another word.
    expect(lines.length).toBe(1);
    expect(word.startsWith(lines[0]!.replace("…", ""))).toBe(true);
  });

  it("guarantees every line fits maxWidth even with many short, oddly-sized words", () => {
    const text = "A B C D E F G H I J K L M N O P";
    const lines = wrapText(text, 40, { maxLines: 3 });
    for (const line of lines) {
      expect(measureText(line)).toBeLessThanOrEqual(40);
    }
  });
});
