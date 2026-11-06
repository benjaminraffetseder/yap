import { expect, test } from "@playwright/test";
import en from "../src/i18n/locales/en.json" with { type: "json" };
import de from "../src/i18n/locales/de.json" with { type: "json" };

test("English and German catalogs have matching keys and interpolation variables", () => {
  expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  for (const [key, value] of Object.entries(en)) {
    const translated = de[key as keyof typeof de];
    expect(translated.trim(), key).not.toBe("");
    expect(translated.match(/\{\{.*?\}\}/g)?.sort() ?? [], key).toEqual(
      value.match(/\{\{.*?\}\}/g)?.sort() ?? [],
    );
  }
});

test("language switches immediately, persists on reload, and syncs other windows", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("desktop-language")) localStorage.setItem("desktop-language", "en");
  });
  await page.goto("/#/settings?section=general");
  const otherWindow = await context.newPage();
  await otherWindow.goto("/");
  await page.getByRole("combobox", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "Deutsch", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Einstellungen", exact: true })).toBeVisible();
  await expect(otherWindow.locator("html")).toHaveAttribute("lang", "de");
  await expect(
    otherWindow.getByRole("heading", { name: "Sprachmodell installieren" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sprache der Oberfläche" })).toContainText(
    "Deutsch",
  );
  await page.getByRole("combobox", { name: "Sprache der Oberfläche" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await otherWindow.close();
});

test("German regional system language is detected without a saved preference", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "de-AT" });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5175/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Sprachmodell installieren" })).toBeVisible();
  await context.close();
});

test("unsupported system and saved languages fall back to English", async ({ browser }) => {
  const context = await browser.newContext({ locale: "fr-FR" });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("desktop-language", "invalid"));
  await page.goto("http://127.0.0.1:5175/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Install a speech model" })).toBeVisible();
  await context.close();
});

test("language selection still works when preference storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage blocked");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.goto("/#/settings?section=general");
  await page.getByRole("combobox", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "Deutsch", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible();
});

test("German remains selected across all main screens", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("desktop-language", "de"));
  for (const [path, heading] of [
    ["history", "Verlauf"],
    ["models", "Modelle"],
    ["vocabulary", "Wortschatz"],
    ["prompts", "Prompts & Ketten"],
    ["settings?section=general", "Einstellungen"],
    ["missing", "Seite nicht gefunden"],
  ]) {
    await page.goto(`/#/${path}`);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  }
});
