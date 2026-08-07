import { expect, test } from "@playwright/test";
import { runCommand, startBlankDiagram } from "./fixtures.js";

/**
 * Keyboard-only authoring flow (packages/core/docs/accessibility.md#canvas-the-hard-20): every step below
 * uses only page.keyboard — no mouse clicks or drags — covering create, select, nudge, connect,
 * group/ungroup, delete, and undo. `.focus()` jumps are used the way a screen-reader user jumps
 * via region/heading navigation, standing in for tabbing through unrelated chrome.
 */
test.describe("keyboard-only authoring", () => {
  test("insert, nudge, connect, group, ungroup, delete, and undo — no mouse", async ({
    page,
  }) => {
    await startBlankDiagram(page);

    await runCommand(page, "Insert Box");
    await runCommand(page, "Insert Box");

    // Scoped to the elements layer, not just `.icad-canvas [data-icad-id]` — the selected
    // element's outline overlay (a sibling layer, moved in lockstep by previewTransform, D26)
    // carries the same data-icad-id, so the broader selector double-counts whichever element is
    // currently selected.
    const canvasElements = page.locator(
      '.icad-canvas [data-icad-layer="elements"] > [data-icad-id]',
    );
    await expect(canvasElements).toHaveCount(2);
    const first = canvasElements.nth(0);
    const second = canvasElements.nth(1);

    // Jump into the canvas and explicitly select the focused element (Enter), replacing
    // whatever the last Insert command left selected.
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");

    // Arrow-key nudge (Shift for the bigger step) on the current selection. Both boxes were
    // inserted at the exact same viewport-center point, so nudge *left* here — nudging right
    // would push `first` east of `second` and flip the tab order the next step relies on
    // (tab order is live-computed from position, west-to-east).
    const rect = first.locator("rect").first();
    const xBefore = Number(await rect.getAttribute("x"));
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(rect).toHaveAttribute("x", String(xBefore - 1 - 8));

    // Extend the selection to both boxes with Shift+Space, then Group (Ctrl/Cmd+G).
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("ControlOrMeta+g");

    const group = page.locator('.icad-canvas [data-icad-type="group"]');
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute("aria-label", /contains 2 elements/);

    // Ungroup (Ctrl/Cmd+Shift+G) restores both boxes and removes the group.
    await page.keyboard.press("ControlOrMeta+Shift+g");
    await expect(group).toHaveCount(0);
    await expect(canvasElements).toHaveCount(2);

    // Keyboard connect mode: focus a source, press "c", Tab to a target, Enter to confirm.
    await first.focus();
    await page.keyboard.press("c");
    await page.getByText(/Connecting from/).waitFor({ state: "visible" });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    const connector = page.locator('.icad-canvas [data-icad-type="connector"]');
    await expect(connector).toHaveCount(1);
    await expect(connector).toHaveAttribute(
      "aria-label",
      /^Connector: .+ to .+ \(/,
    );

    // Delete the connector, then undo (Ctrl/Cmd+Z) brings it back.
    await connector.focus();
    await page.keyboard.press("Delete");
    await expect(connector).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(connector).toHaveCount(1);
  });

  test("Escape cancels an in-progress keyboard connection without creating a connector", async ({
    page,
  }) => {
    await startBlankDiagram(page);
    await runCommand(page, "Insert Box");
    await runCommand(page, "Insert Box");

    const canvasElements = page.locator(
      '.icad-canvas [data-icad-layer="elements"] > [data-icad-id]',
    );
    const first = canvasElements.nth(0);

    await first.focus();
    await page.keyboard.press("c");
    await page.getByText(/Connecting from/).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");

    await expect(page.getByText(/Connecting from/)).toHaveCount(0);
    await expect(
      page.locator('.icad-canvas [data-icad-type="connector"]'),
    ).toHaveCount(0);
  });

  test("arrow-key nudge still works immediately after a z-order command from the palette", async ({
    page,
  }) => {
    await startBlankDiagram(page);
    await runCommand(page, "Insert Box");

    const box = page
      .locator('.icad-canvas [data-icad-layer="elements"] > [data-icad-id]')
      .first();
    await box.focus();
    await page.keyboard.press("Enter"); // select the focused element

    // The command palette (like the Edit menu and context menu) isn't a canvas element, so
    // running a z-order command from it must not permanently strand DOM focus there — the very
    // next arrow key still has to reach the canvas and nudge the selection.
    await runCommand(page, "Bring to front");

    const rect = box.locator("rect").first();
    const xBefore = Number(await rect.getAttribute("x"));
    await page.keyboard.press("ArrowRight");
    await expect(rect).toHaveAttribute("x", String(xBefore + 1));
  });

  test("Tab exits the canvas at the last element instead of wrapping (no keyboard trap)", async ({
    page,
  }) => {
    await startBlankDiagram(page);
    await runCommand(page, "Insert Box");

    const box = page
      .locator('.icad-canvas [data-icad-layer="elements"] > [data-icad-id]')
      .first();
    await box.focus();
    await expect(box).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(box).not.toBeFocused();
  });
});
