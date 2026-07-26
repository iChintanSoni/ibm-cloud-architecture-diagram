import { JSDOM } from "jsdom";
import { createEditor, type Catalog, type Editor } from "@icad/core";

/**
 * `Editor` isn't headless on its own — its constructor requires a real `HTMLElement` container and
 * its renderer touches bare DOM globals (`document.createElementNS`, `XMLSerializer`, `Image`,
 * `URL`, `Blob`, ...) directly, per D3's locked "live SVG DOM nodes" rendering choice
 * (docs/00-decision-log.md#d3--svg-dom-rendering--locked). `packages/core`'s own test suite already
 * proves the intended path: it runs under a jsdom Vitest environment and calls
 * `createEditor({ container: document.createElement("div"), catalog })` directly.
 *
 * This does the same thing for a standalone Node process: build one jsdom `Window` and copy the
 * globals `Editor`/`SvgRenderer`/`io/export.ts` actually reference onto `globalThis` — mirroring
 * what `vitest-environment-jsdom` does automatically inside a test runner. Copying only
 * `window`/`document` isn't enough: Node has its own native `URL`/`Blob`, so leaving those two
 * pointing at Node's realm while `document`/`Image` point at jsdom's realm causes SVG/PNG export's
 * blob-URL handoff to fail silently (jsdom's `Image.src` can't resolve a blob URL registered in
 * Node's own registry, or vice versa).
 */
const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "XMLSerializer",
  "DOMParser",
  "Image",
  "URL",
  "Blob",
  "MutationObserver",
  "getComputedStyle",
] as const;

let installed = false;

function installJsdomGlobals(): void {
  if (installed) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const windowRecord = dom.window as unknown as Record<string, unknown>;
  for (const key of GLOBAL_KEYS) {
    // Plain assignment throws for globals Node itself defines as getter-only (e.g. `navigator`,
    // since Node 21) — defineProperty overrides them the same way `global-jsdom` does.
    Object.defineProperty(globalThis, key, {
      value: windowRecord[key],
      writable: true,
      configurable: true,
    });
  }
  installed = true;
}

/** Builds the one `Editor` this process drives for its whole lifetime (one process = one open document, per D4). */
export function createHeadlessEditor(catalog: Catalog): Editor {
  installJsdomGlobals();
  const container = document.createElement("div");
  return createEditor({ container, catalog });
}
