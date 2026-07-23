import { describe, expect, it } from "vitest";
import type { BoxElement } from "../scene/types.js";
import { pickPorts } from "./pickPorts.js";

function box(x: number, y: number, w = 100, h = 100): BoxElement {
  return { id: "x", type: "box", semantic: "deployedOn", x, y, w, h };
}

describe("pickPorts", () => {
  it("picks east/west when the target is directly to the east", () => {
    expect(pickPorts(box(0, 0), box(300, 0))).toEqual({ from: "e", to: "w" });
  });

  it("picks west/east when the target is directly to the west", () => {
    expect(pickPorts(box(300, 0), box(0, 0))).toEqual({ from: "w", to: "e" });
  });

  it("picks south/north when the target is directly to the south", () => {
    expect(pickPorts(box(0, 0), box(0, 300))).toEqual({ from: "s", to: "n" });
  });

  it("picks north/south when the target is directly to the north", () => {
    expect(pickPorts(box(0, 300), box(0, 0))).toEqual({ from: "n", to: "s" });
  });

  it("uses the dominant axis when the offset is diagonal", () => {
    // Much further east than south -> horizontal wins.
    expect(pickPorts(box(0, 0), box(500, 50))).toEqual({ from: "e", to: "w" });
    // Much further south than east -> vertical wins.
    expect(pickPorts(box(0, 0), box(50, 500))).toEqual({ from: "s", to: "n" });
  });

  it("biases west-to-east on an exact tie", () => {
    expect(pickPorts(box(0, 0), box(0, 0))).toEqual({ from: "e", to: "w" });
  });
});
