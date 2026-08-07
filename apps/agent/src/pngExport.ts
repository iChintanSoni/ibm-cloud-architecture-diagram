import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

/**
 * Renders an already-exported ICAD SVG to PNG (docs/decision-log.md#d35).
 *
 * `@icad/mcp`'s own `export_diagram` tool stays SVG-only and headless — real PNG export needs a
 * browser canvas the MCP server deliberately doesn't have (docs/roadmap.md#m91). This is the
 * agent-side conversion step that fills the `.png` artifact gap instead, using resvg (a real Rust
 * SVG renderer via native bindings, not a headless browser) rather than reopening that deferral.
 */
export async function convertSvgToPng(
  svg: string,
  outputPngPath: string,
): Promise<void> {
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  await writeFile(outputPngPath, png);
}
