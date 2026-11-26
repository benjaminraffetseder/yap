import { expect, test } from "@playwright/test";

test("diff controls reach the top border of a padded scroll container", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("desktop-theme", "dark"));
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/tests/transcript-diff-fixture.tsx";
    (await import(path)).mount();
  });
  const dialog = page.getByRole("dialog", { name: "Diff fixture", exact: true });
  await dialog.evaluate((element) => {
    element.scrollTop = 400;
  });
  const controls = dialog.locator('[data-slot="transcript-diff-controls"]');
  await expect
    .poll(async () => (await controls.boundingBox())!.y - (await dialog.boundingBox())!.y)
    .toBeLessThan(2);
  await expect
    .poll(async () => (await controls.boundingBox())!.y - (await dialog.boundingBox())!.y)
    .toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: info.outputPath("diff-sticky-top.png") });
});
