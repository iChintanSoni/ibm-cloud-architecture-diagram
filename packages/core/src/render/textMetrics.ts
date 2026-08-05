/**
 * Character-width estimation for label sizing/wrapping/ellipsis — there is no real text-measurement
 * API available anywhere in this package (see containerLabel.ts's AVG_CHAR_WIDTH_PX doc comment:
 * packages/core must run headless under jsdom for the MCP server, which implements no
 * getBBox/getComputedTextLength, so this can never call into a real browser layout engine).
 *
 * A categorized advance-width table, not a single flat average: character width in a real humanist
 * sans-serif (IBM Plex Sans, the diagram's own embedded font) varies roughly 3x between the
 * narrowest glyphs ('i', 'l', '.') and the widest ('M', 'W', '%') — a flat per-character average
 * badly over- or under-estimates any label whose character mix skews from "typical", which
 * architecture-diagram labels (short technical nouns, often capitalized, hyphenated, or numbered —
 * "VPC Multi-zone LB", "Worker Node 1") routinely do. Each bucket is expressed as a fraction of
 * font-size (em), the standard portable way to describe glyph advance widths across sizes.
 * Approximate, not exact per-glyph metrics — tunable by eye against a real rendered diagram, not by
 * re-deriving analytically, matching AVG_CHAR_WIDTH_PX's existing precedent in this codebase.
 */

/** svgRenderer's unset-font-size default that containerLabelText/labelText inherit (~16-18px). */
const DEFAULT_FONT_SIZE_PX = 16;

const VERY_NARROW = new Set([
  "i",
  "l",
  "I",
  ".",
  ",",
  "'",
  "!",
  ":",
  ";",
  "|",
  "’",
  "‘",
]);
const NARROW = new Set([
  "f",
  "t",
  "j",
  "r",
  "J",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "/",
  "\\",
  "-",
  '"',
  "“",
  "”",
]);
const WIDE = new Set(["m", "w", "M", "W", "%", "@", "#", "&", "–", "—"]);

const EM_SPACE = 0.27;
const EM_VERY_NARROW = 0.28;
const EM_NARROW = 0.38;
const EM_LOWER = 0.52;
const EM_DIGIT = 0.56;
const EM_UPPER = 0.66;
const EM_WIDE = 0.86;

const UPPER_RE = /[A-Z]/;
const DIGIT_RE = /[0-9]/;

function charWidthEm(ch: string): number {
  if (ch === " ") return EM_SPACE;
  if (VERY_NARROW.has(ch)) return EM_VERY_NARROW;
  if (NARROW.has(ch)) return EM_NARROW;
  if (WIDE.has(ch)) return EM_WIDE;
  if (DIGIT_RE.test(ch)) return EM_DIGIT;
  if (UPPER_RE.test(ch)) return EM_UPPER;
  return EM_LOWER; // lowercase and anything unclassified (accented letters, symbols, etc.)
}

/** Estimated on-screen width, in px, of `text` set at `fontSizePx`. */
export function measureText(
  text: string,
  fontSizePx: number = DEFAULT_FONT_SIZE_PX,
): number {
  let total = 0;
  for (const ch of text) total += charWidthEm(ch) * fontSizePx;
  return total;
}

const ELLIPSIS = "…";

export type EllipsisMode = "end" | "middle";

/**
 * Truncates `text` to fit `maxWidth`, appending (mode "end") or inserting (mode "middle") a single
 * ellipsis character. Returns `text` unchanged if it already fits. Never returns a string wider
 * than maxWidth — degrades gracefully as maxWidth shrinks: first to just the bare ellipsis (once
 * there's no room for a real character alongside it), then to an empty string in the genuinely
 * degenerate case where maxWidth can't even fit the ellipsis mark itself.
 */
export function ellipsize(
  text: string,
  maxWidth: number,
  mode: EllipsisMode = "end",
  fontSizePx: number = DEFAULT_FONT_SIZE_PX,
): string {
  if (measureText(text, fontSizePx) <= maxWidth) return text;

  const ellipsisWidth = measureText(ELLIPSIS, fontSizePx);
  // Not even the ellipsis mark alone fits — returning it anyway would silently violate the "never
  // wider than maxWidth" guarantee this function exists to provide, so an empty string (0 width)
  // is the only option that stays honest for this genuinely degenerate input.
  if (ellipsisWidth > maxWidth) return "";
  const budget = maxWidth - ellipsisWidth;

  if (mode === "end") {
    let kept = "";
    for (const ch of text) {
      const next = kept + ch;
      if (measureText(next, fontSizePx) > budget) break;
      kept = next;
    }
    return kept.length > 0 ? kept + ELLIPSIS : ELLIPSIS;
  }

  // "middle": a prefix from the start and a suffix from the end, splitting the budget so the
  // prefix gets first claim on its half and the suffix gets whatever the prefix didn't use.
  let prefix = "";
  for (const ch of text) {
    const next = prefix + ch;
    if (measureText(next, fontSizePx) > budget / 2) break;
    prefix = next;
  }
  const suffixBudget = budget - measureText(prefix, fontSizePx);
  let suffix = "";
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const next = text[i] + suffix;
    if (measureText(next, fontSizePx) > suffixBudget) break;
    suffix = next;
  }
  // Defensive: if the two independently-grown ends would consume as much of the string as keeping
  // it whole, ellipsizing bought nothing — return the original rather than a degenerate result.
  if (prefix.length + suffix.length >= text.length) return text;
  return `${prefix}${ELLIPSIS}${suffix}`;
}

export interface WrapOptions {
  /** @default 2 */
  maxLines?: number;
  /** @default 16 */
  fontSizePx?: number;
  /** Ellipsis style applied to the last line if the text still doesn't fit after wrapping. @default "end" */
  ellipsisMode?: EllipsisMode;
}

const DEFAULT_MAX_LINES = 2;

/**
 * Greedily wraps `text` onto up to `maxLines` lines. If the text still doesn't fit after
 * `maxLines` lines, the last line is ellipsized (via `ellipsize`) rather than silently dropping the
 * remainder — "wrap first, then ellipsize" per M27's approved text-overflow policy. Splits on
 * whitespace only: architecture-diagram labels are short technical nouns/phrases, not prose, so
 * this deliberately does no hyphenation or mid-word breaking. Guarantees every returned line's
 * measured width is <= maxWidth, with one exception at the character level, not the word level: a
 * single word that alone doesn't fit is never split mid-word for the sake of wrapping (kept whole
 * on its own line), but if it's also the final line, it's still ellipsized as a whole via the same
 * mechanism as any other overflowing line — so the width guarantee itself never has an exception,
 * only the "don't break a word to make it fit *before* ellipsizing" preference does.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  options: WrapOptions = {},
): string[] {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const fontSizePx = options.fontSizePx ?? DEFAULT_FONT_SIZE_PX;
  const ellipsisMode = options.ellipsisMode ?? "end";

  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  let wordIndex = 0;

  while (wordIndex < words.length && lines.length < maxLines) {
    const word = words[wordIndex]!;
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (
      current.length === 0 ||
      measureText(candidate, fontSizePx) <= maxWidth
    ) {
      current = candidate;
      wordIndex += 1;
    } else {
      lines.push(current);
      current = "";
    }
  }
  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
    current = "";
  }

  if (wordIndex < words.length) {
    // Overflow: words remain unconsumed after maxLines. Rebuild the last line as the *remaining*
    // text (last fitted line + everything still unconsumed), so the ellipsis pass below reflects
    // how much was actually cut, not merely re-truncating text that already fit as-is.
    const remainder = [lines[lines.length - 1], ...words.slice(wordIndex)]
      .filter((part): part is string => part !== undefined)
      .join(" ");
    if (lines.length > 0) lines[lines.length - 1] = remainder;
    else lines.push(remainder);
  }

  return lines.map((line) =>
    measureText(line, fontSizePx) > maxWidth
      ? ellipsize(line, maxWidth, ellipsisMode, fontSizePx)
      : line,
  );
}
