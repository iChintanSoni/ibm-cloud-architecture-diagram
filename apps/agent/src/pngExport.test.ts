import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertSvgToPng } from "./pngExport.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("convertSvgToPng", () => {
  const outputPath = path.join(
    tmpdir(),
    `icad-agent-png-test-${process.pid}.png`,
  );

  afterEach(async () => {
    await rm(outputPath, { force: true });
  });

  it("writes a real PNG file for a real SVG, independent of any LLM/agent code", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">' +
      '<rect x="0" y="0" width="200" height="120" fill="#ffffff" stroke="#161616"/>' +
      '<text x="16" y="60" font-size="14">Test Box</text>' +
      "</svg>";

    await convertSvgToPng(svg, outputPath);

    const png = await readFile(outputPath);
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);
    // IHDR chunk: width/height are the first 8 bytes after the 8-byte magic + 4-byte length +
    // 4-byte "IHDR" type, big-endian uint32 each — a real structural check that this isn't just a
    // magic-byte-prefixed empty file.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(200);
    expect(height).toBe(120);
  });
});
