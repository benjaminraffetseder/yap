import { expect, test } from "@playwright/test";

test("unsupported CSS engines get readable guidance before the UI mounts", async ({ page }) => {
  await page.addInitScript(() => {
    CSS.supports = () => false;
  });
  await page.goto("/");
  const guidance = page.getByRole("main");
  await expect(
    guidance.getByRole("heading", { name: "Update your system to open Yap" }),
  ).toBeVisible();
  await expect(guidance).toContainText("macOS 13.3 or newer");
  await expect(guidance).toContainText("Microsoft Edge WebView2 Runtime");
  await expect(guidance).toHaveCSS("color", "rgb(23, 23, 23)");
  await expect(page.locator("#root")).toBeEmpty();
});

test("supported engines keep the compatibility screen hidden", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#unsupported-engine")).toBeHidden();
  await expect(page.locator("#root")).not.toBeEmpty();
});
