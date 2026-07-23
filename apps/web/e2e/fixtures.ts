import type { Page } from "@playwright/test";

/** Starts a brand-new blank diagram, dismissing the first-launch New Diagram chooser. */
export async function startBlankDiagram(page: Page): Promise<void> {
  await page.goto("/");
  // Carbon's radio button renders a styled span on top of the native input, so a real click
  // needs to land on the associated <label> (native label-for semantics) rather than the input.
  await page.locator('label[for="icad-template-blank"]').click();
  await page.getByRole("button", { name: "Create diagram" }).click();
  // Carbon's Modal keeps rendering (mid closing-transition, focus-trap sentinels and all) for a
  // beat after the "open" prop flips — wait for it to fully leave the DOM before proceeding, or
  // an a11y scan run too early flags its (mid-transition, transient) contents.
  await page.locator('[aria-label="New diagram"]').waitFor({ state: "hidden" });
  await page.locator(".icad-canvas svg[data-icad-root]").waitFor({ state: "visible" });
}

/** Runs one command palette entry by its exact label — Ctrl/Cmd+K, type to filter, Enter to run. */
export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Type a command…");
  await input.waitFor({ state: "visible" });
  await input.fill(label);
  await page.keyboard.press("Enter");
}
