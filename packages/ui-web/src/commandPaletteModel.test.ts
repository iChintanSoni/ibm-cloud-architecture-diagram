import { describe, expect, it, vi } from "vitest";
import { filterCommands, type CommandItem } from "./commandPaletteModel.js";

function command(id: string, label: string, category?: string): CommandItem {
  return {
    id,
    label,
    run: vi.fn(),
    ...(category !== undefined ? { category } : {}),
  };
}

describe("filterCommands", () => {
  it("returns every command for an empty query", () => {
    const commands = [command("a", "New diagram"), command("b", "Save")];
    expect(filterCommands(commands, "")).toEqual(commands);
    expect(filterCommands(commands, "   ")).toEqual(commands);
  });

  it("matches case-insensitively on the label", () => {
    const commands = [command("a", "Zoom In"), command("b", "Save")];
    expect(filterCommands(commands, "zoom").map((c) => c.id)).toEqual(["a"]);
  });

  it("matches on category as well as label", () => {
    const commands = [
      command("a", "Auto", "Theme"),
      command("b", "Undo", "Edit"),
    ];
    expect(filterCommands(commands, "theme").map((c) => c.id)).toEqual(["a"]);
  });

  it("returns no results when nothing matches", () => {
    expect(filterCommands([command("a", "Save")], "nonexistent")).toEqual([]);
  });
});
