import { expect, test, type Page } from "@playwright/test";
import type { Settings, Snapshot } from "../src/lib/backend";

// Synthetic catalog state, using the shipping catalog's actual IDs and byte sizes.
// The real app and Wails v3 transport run against controlled lifecycle responses.
const catalog = [
  { id: "tiny", name: "Whisper Tiny", size: 77691713 },
  { id: "base", name: "Whisper Base", size: 147951465 },
  { id: "small", name: "Whisper Small", size: 487601967 },
  { id: "medium", name: "Whisper Medium", size: 1533763059 },
  { id: "large-v3", name: "Whisper Large v3", size: 3095033483 },
  { id: "parakeet-tdt-0.6b-v3", name: "NVIDIA Parakeet TDT v3", size: 713975456 },
  { id: "moonshine-v2-tiny", name: "Moonshine V2 Tiny", size: 45233659 },
  { id: "moonshine-v2-small", name: "Moonshine V2 Small", size: 142300974 },
  { id: "moonshine-v2-medium", name: "Moonshine V2 Medium", size: 269141623 },
  { id: "moonshine-base", name: "Moonshine Base", size: 141001190 },
];

declare global {
  interface Window {
    modelGuidanceTest: {
      snapshot: Snapshot;
      calls: string[];
      callbacks: Record<string, (data?: unknown) => void>;
      failInstall: boolean;
      failSave: boolean;
      failRemove: boolean;
      finishRemoval?: () => void;
      deferRemoval: boolean;
      status: (phase: string, message?: string) => void;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((catalog) => {
    localStorage.setItem("desktop-theme", "light");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const state: Window["modelGuidanceTest"] = {
      snapshot: {
        settings: {
          microphoneId: "",
          whisperPath: "/whisper",
          modelPath: "/tiny",
          language: "auto",
          shortcut: "Ctrl+Alt+Space",
          interaction: "hold",
          autoCopy: true,
          autoPaste: true,
          saveHistory: true,
          saveAudio: false,
          launchAtLogin: false,
          startInTray: false,
          cleanText: false,
          setupComplete: true,
          historyRetentionDays: 0,
        },
        textProcessing: {
          enabled: false,
          endpoint: "http://127.0.0.1:11434/v1",
          model: "",
          autoPromptId: "",
          prompts: [],
        },
        status: {
          phase: "idle",
          message: "Ready",
          progress: 0,
          startedAt: 0,
          transcript: "",
          shortcutError: "",
          indicatorError: "",
          trayError: "",
          startupError: "",
          historyError: "",
        },
        models: catalog.map((model) => ({
          ...model,
          description: "Synthetic catalog fixture",
          installed: ["tiny", "base"].includes(model.id),
          path: `/${model.id}`,
          diskBytes: ["tiny", "base"].includes(model.id) ? model.size : 0,
          removable: ["tiny", "base"].includes(model.id),
        })),
        history: [],
        dataDir: "",
        ready: true,
        floatingIndicator: true,
        launchAtLoginAvailable: true,
        startInTrayAvailable: true,
        vocabulary: [],
        microphoneTested: false,
        shortcutTested: false,
        diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
      },
      calls: [],
      callbacks: {},
      failInstall: false,
      failSave: false,
      failRemove: false,
      deferRemoval: false,
      status(phase, message = "Ready") {
        state.snapshot.status = { ...state.snapshot.status, phase, message };
        state.callbacks["dictation:status"]?.(structuredClone(state.snapshot.status));
      },
    };
    window.modelGuidanceTest = state;
    Reflect.set(window, "mockEvents", {
      subscribe(name: string, callback: (data?: unknown) => void) {
        state.callbacks[name] = callback;
      },
    });
    Reflect.set(window, "mockBackend", {
      main: {
        App: {
          GetSnapshot: async () => structuredClone(state.snapshot),
          CheckForUpdates: async () => ({ available: false, error: "" }),
          GetMicrophones: async () => [],
          GetHistory: async () => ({ entries: [], total: 0, hasMore: false }),
          InstallModel: async (id: string) => {
            state.calls.push(`install:${id}`);
            if (state.failInstall) throw new Error("Synthetic download failure. Try again.");
            state.snapshot.status.progress = 0.42;
            state.status("downloading", "Synthetic download: checking model and runtime files.");
          },
          SaveSettings: async (settings: Settings) => {
            state.calls.push(`use:${settings.modelPath}`);
            if (state.failSave) throw new Error("Synthetic model switch failure");
            state.snapshot.settings = structuredClone(settings);
          },
          RemoveModel: async (id: string) => {
            state.calls.push(`remove:${id}`);
            if (state.deferRemoval)
              await new Promise<void>((resolve) => {
                state.finishRemoval = resolve;
              });
            if (state.failRemove) throw new Error("Synthetic removal failure");
            const model = state.snapshot.models.find((model) => model.id === id)!;
            Object.assign(model, { installed: false, removable: false, diskBytes: 0 });
          },
          Cancel: async () => {
            state.calls.push("cancel");
            state.status("idle", "Download cancelled.");
          },
        },
      },
    });
    document.addEventListener("DOMContentLoaded", () => {
      const label = document.createElement("div");
      label.textContent = "Synthetic catalog · simulated lifecycle";
      label.style.cssText =
        "position:fixed;right:10px;top:4px;z-index:9999;background:#27231f;color:#fff;padding:3px 8px;border-radius:4px;font:11px/16px system-ui;pointer-events:none";
      document.body.append(label);
    });
  }, catalog);
});

const guide = (page: Page) => page.getByRole("region", { name: "Find a starting point" });

test("German guidance keeps model IDs and spoken language independent from the interface", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-language", "de");
    window.modelGuidanceTest.snapshot.settings.language = "en";
  });
  await page.goto("/#/models");
  await page.getByRole("button", { name: "Auswahlhilfe", exact: true }).click();
  const germanGuide = page.getByRole("region", { name: "Finde einen Ausgangspunkt" });
  await germanGuide.getByRole("combobox", { name: "Sprache für die Auswahlhilfe" }).click();
  await page.getByRole("option", { name: "Englisch", exact: true }).click();
  await expect(germanGuide.getByRole("status")).toContainText("Moonshine V2 Small");
  await germanGuide.getByRole("combobox", { name: "Sprache für die Auswahlhilfe" }).click();
  await page.getByRole("option", { name: "Deutsch", exact: true }).click();
  await expect(germanGuide.getByRole("status")).toContainText("NVIDIA Parakeet TDT v3");
  expect(await page.evaluate(() => window.modelGuidanceTest.snapshot.settings.language)).toBe("en");
  await page.goto("/#/settings?section=general");
  await page.getByRole("combobox", { name: "Sprache der Oberfläche" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => window.modelGuidanceTest.snapshot.settings.language)).toBe("en");
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
});
const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const help = (page: Page) => page.getByRole("button", { name: "Help me choose", exact: true });
async function revealGuidance(page: Page) {
  if ((await help(page).getAttribute("aria-expanded")) === "false") await help(page).click();
  await expect(guide(page)).toBeVisible();
}
async function choose(page: Page, label: string, option: string) {
  await revealGuidance(page);
  await guide(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function openModels(page: Page, showGuidance = true) {
  await page.goto("/#/models");
  await expect(help(page)).toHaveAttribute("aria-expanded", "false");
  await expect(guide(page)).toBeHidden();
  if (showGuidance) {
    await revealGuidance(page);
    await expect(guide(page).getByRole("status")).toContainText("Whisper Small");
  }
}

test("Models starts with its current model and usable catalog, with optional help beside the heading", async ({
  page,
}) => {
  await openModels(page, false);
  await expect(page.getByRole("region", { name: "Current speech model" })).toBeInViewport();
  await expect(card(page, "Whisper Tiny").getByRole("heading")).toBeInViewport();
  await expect(
    card(page, "Whisper Base").getByRole("button", { name: "Use model", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Language for guidance" })).toHaveCount(0);
  const heading = await page
    .getByRole("heading", { name: "Choose your model", exact: true })
    .boundingBox();
  const control = await help(page).boundingBox();
  expect(Math.abs(heading!.y - control!.y)).toBeLessThan(12);
  expect(await help(page).getAttribute("aria-controls")).toBeTruthy();
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
});

test("keyboard disclosure preserves choices across closing, reopening and Show model focus", async ({
  page,
}) => {
  await openModels(page, false);
  await help(page).focus();
  await page.keyboard.press("Enter");
  await expect(guide(page)).toBeVisible();
  await expect(help(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(guide(page).getByRole("combobox", { name: "Language for guidance" })).toBeFocused();
  await choose(page, "Language for guidance", "English");
  await choose(page, "What will you dictate?", "Difficult audio / quality first");
  await help(page).focus();
  await page.keyboard.press("Space");
  await expect(guide(page)).toBeHidden();
  await expect(help(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(guide(page).getByRole("combobox", { name: "Language for guidance" })).toContainText(
    "English",
  );
  await expect(guide(page).getByRole("combobox", { name: "What will you dictate?" })).toContainText(
    "Difficult audio / quality first",
  );
  await expect(guide(page).getByRole("status")).toContainText("Whisper Large v3");
  await guide(page).getByRole("button", { name: "Show model" }).focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "Whisper Large v3").getByRole("heading")).toBeFocused();
  await expect(guide(page)).toBeHidden();
  await expect(help(page)).toHaveAttribute("aria-expanded", "false");
  await revealGuidance(page);
  await expect(guide(page).getByRole("status")).toContainText("Whisper Large v3");
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
});

test("language and task guidance uses catalog coverage without mutating model or settings", async ({
  page,
}) => {
  await openModels(page);
  await expect(guide(page).getByRole("status")).toContainText("487.6 MB");
  for (const [language, task, model] of [
    ["English", "Emails & everyday dictation", "Moonshine V2 Small"],
    ["English", "Quick notes / small download", "Moonshine V2 Tiny"],
    ["English", "Difficult audio / quality first", "Whisper Large v3"],
    ["German", "Emails & everyday dictation", "NVIDIA Parakeet TDT v3"],
    ["German", "Quick notes / small download", "Whisper Base"],
    ["Japanese", "Emails & everyday dictation", "Whisper Small"],
    ["Japanese", "Difficult audio / quality first", "Whisper Large v3"],
    ["Cantonese", "Quick notes / small download", "Whisper Large v3"],
    ["Not sure / multiple languages", "Emails & everyday dictation", "Whisper Small"],
  ]) {
    await choose(page, "Language for guidance", language);
    await choose(page, "What will you dictate?", task);
    await expect(guide(page).getByRole("status")).toContainText(model);
  }
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
  expect(
    await page.evaluate(() => ({
      path: window.modelGuidanceTest.snapshot.settings.modelPath,
      language: window.modelGuidanceTest.snapshot.settings.language,
    })),
  ).toEqual({ path: "/tiny", language: "auto" });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(guide(page)).toBeHidden();
  await revealGuidance(page);
  await expect(guide(page).getByRole("combobox", { name: "Language for guidance" })).toContainText(
    "Not sure / multiple languages",
  );
});

test("quality-first guidance follows catalog ratings and the available compatible models", async ({
  page,
}) => {
  await openModels(page);
  await choose(page, "Language for guidance", "English");
  await choose(page, "What will you dictate?", "Difficult audio / quality first");
  await expect(guide(page).getByRole("status")).toContainText("Whisper Large v3");
  await page.evaluate(() => {
    const state = window.modelGuidanceTest;
    state.snapshot.models = state.snapshot.models.filter((model) =>
      model.id.startsWith("moonshine"),
    );
    state.callbacks["dictation:history"]();
  });
  await expect(guide(page).getByRole("status")).toContainText("Moonshine V2 Medium");
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
});

test("Show model reveals its family and focuses its heading; explicit download can cancel, fail and retry", async ({
  page,
}) => {
  await openModels(page);
  await choose(page, "Language for guidance", "English");
  const show = guide(page).getByRole("button", { name: "Show model" });
  await show.focus();
  await page.keyboard.press("Enter");
  const moonshine = card(page, "Moonshine V2 Small");
  await expect(moonshine.getByRole("heading")).toBeFocused();
  await expect(guide(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Moonshine models", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
  const action = moonshine.getByRole("button", { name: "Download & use", exact: true });
  await action.click();
  await expect(moonshine.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  await expect(
    card(page, "Whisper Base").getByRole("button", { name: "Use model", exact: true }),
  ).toBeDisabled();
  await choose(page, "Language for guidance", "Japanese");
  await expect(moonshine.getByRole("button", { name: "Cancel download" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
    "Whisper Tiny",
  );
  await moonshine.getByRole("button", { name: "Cancel download" }).click();
  await expect(action).toBeEnabled();
  await page.evaluate(() => {
    window.modelGuidanceTest.failInstall = true;
  });
  await action.click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Synthetic download failure" }),
  ).toBeVisible();
  await expect(action).toBeEnabled();
  await page.evaluate(() => {
    window.modelGuidanceTest.failInstall = false;
  });
  await action.click();
  await page.evaluate(() => {
    const state = window.modelGuidanceTest;
    const model = state.snapshot.models.find((model) => model.id === "moonshine-v2-small")!;
    Object.assign(model, { installed: true, removable: true, diskBytes: model.size });
    state.snapshot.settings.modelPath = model.path;
    state.status("idle", "Model installed. Ready to dictate.");
    state.callbacks["dictation:history"]();
  });
  await expect(moonshine.getByRole("button", { name: "Active", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
    "Moonshine V2 Small",
  );
});

test("unknown language, custom models and unavailable catalog suggestions stay safe", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const s = window.modelGuidanceTest.snapshot;
    s.settings.language = "unknown-language";
    s.settings.modelPath = "/local/custom.bin";
  });
  await openModels(page);
  await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
    "Custom model",
  );
  await expect(guide(page).getByRole("combobox", { name: "Language for guidance" })).toContainText(
    "Not sure / multiple languages",
  );
  for (const name of ["Whisper models", "NVIDIA Parakeet models", "Moonshine models"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible();
  await page.evaluate(() => {
    window.modelGuidanceTest.snapshot.models = window.modelGuidanceTest.snapshot.models.filter(
      (model) => model.id === "moonshine-base",
    );
    window.modelGuidanceTest.callbacks["dictation:history"]();
  });
  await choose(page, "Language for guidance", "Japanese");
  await expect(guide(page).getByRole("status")).toContainText("No catalog suggestion");
  await expect(guide(page).getByRole("button", { name: "Show model" })).toHaveCount(0);
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
});

test("keyboard language details retain priority when scrolling moves another badge under the pointer", async ({
  page,
}) => {
  await openModels(page);
  await choose(page, "Language for guidance", "German");
  await guide(page).getByRole("button", { name: "Show model" }).focus();
  await page.keyboard.press("Enter");
  const focusedBadge = page.getByRole("button", {
    name: "Supported languages for NVIDIA Parakeet TDT v3",
    exact: true,
  });
  await expect(card(page, "NVIDIA Parakeet TDT v3").getByRole("heading")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focusedBadge).toBeFocused();
  const tooltip = page.locator('[data-slot="tooltip-content"][data-open]');
  await expect(tooltip).toContainText("25 languages");
  await page
    .getByRole("button", { name: "Supported languages for Whisper Tiny", exact: true })
    .hover();
  await expect(focusedBadge).toBeFocused();
  await expect(tooltip).toContainText("25 languages");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
});

test("explicit installed selection, repair, busy and pending removal retain lifecycle guards", async ({
  page,
}) => {
  await openModels(page);
  await choose(page, "What will you dictate?", "Quick notes / small download");
  await guide(page).getByRole("button", { name: "Show model" }).click();
  const base = card(page, "Whisper Base");
  await page.evaluate(() => {
    window.modelGuidanceTest.failSave = true;
  });
  await base.getByRole("button", { name: "Use model", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Synthetic model switch failure" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
    "Whisper Tiny",
  );
  await page.evaluate(() => {
    window.modelGuidanceTest.failSave = false;
  });
  await base.getByRole("button", { name: "Use model", exact: true }).click();
  await expect(base.getByRole("button", { name: "Active", exact: true })).toBeDisabled();
  await revealGuidance(page);
  await expect(guide(page)).toContainText("already active");
  await page.evaluate(() => {
    window.modelGuidanceTest.status("recording");
  });
  await expect(page.getByRole("button", { name: "Check & repair runtime" })).toBeDisabled();
  await expect(
    card(page, "Whisper Small").getByRole("button", { name: "Download & use", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.modelGuidanceTest.status("idle");
    window.modelGuidanceTest.deferRemoval = true;
    window.modelGuidanceTest.failRemove = true;
  });
  await card(page, "Whisper Tiny")
    .getByRole("button", { name: "Remove Whisper Tiny", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Remove model", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Removing…" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.evaluate(() => window.modelGuidanceTest.finishRemoval?.());
  await expect(dialog.getByRole("alert")).toContainText("Synthetic removal failure");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    const s = window.modelGuidanceTest;
    Object.assign(
      s.snapshot.models.find((model) => model.id === "small")!,
      { removable: true },
    );
    s.callbacks["dictation:history"]();
  });
  await choose(page, "What will you dictate?", "Emails & everyday dictation");
  await expect(guide(page)).toContainText("Choose Repair & use");
  await guide(page).getByRole("button", { name: "Show model" }).click();
  await card(page, "Whisper Small")
    .getByRole("button", { name: "Repair & use", exact: true })
    .click();
  await expect(card(page, "Whisper Small").getByRole("progressbar")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`synthetic media: ${theme} desktop, narrow and 200 percent text`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("desktop-theme", theme), theme);
    await openModels(page, false);
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^$/);
    await page.screenshot({
      path: testInfo.outputPath(`models-${theme}-desktop.png`),
      animations: "disabled",
    });
    await revealGuidance(page);
    await guide(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`models-${theme}-desktop-help.png`),
      animations: "disabled",
    });
    await help(page).click();
    await page.setViewportSize({ width: 480, height: 900 });
    await page.getByRole("heading", { name: "Models", exact: true }).scrollIntoViewIfNeeded();
    await expect(guide(page)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`models-${theme}-narrow.png`),
      animations: "disabled",
    });
    await revealGuidance(page);
    await guide(page).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`models-${theme}-narrow-help.png`),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 760, height: 560 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await guide(page).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await guide(page).getByRole("combobox", { name: "What will you dictate?" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("option", { name: "Difficult audio / quality first", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("option")
        .evaluateAll((options) =>
          options.every((option) => option.scrollWidth <= option.clientWidth + 1),
        ),
    ).toBe(true);
    expect(
      await guide(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`models-${theme}-760-200text.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(
      guide(page).getByRole("combobox", { name: "What will you dictate?" }),
    ).toBeFocused();
    await guide(page).getByRole("button", { name: "Show model" }).click();
    await expect(card(page, "Whisper Small").getByRole("heading")).toBeFocused();
    expect(
      await card(page, "Whisper Small").evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await card(page, "Whisper Small")
      .getByRole("button", { name: "Download & use", exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await card(page, "Whisper Small")
        .getByRole("button", { name: "Download & use", exact: true })
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`model-action-${theme}-760-200text.png`),
      animations: "disabled",
    });
  });
}

test("embedded setup, reduced motion and long model names remain usable", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const s = window.modelGuidanceTest.snapshot;
    s.settings.setupComplete = false;
    s.settings.language = "de";
    s.models.find((model) => model.id === "parakeet-tdt-0.6b-v3")!.name =
      `NVIDIA Parakeet ${"VeryLongModelName".repeat(8)}`;
  });
  await page.setViewportSize({ width: 760, height: 560 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose your speech model" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toHaveCount(0);
  await expect(help(page)).toHaveAttribute("aria-expanded", "false");
  await expect(guide(page)).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("embedded-default.png"),
    animations: "disabled",
  });
  await revealGuidance(page);
  await expect(guide(page).getByRole("status")).toContainText("NVIDIA Parakeet");
  await guide(page).getByRole("button", { name: "Show model" }).click();
  const heading = page.locator('[id="model-parakeet-tdt-0.6b-v3-heading"]');
  await expect(heading).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("embedded-long-name-reduced-motion.png"),
    animations: "disabled",
  });
  expect(await page.evaluate(() => window.modelGuidanceTest.calls)).toEqual([]);
});

test("synthetic interaction walkthrough", async ({ page }, testInfo) => {
  await openModels(page, false);
  await page.waitForTimeout(900);
  await help(page).click();
  await guide(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await choose(page, "Language for guidance", "German");
  await page.waitForTimeout(600);
  await help(page).click();
  await page.waitForTimeout(600);
  await help(page).click();
  await expect(guide(page).getByRole("combobox", { name: "Language for guidance" })).toContainText(
    "German",
  );
  await guide(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await guide(page).getByRole("button", { name: "Show model" }).click();
  const parakeet = card(page, "NVIDIA Parakeet TDT v3");
  await expect(parakeet.getByRole("heading")).toBeFocused();
  await expect(help(page)).toHaveAttribute("aria-expanded", "false");
  await page.waitForTimeout(600);
  await parakeet.getByRole("button", { name: "Download & use", exact: true }).click();
  await expect(parakeet.getByRole("progressbar")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("synthetic-download-progress.png"),
    animations: "disabled",
  });
  await page.waitForTimeout(900);
  await parakeet.getByRole("button", { name: "Cancel download" }).click();
  await expect(parakeet.getByRole("button", { name: "Download & use", exact: true })).toBeEnabled();
  await page.waitForTimeout(600);
});
