import { expect, type Page } from "@playwright/test";

export async function openSelectionMenu(page: Page) {
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  const editing = await page.evaluate(() => document.activeElement instanceof HTMLTextAreaElement);
  if (editing) {
    await page.keyboard.press("Shift+F10");
  } else {
    const point = await page.evaluate(() => {
      const range = window.getSelection()?.getRangeAt(0);
      const rect =
        range &&
        Array.from(range.getClientRects()).find(
          (rect) => rect.bottom > 0 && rect.top < innerHeight,
        );
      if (!rect) throw new Error("Select visible transcript text before opening its menu");
      return {
        x: rect.left + Math.min(rect.width / 2, 10),
        y: Math.max(1, rect.top + rect.height / 2),
      };
    });
    await page.mouse.click(point.x, point.y, { button: "right" });
  }
  await expect(page.getByRole("menu")).toBeVisible();
}
