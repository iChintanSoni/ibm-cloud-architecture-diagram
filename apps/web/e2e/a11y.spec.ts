import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { runCommand, startBlankDiagram } from "./fixtures.js";

/**
 * Real-browser accessibility checks (docs/07-accessibility.md#testing--ci): unlike the jsdom
 * smoke test (packages/ui-web/src/a11y.test.tsx), this evaluates layout-dependent rules too
 * (color-contrast, target sizing) against actual Chromium rendering.
 */
test.describe("accessibility (real browser)", () => {
  test("a blank diagram has no automatically detectable violations", async ({
    page,
  }) => {
    await startBlankDiagram(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  test("a populated diagram (with an inserted element selected) has no violations", async ({
    page,
  }) => {
    await startBlankDiagram(page);
    await runCommand(page, "Insert Box");
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });

  test("the command palette has no violations while open", async ({ page }) => {
    await startBlankDiagram(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page
      .getByPlaceholder("Type a command…")
      .waitFor({ state: "visible" });
    const results = await new AxeBuilder({ page })
      // The option list is a WAI-ARIA APG combobox/listbox: the owning input is the only real
      // tab stop, arrow keys navigate options (which auto-scroll into view — CommandPalette.tsx),
      // and Escape/Enter/click activate them. axe's static check can't see that dynamic scroll
      // behavior and flags the scrollable <ul> as if it had no keyboard access at all.
      .disableRules(["scrollable-region-focusable"])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
});
