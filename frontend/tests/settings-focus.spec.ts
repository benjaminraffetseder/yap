import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

test("Settings keeps section focus after a targeted jump clears its parameter", async ({
  page,
}) => {
  await page.goto("/#/settings?section=advanced&focus=modelPath-row");
  const general = page.getByRole("tab", { name: "General", exact: true });
  await expect(general).toBeVisible();
  await general.click();
  await expect(general).toHaveAttribute("aria-selected", "true");
  await settle(page);
  await expect(general).toBeFocused();
});

test("Settings keyboard section activation keeps focus after a targeted jump", async ({ page }) => {
  await page.goto("/#/settings?section=advanced&focus=modelPath-row");
  const advanced = page.getByRole("tab", { name: "Advanced", exact: true });
  await expect(advanced).toHaveAttribute("aria-selected", "true");
  await advanced.focus();
  await advanced.press("ArrowUp");
  const history = page.getByRole("tab", { name: "History & data", exact: true });
  await expect(history).toBeFocused();
  await history.press("Enter");
  await expect(history).toHaveAttribute("aria-selected", "true");
  await settle(page);
  await expect(history).toBeFocused();
});

test("Settings still focuses search when first opened without a target", async ({ page }) => {
  await page.goto("/#/settings?section=advanced");
  const search = page.getByRole("textbox", { name: "Search settings", exact: true });
  await expect(search).toBeVisible();
  await settle(page);
  await expect(search).toBeFocused();
});
