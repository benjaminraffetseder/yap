import { expect, test, type Locator, type Page } from "@playwright/test";
import de from "../src/i18n/locales/de.json" with { type: "json" };
import en from "../src/i18n/locales/en.json" with { type: "json" };
import type {
  AppProfileRule,
  BackupPreview,
  BackupSummary,
  DiagnosticCheck,
  DictationProfile,
  GeneratedOutput,
  HomeResult,
  Session,
  Settings,
  Snapshot,
  Status,
  TextProcessing,
  TextPrompt,
  TranscriptExportRequest,
  TranscriptExportSelection,
  VocabularyEntry,
} from "../src/lib/backend";

function activeDialog(page: Page) {
  return page
    .getByRole("dialog")
    .filter({ hasNot: page.getByRole("tablist", { name: "Settings sections", exact: true }) })
    .filter({ hasNot: page.getByRole("region", { name: "Recording options", exact: true }) });
}
function profileEditor(page: Page) {
  return page.getByRole("region", { name: /^(New|Edit) dictation profile$/ });
}
async function expectRailFits(page: Page, font: number) {
  // Enlarged navigation must leave useful reading space instead of doubling
  // the desktop rail. The dedicated navigation test covers its accessible labels.
  const rail = page.locator("#app-sidebar");
  await expect
    .poll(async () => (await rail.boundingBox())!.width)
    .toBeLessThanOrEqual(font === 200 ? 144 : 92);
  expect((await rail.boundingBox())!.width).toBeGreaterThanOrEqual(56);
}
async function expectActiveModel(row: Locator) {
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  await expect(
    row.getByRole("button", { name: /^(Use model|Download & use|Repair & use)$/ }),
  ).toHaveCount(0);
}

function currentSpeechModel(page: Page) {
  return page
    .locator('section[aria-current="true"]')
    .or(page.getByRole("region", { name: "Current speech model", exact: true }));
}
async function modelMenu(page: Page, name?: string) {
  await page.keyboard.press("Escape");
  const row = name ? page.getByRole("region", { name, exact: true }) : currentSpeechModel(page);
  await row.getByRole("button", { name: /^More actions/ }).click();
  return page.getByRole("menu");
}
async function modelAction(page: Page, action: string, name?: string) {
  const menu = await modelMenu(page, name);
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
}
async function detailAction(page: Page, action: string) {
  await page.getByRole("button", { name: "Dictation actions", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function openRecordingOptions(page: Page) {
  const trigger = page.getByRole("button", { name: "Recording options", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.click();
}
async function showServerAddress(page: Page) {
  const field = page.getByLabel("Local server URL", { exact: true });
  if (!(await field.isVisible())) await page.getByText("Server address", { exact: true }).click();
  await expect(field).toBeVisible();
}
async function outputAction(page: Page, action: string) {
  if (action === "Delete output") {
    await page
      .getByRole("region", { name: "Generated outputs", exact: true })
      .getByRole("button", { name: "Output actions", exact: true })
      .click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    return;
  }
  await page
    .getByRole("region", { name: "Generated outputs", exact: true })
    .getByRole("button", { name: action, exact: true })
    .click();
}
async function showCustomModelFiles(page: Page) {
  const summary = page.getByText("Custom model and runtime files", { exact: true });
  const details = summary.locator("..");
  if ((await details.getAttribute("open")) === null) await summary.click();
}
async function generateWith(page: Page, name = "Generate output") {
  const button = page.getByRole("button", { name, exact: true });
  const trigger = page.getByRole("button", { name: "New output", exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await button.click();
  await expect(page.getByRole("dialog", { name: "Create an output", exact: true })).toBeHidden();
}
async function selectSavedOutput(page: Page, index: number) {
  await page.locator("#saved-output").click();
  await page.getByRole("option").nth(index).click();
}

async function navigateMain(page: Page, name: string) {
  // Settings is now modal: close it before navigating the calling page.
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (new URL(page.url()).hash.startsWith("#/settings")) {
    await expect(settings).toBeVisible();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(settings).toHaveCount(0);
  }
  await page.getByRole("link", { name, exact: true }).click();
}

async function homeSurfaceScenario(page: Page, modified = false) {
  await page.addInitScript((modified) => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const state = window.dictationTest;
    state.snapshot.settings.interaction = "toggle";
    state.snapshot.settings.shortcut = "Ctrl+F12";
    state.snapshot.models = [
      {
        id: "small",
        name: "Whisper Small",
        description: "Speech model",
        size: 100,
        installed: true,
        path: "/model",
        diskBytes: 100,
        removable: true,
      },
    ];
    state.snapshot.dictationProfiles = [
      {
        id: "default",
        name: "Default",
        modelPath: "/model",
        language: "auto",
        cleanText: false,
        autoPromptId: "",
      },
    ];
    state.snapshot.defaultProfileId = "default";
    state.snapshot.activeProfileId = "default";
    if (modified) state.snapshot.settings.language = "de";
    state.snapshot.history = [
      {
        id: "preview",
        createdAt: "2026-10-30T10:42:00",
        durationMs: 18000,
        rawTranscript: "Remember to send the updated notes after our meeting.",
        finalTranscript: "Remember to send the updated notes after our meeting.",
        speechModel: "small",
        language: "en",
        audioPath: "",
      },
    ];
  }, modified);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Latest saved result", exact: true }),
  ).toContainText("Remember to send the updated notes after our meeting.");
  // These scenarios exercise the disclosed configuration and profile controls.
  await openRecordingOptions(page);
}

test("home surface shares a document frame and keeps other pages inset", async ({ page }) => {
  await homeSurfaceScenario(page);
  const recorder = page.getByRole("region", { name: "Dictation recorder" });
  const main = page.getByRole("main");
  const content = await main.boundingBox();
  const surface = await recorder.boundingBox();
  const frame = await page.locator('[data-slot="home-document-frame"]').boundingBox();
  expect(frame!.x).toBeGreaterThan(content!.x);
  expect(frame!.x + frame!.width).toBeLessThan(content!.x + content!.width);
  expect(surface!.x).toBeGreaterThanOrEqual(frame!.x);
  expect(surface!.x + surface!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  const start = await recorder
    .getByRole("button", { name: "Start recording", exact: true })
    .boundingBox();
  const text = await page.locator("#home-result-text").boundingBox();
  expect(Math.abs(start!.x - text!.x)).toBeLessThanOrEqual(1);
  await expect(recorder).toHaveCSS("border-top-left-radius", "0px");
  await expect(recorder).toHaveCSS("border-top-width", "0px");
  await expect(
    recorder.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Shortcuts", exact: true });
  expect((await heading.boundingBox())!.x).toBeGreaterThan(content!.x);
  await page.goto("/");
  await expect(recorder).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.setupComplete = false;
    window.dictationTest.history();
  });
  await expect(page.getByRole("heading", { name: "Choose your speech model" })).toBeVisible();
  await expect(recorder).toHaveCount(0);
});

test("home surface profile actions stay compact and open explicit review dialogs", async ({
  page,
}) => {
  await homeSurfaceScenario(page, true);
  const modified = page.getByRole("button", { name: "Modified", exact: true });
  await expect(modified).toBeVisible();
  await expect(page.getByRole("button", { name: "Update profile", exact: true })).toHaveCount(0);
  await modified.click();
  await expect(page.getByRole("region", { name: "Profile changes", exact: true })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Save as new…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save as new profile" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Recording options", exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("region", { name: "Recording options", exact: true, includeHidden: true }),
  ).toBeHidden();
  await expect(dialog.getByLabel("Profile name")).toBeFocused();
  await dialog.getByLabel("Profile name").fill("Work notes");
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.dictationTest.snapshot.dictationProfiles!.length)).toBe(
    1,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recording options", exact: true })).toBeFocused();
  await openRecordingOptions(page);
  await modified.click();
  await page.getByRole("button", { name: "Update profile…", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Update profile", exact: true })
    .click();
  await expect(activeDialog(page)).toHaveCount(0);
  await expect(modified).toHaveCount(0);
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.dictationProfiles![0].language),
  ).toBe("de");
  await expect(page.getByRole("button", { name: "Recording options", exact: true })).toBeFocused();
});

test("home surface restores only the four profile choices and keeps a keyboard focus target", async ({
  page,
}) => {
  await homeSurfaceScenario(page, true);
  const before = await page.evaluate(() => structuredClone(window.dictationTest.snapshot.settings));
  await page.getByRole("button", { name: "Modified", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Restore saved choices" }).press("Enter");
  await expect(page.getByRole("button", { name: "Modified", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Dictation profile", exact: true }),
  ).toBeFocused();
  const after = await page.evaluate(() => window.dictationTest.snapshot.settings);
  expect(after).toEqual({ ...before, language: "auto" });
  expect(await page.evaluate(() => window.dictationTest.snapshot.dictationProfiles!.length)).toBe(
    1,
  );
});

test("home surface Save as new keeps IME input and failed writes, then creates once without activating", async ({
  page,
}) => {
  await homeSurfaceScenario(page, true);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.settings.modelPath = "/other-model";
    state.snapshot.settings.cleanText = true;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.autoPromptId = "summary";
    state.history();
  });
  await page.getByRole("button", { name: "Modified", exact: true }).click();
  await page.getByRole("button", { name: "Save as new…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save as new profile" });
  const input = dialog.getByLabel("Profile name");
  const save = dialog.getByRole("button", { name: "Save as new", exact: true });
  await input.fill("default");
  await expect(save).toBeDisabled();
  await input.fill("仕事のメモ");
  const prevented = await input.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(await page.evaluate(() => window.dictationTest.snapshot.dictationProfiles!.length)).toBe(
    1,
  );
  await input.evaluate((input) =>
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Could not save profile");
  await expect(input).toHaveValue("仕事のメモ");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await save.click();
  await expect(dialog).toHaveCount(0);
  const state = await page.evaluate(() => ({
    profiles: window.dictationTest.snapshot.dictationProfiles,
    active: window.dictationTest.snapshot.activeProfileId,
    language: window.dictationTest.snapshot.settings.language,
  }));
  expect(state.profiles).toHaveLength(2);
  expect(state.profiles!.find((p) => p.name === "仕事のメモ")).toMatchObject({
    language: "de",
    cleanText: true,
    modelPath: "/other-model",
    autoPromptId: "summary",
  });
  expect(state.active).toBe("default");
  expect(state.language).toBe("de");
  await expect(page.getByRole("button", { name: "Recording options", exact: true })).toBeFocused();
});

test("home surface blocks stale review and fresh busy state before any profile write", async ({
  page,
}) => {
  await homeSurfaceScenario(page, true);
  for (const change of ["busy", "choices"] as const) {
    await openRecordingOptions(page);
    await page.getByRole("button", { name: "Modified", exact: true }).click();
    await page.getByRole("button", { name: "Update profile…", exact: true }).click();
    await page.evaluate((change) => {
      // Deliberately omit an event: only the fresh backend read can catch this.
      if (change === "busy") window.dictationTest.snapshot.status.phase = "recording";
      else window.dictationTest.snapshot.settings.language = "fr";
    }, change);
    const dialog = activeDialog(page);
    await dialog.getByRole("button", { name: "Update profile", exact: true }).click();
    await expect(dialog.getByRole("alert").first()).toContainText(
      change === "busy" ? "Finish the current operation" : "changed",
    );
    expect(
      await page.evaluate(() => window.dictationTest.snapshot.dictationProfiles![0].language),
    ).toBe("auto");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(() => window.dictationTest.status("idle"));
  }
});

test("home surface successful save with failed refresh retries the refresh without duplicating", async ({
  page,
}) => {
  await homeSurfaceScenario(page, true);
  await page.getByRole("button", { name: "Modified", exact: true }).click();
  await page.getByRole("button", { name: "Save as new…", exact: true }).click();
  const dialog = activeDialog(page);
  await dialog.getByLabel("Profile name").fill("Work notes");
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    const save = app.SaveDictationProfile;
    Reflect.set(window, "profileWrites", 0);
    app.SaveDictationProfile = async (profile: DictationProfile) => {
      Reflect.set(window, "profileWrites", Reflect.get(window, "profileWrites") + 1);
      const saved = await save(profile);
      window.dictationTest.failSnapshot = true;
      return saved;
    };
  });
  await dialog.getByRole("button", { name: "Save as new", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Changes saved");
  await expect(dialog.getByLabel("Profile name")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save as new", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.failSnapshot = false;
  });
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "profileWrites"))).toBe(1);
  expect(await page.evaluate(() => window.dictationTest.snapshot.dictationProfiles!.length)).toBe(
    2,
  );
  await expect(page.getByRole("button", { name: "Recording options", exact: true })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Work notes" })).toContainText("Default");
});

test("home surface profile save blocks recording, selectors and repeated keyboard submissions while pending", async ({
  page,
}) => {
  await homeSurfaceScenario(page, true);
  await page.getByRole("button", { name: "Modified", exact: true }).click();
  await page.getByRole("button", { name: "Save as new…", exact: true }).click();
  const dialog = activeDialog(page);
  await dialog.getByLabel("Profile name").fill("Work notes");
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    const save = app.SaveDictationProfile;
    Reflect.set(window, "profileWrites", 0);
    app.SaveDictationProfile = async (profile: DictationProfile) => {
      Reflect.set(window, "profileWrites", Reflect.get(window, "profileWrites") + 1);
      await new Promise<void>((resolve) => Reflect.set(window, "releaseProfileSave", resolve));
      return save(profile);
    };
  });
  await dialog.getByLabel("Profile name").press("Enter");
  await expect(
    page.getByRole("button", { name: "Start recording", includeHidden: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Dictation profile", includeHidden: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: "Speech model", includeHidden: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "profileWrites"))).toBe(1);
  await page.evaluate(() => Reflect.get(window, "releaseProfileSave")());
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  for (const collapsed of [false, true]) {
    for (const font of [100, 200]) {
      test(`home surface layout ${theme} ${collapsed ? "collapsed" : "expanded"} ${font}% text`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ reducedMotion: font === 200 ? "reduce" : "no-preference" });
        await homeSurfaceScenario(page, true);
        await page.evaluate(
          ({ theme, font }) => {
            document.documentElement.classList.toggle("dark", theme === "dark");
            document.documentElement.style.fontSize = `${font}%`;
          },
          { theme, font },
        );
        await expectRailFits(page, font);
        for (const width of [1280, 760]) {
          await page.setViewportSize({ width, height: width === 760 ? 560 : 800 });
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBe(width);
          const recorder = page.getByRole("region", { name: "Dictation recorder" });
          const bounds = await recorder.boundingBox();
          const content = await page.getByRole("main").boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(content!.x);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(content!.x + content!.width);
          const reading = await page.getByLabel("Result text", { exact: true }).boundingBox();
          const start = await page
            .getByRole("button", { name: "Start recording", exact: true })
            .boundingBox();
          expect(start!.x).toBeCloseTo(reading!.x, 0);
          await openRecordingOptions(page);
          const options = page.getByRole("region", { name: "Recording options", exact: true });
          const popup = page.getByRole("dialog", { name: "Recording options", exact: true });
          await expect(popup).toHaveCSS("opacity", "1");
          const popupBounds = await popup.boundingBox();
          const track = await options.getByRole("switch").boundingBox();
          const thumb = await options.locator('[data-slot="switch-thumb"]').boundingBox();
          expect(thumb!.width).toBeLessThanOrEqual(track!.width);
          expect(thumb!.height).toBeLessThanOrEqual(track!.height);
          for (const control of [
            options.getByRole("combobox", { name: "Dictation profile" }),
            options.getByRole("button", { name: "Modified", exact: true }),
            options.getByRole("combobox", { name: "Speech model" }),
            options.getByRole("switch"),
          ]) {
            await control.focus();
            await expect(control).toBeFocused();
            const box = await control.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(popupBounds!.x);
            expect(box!.x + box!.width).toBeLessThanOrEqual(
              popupBounds!.x + popupBounds!.width + 1,
            );
            await expect(control).toBeInViewport();
          }
          await page.keyboard.press("Escape");
          for (const control of [
            recorder.getByRole("button", { name: "Import audio", exact: true }),
            recorder.getByRole("button", { name: "Start recording", exact: true }),
          ]) {
            await control.focus();
            await expect(control).toBeFocused();
            await expect(control).toBeInViewport();
            const box = await control.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
            expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
          }
          await openRecordingOptions(page);
          await page.screenshot({
            path: testInfo.outputPath(`home-${width}.png`),
            fullPage: true,
            animations: "disabled",
          });
          await options.getByRole("button", { name: "Modified", exact: true }).click();
          const changes = page.getByRole("region", { name: "Profile changes", exact: true });
          await expect(changes).toBeInViewport();
          await expect(page.getByRole("menu")).toHaveCount(0);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBe(width);
          await page.getByRole("button", { name: "Save as new…", exact: true }).click();
          const dialog = activeDialog(page);
          await dialog.getByLabel("Profile name").fill("仕事のメモ — Notes for tomorrow");
          await expect
            .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
            .toBe(true);
          await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
          await expect(
            dialog.getByRole("button", { name: "Cancel", exact: true }),
          ).toBeInViewport();
          await page.keyboard.press("Space");
          await expect(dialog).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Recording options", exact: true }),
          ).toBeFocused();
        }
      });
    }
  }
}

test.describe("Home preview", () => {
  test("home surface interaction preview", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await homeSurfaceScenario(page);
    await page.screenshot({ path: testInfo.outputPath("ready-dark.png") });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      window.dictationTest.snapshot.settings.language = "de";
      window.dictationTest.history();
    });
    await page.getByRole("button", { name: "Modified", exact: true }).click();
    await expect(page.getByRole("region", { name: "Profile changes", exact: true })).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("profile-actions-dark.png") });
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Save as new…", exact: true }).click();
    await page.getByLabel("Profile name").fill("Work notes");
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await openRecordingOptions(page);
    await page.getByRole("button", { name: "Modified", exact: true }).click();
    await page.getByRole("button", { name: "Restore saved choices" }).click();
    await expect(page.getByRole("button", { name: "Modified", exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      const state = window.dictationTest;
      state.snapshot.recordingSaveHistory = state.snapshot.settings.saveHistory;
    });
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.evaluate(() => window.dictationTest.callbacks["dictation:level"](0.65));
    await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled();
    await page.waitForTimeout(200);
    await page.screenshot({
      path: testInfo.outputPath("recording-dark.png"),
      animations: "disabled",
    });
    await page.waitForTimeout(1100);
    await page.evaluate(() => {
      const state = window.dictationTest;
      Reflect.get(window, "mockBackend").main.App.StopRecording = async () => {
        state.snapshot.latestResult = {
          session: { ...state.snapshot.history[0], id: "temporary-preview" },
          text: "Let’s give the Home screen more breathing room and keep the everyday controls easy to reach.",
        };
        state.status("idle");
        state.history();
      };
    });
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByRole("region", { name: "Temporary latest result" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("result-dark.png"), animations: "disabled" });
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: testInfo.outputPath("result-light.png"),
      animations: "disabled",
    });
    await page.waitForTimeout(700);
  });
});

async function settingsClarityScenario(
  page: Page,
  section = "dictation",
  theme = "dark",
  collapsed = true,
) {
  await page.addInitScript(
    ({ theme, collapsed }) => {
      localStorage.setItem("desktop-theme", theme);
      localStorage.setItem("yap-sidebar-collapsed", String(collapsed));
      const state = window.dictationTest;
      state.snapshot.settings.shortcut = "Ctrl+F12";
      state.snapshot.settings.interaction = "toggle";
      state.snapshot.models = [
        {
          id: "small",
          name: "Whisper Small",
          description: "Speech model",
          installed: true,
          path: "/model",
          size: 100,
          diskBytes: 100,
          removable: true,
        },
      ];
      state.snapshot.dictationProfiles = [
        {
          id: "default",
          name: "Default",
          modelPath: "/model",
          language: "auto",
          cleanText: false,
          autoPromptId: "",
        },
        {
          id: "work",
          name: "Work notes",
          modelPath: "/model",
          language: "en",
          cleanText: true,
          autoPromptId: "",
        },
      ];
      state.snapshot.defaultProfileId = "default";
      state.snapshot.activeProfileId = "default";
      state.snapshot.appProfileRules = [
        { applicationId: "windows:slack.exe", applicationName: "Slack", profileId: "work" },
      ];
      Reflect.get(window, "mockBackend").main.App.GetAudioSupport = async () => ({
        installed: false,
        managed: false,
        path: "",
        canDownload: true,
        size: 76972461,
        message: "FFmpeg is not installed",
      });
    },
    { theme, collapsed },
  );
  await page.goto(`/#/settings?section=${section}`);
}

for (const lang of ["en", "de"] as const) {
  test(`automatic titles are an app-wide History preference ${lang}`, async ({ page }) => {
    const copy = lang === "de" ? de : en;
    await page.addInitScript((lang) => localStorage.setItem("desktop-language", lang), lang);
    await settingsClarityScenario(page, "history");
    const titles = page.getByRole("switch", {
      name: new RegExp(`^${copy["settingsPage.automaticallyGenerateTitles"]}`),
    });
    await expect(titles).not.toBeChecked();
    await expect(titles).toBeEnabled();
    await expect(
      page.getByText(copy["settingsPage.automaticallyGenerateTitlesHelp"], { exact: true }),
    ).toBeVisible();
    await titles.check();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoGenerateTitles))
      .toBe(true);
    await page.goto("/#/settings?section=profiles");
    await page.goto("/#/settings?section=history");
    await expect(titles).toBeChecked();
    const history = page.getByRole("switch", {
      name: new RegExp(`^${copy["settingsPage.saveDictationsToHistory"]}`),
    });
    await history.uncheck();
    await expect(titles).toBeDisabled();
    await expect(titles).toBeChecked();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.saveHistory))
      .toBe(false);
    await history.check();
    await expect(titles).toBeEnabled();
    await titles.uncheck();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoGenerateTitles))
      .toBe(false);
  });
}

test("settings clarity separates profiles and puts recording controls first", async ({ page }) => {
  await settingsClarityScenario(page);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("tabpanel").locator("h2")).toHaveText([
    "Recording",
    "Shortcuts",
    "Text & delivery",
  ]);
  await expect(page.getByRole("button", { name: "New profile", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Manage dictation profiles", exact: true }).click();
  await expect(page).toHaveURL(/section=profiles/);
  await expect(page.getByRole("tab", { name: "Profiles", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "New profile", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Microphone", exact: true })).toHaveCount(0);
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await page.getByRole("link", { name: "Manage dictation profiles", exact: true }).click();
  await expect(page).toHaveURL(/section=profiles/);
  await expect(page.getByRole("button", { name: "Edit Default", exact: true })).toBeVisible();
});

test("settings clarity preserves section URLs, unrelated parameters and replace navigation", async ({
  page,
}) => {
  await settingsClarityScenario(page);
  for (const [section, label] of [
    ["dictation", "Dictation"],
    ["profiles", "Profiles"],
    ["general", "General"],
    ["history", "History & data"],
    ["advanced", "Advanced"],
    ["unknown", "Dictation"],
  ]) {
    await page.goto(`/#/settings?section=${section}&from=review`);
    await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const before = await page.evaluate(() => history.length);
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await expect(page).toHaveURL(/section=profiles&from=review/);
    expect(await page.evaluate(() => history.length)).toBe(before);
  }
  await page.goto("/#/settings?from=review");
  await expect(page.getByRole("tab", { name: "Dictation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("settings clarity keeps pending and failed drafts protected across profile navigation", async ({
  page,
}) => {
  await settingsClarityScenario(page);
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    const save = app.SaveSettings;
    app.SaveSettings = async (settings: Settings) => {
      await new Promise<void>((resolve) => Reflect.set(window, "releaseSettingsSave", resolve));
      return save(settings);
    };
    window.dictationTest.failSave = true;
  });
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+J");
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await expect(page.getByRole("button", { name: "New profile", exact: true })).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(window, "releaseSettingsSave")))
    .toBe("function");
  await expect(page.getByRole("button", { name: "Edit Default", exact: true })).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, "releaseSettingsSave")());
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New profile", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+J");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+F12");
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await expect(page.getByRole("button", { name: "New profile", exact: true })).toBeEnabled();
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(page.getByRole("button", { name: "Edit Default", exact: true })).toBeDisabled();
});

async function focusedSettingFits(control: ReturnType<Page["locator"]>) {
  await control.focus();
  await expect(control).toBeFocused();
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      x: rect.x,
      right: rect.right,
      y: rect.y,
      bottom: rect.bottom,
      width: innerWidth,
      height: innerHeight,
      uncovered: !!hit && (hit === element || element.contains(hit)),
    };
  });
  expect(geometry.x).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.y).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
  expect(geometry.uncovered).toBe(true);
}

for (const theme of ["light", "dark"]) {
  for (const collapsed of [false, true]) {
    for (const font of [100, 200]) {
      test(`settings clarity layout ${theme} ${collapsed ? "collapsed" : "expanded"} ${font}% text`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ reducedMotion: font === 200 ? "reduce" : "no-preference" });
        await settingsClarityScenario(page, "dictation", theme, collapsed);
        await page.evaluate((font) => {
          document.documentElement.style.fontSize = `${font}%`;
        }, font);
        await expectRailFits(page, font);
        const tabs = page.getByRole("tablist", { name: "Settings sections" });
        for (const width of [1280, 760]) {
          await page.setViewportSize({ width, height: width === 760 ? 560 : 900 });
          for (const name of ["Dictation", "Profiles", "General", "History & data", "Advanced"]) {
            const tab = tabs.getByRole("tab", { name, exact: true });
            if (await tab.isVisible()) {
              await focusedSettingFits(tab);
              await tab.press("Enter");
              await expect(tab).toHaveAttribute("aria-selected", "true");
            } else {
              const category = page.getByRole("combobox", {
                name: "Settings sections",
                exact: true,
              });
              await focusedSettingFits(category);
              await category.press("Enter");
              await page.getByRole("option", { name, exact: true }).click();
              await expect(category).toContainText(name);
            }
            const overflow = await page.evaluate(() =>
              Array.from(document.querySelectorAll("main *"))
                .filter((element) => {
                  const rect = element.getBoundingClientRect();
                  return rect.width > 0 && rect.right > innerWidth + 1;
                })
                .map((element) => ({
                  tag: element.tagName,
                  role: element.getAttribute("role"),
                  text: element.textContent?.slice(0, 60),
                  right: element.getBoundingClientRect().right,
                }))
                .slice(-12),
            );
            await expect
              .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
                message: JSON.stringify({ name, overflow }),
              })
              .toBe(width);
            const controls =
              name === "Dictation"
                ? [
                    page.getByRole("combobox", { name: "Microphone", exact: true }),
                    page.getByRole("combobox", { name: "Spoken language", exact: true }),
                    page.getByLabel("Global shortcut", { exact: true }),
                    page.getByRole("button", { name: "Record shortcut", exact: true }),
                    page.getByLabel("Cycle profiles shortcut", { exact: true }),
                    page.getByRole("button", { name: "Record profile shortcut", exact: true }),
                  ]
                : name === "Profiles"
                  ? [
                      page.getByRole("button", { name: "New profile", exact: true }),
                      page.getByRole("button", { name: "Edit Default", exact: true }),
                      page.getByRole("button", { name: "Make Work notes active", exact: true }),
                      page.getByRole("combobox", { name: "Add app to Default", exact: true }),
                    ]
                  : name === "General"
                    ? [
                        page.getByRole("button", { name: "Light", exact: true }),
                        page.getByRole("switch", { name: "Launch at login", exact: true }),
                      ]
                    : name === "History & data"
                      ? [page.getByRole("combobox", { name: "History retention", exact: true })]
                      : [
                          page.getByRole("button", {
                            name: "Browse Whisper executable",
                            exact: true,
                          }),
                          page.getByRole("button", { name: "Run setup", exact: true }),
                        ];
            if (name === "Advanced") await showCustomModelFiles(page);
            for (const control of controls) await focusedSettingFits(control);
            const category = page.getByRole("combobox", { name: "Settings sections", exact: true });
            if (await category.isVisible()) await category.focus();
            else await page.getByRole("heading", { name: "Settings", exact: true }).click();
            await page.screenshot({
              path: testInfo.outputPath(
                `${name.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${width}.png`,
              ),
              fullPage: true,
              animations: "disabled",
            });
          }
        }
      });
    }
  }
}

test("settings clarity retry and discard stay reachable at narrow enlarged text", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settingsClarityScenario(page, "dictation", "light", false);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    window.dictationTest.failSave = true;
  });
  const shortcut = page.getByLabel("Global shortcut", { exact: true });
  await shortcut.fill("Ctrl+Alt+J");
  await shortcut.press("Tab");
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await focusedSettingFits(retry);
  await page.screenshot({ path: testInfo.outputPath("save-recovery-760-200.png"), fullPage: true });
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await retry.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+J");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await shortcut.fill("Ctrl+Alt+L");
  await shortcut.press("Tab");
  const discard = page.getByRole("button", { name: "Discard changes", exact: true });
  await expect(discard).toBeVisible();
  await focusedSettingFits(discard);
  await discard.press("Space");
  await expect(shortcut).toHaveValue("Ctrl+Alt+J");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
});

for (const [lang, width, height] of [
  ["en", 480, 600],
  ["de", 480, 760],
  ["en", 760, 560],
  ["de", 760, 560],
] as const) {
  test(`settings recovery preserves working space, field context and exact cause ${lang} ${width}x${height}`, async ({
    page,
  }) => {
    const copy = lang === "de" ? de : en;
    const raw =
      "Synthetic storage cause: " +
      "The settings file could not be written. Your draft remains available for retry. ".repeat(15);
    await page.addInitScript(
      (language) => localStorage.setItem("desktop-language", language),
      lang,
    );
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/settings?section=dictation");
    await page.evaluate((raw) => {
      document.documentElement.style.fontSize = "200%";
      Reflect.get(window, "mockBackend").main.App.SaveSettings = async () => {
        throw Error(raw);
      };
    }, raw);
    const settings = page.getByRole("dialog", { name: copy["common.settings"], exact: true });
    const shortcut = settings.locator("#shortcut");
    await shortcut.fill("Ctrl+Alt+J");
    await shortcut.press("Tab");
    const notice = page.locator('[data-slot="settings-save-notice-host"] [data-slot="toast"]');
    await expect(notice).toBeVisible();
    const pane = settings.locator('[data-slot="settings-scroll-pane"]');
    const recovery = settings.locator('[data-slot="settings-save-state"]');
    await expect(recovery.locator('[data-slot="settings-save-notice-host"]')).toContainText(
      copy["uiPolish.errorDetails"],
    );
    const recoveryBox = await recovery.boundingBox();
    const searchBox = await settings
      .getByRole("textbox", { name: copy["uiPolish.searchSettings"], exact: true })
      .boundingBox();
    const noticeBox = await notice.boundingBox();
    const paneBox = await pane.boundingBox();
    expect(recoveryBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height);
    expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(paneBox!.y + 1);
    const readFull = notice.getByRole("button", {
      name: copy["uiPolish.errorDetails"],
      exact: true,
    });
    const panePosition = await pane.evaluate((node) => node.scrollTop);
    await readFull.click();
    const reader = page.getByRole("dialog", { name: copy["uiPolish.errorDetails"], exact: true });
    const fullCause = reader.getByRole("region", {
      name: copy["uiPolish.fullErrorDetails"],
      exact: true,
    });
    await expect(fullCause).toHaveText(raw);
    expect(await fullCause.evaluate((node) => node.clientHeight)).toBeGreaterThan(140);
    await fullCause.focus();
    await fullCause.press("End");
    await expect
      .poll(() =>
        fullCause.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(readFull).toBeFocused();
    expect(await pane.evaluate((node) => node.scrollTop)).toBe(panePosition);
    await expect(shortcut).toHaveValue("Ctrl+Alt+J");
    await readFull.click();
    await reader.getByRole("button", { name: copy["common.back"], exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(readFull).toBeFocused();
    expect(await pane.evaluate((node) => node.clientHeight)).toBeGreaterThanOrEqual(200);
    await focusedSettingFits(shortcut);
    const geometry = await shortcut.evaluate((node) => {
      const pane = node.closest('[data-slot="settings-scroll-pane"]')!.getBoundingClientRect();
      const label = document.querySelector('label[for="shortcut"]')!.getBoundingClientRect();
      const field = node.getBoundingClientRect();
      return {
        paneTop: pane.top,
        paneBottom: pane.bottom,
        labelTop: label.top,
        fieldBottom: field.bottom,
      };
    });
    expect(geometry.labelTop).toBeGreaterThanOrEqual(geometry.paneTop);
    expect(geometry.fieldBottom).toBeLessThanOrEqual(geometry.paneBottom);
    await focusedSettingFits(
      settings.getByRole("button", { name: copy["common.retry"], exact: true }),
    );
    await focusedSettingFits(
      settings.getByRole("button", { name: copy["autoSaveStatus.discardChanges"], exact: true }),
    );
    await expect(shortcut).toHaveValue("Ctrl+Alt+J");
    expect(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await settings.getByRole("button", { name: copy["common.close"], exact: true }).click();
    await expect(settings).toHaveCount(0);
    const afterClose = page.locator('[data-slot="app-save-notice-host"] [data-slot="toast"]');
    await expect(afterClose).toBeVisible();
    await expect(afterClose.getByText(raw, { exact: true })).toHaveText(raw);
    await expect(page.getByLabel(copy["toast.notifications"], { exact: true })).toHaveCount(1);
    await page.getByRole("link", { name: copy["common.settings"], exact: true }).click();
    await expect(settings).toBeVisible();
    const dismiss = notice.getByRole("button", {
      name: copy["toast.dismissNotification"],
      exact: true,
    });
    await expect(dismiss).toHaveText(copy["uiPolish.dismissNotice"]);
    const positionBeforeDismiss = await pane.evaluate((node) => node.scrollTop);
    await dismiss.click();
    await expect(notice).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(shortcut).toHaveValue("Ctrl+Alt+J");
    await expect(
      settings.getByRole("button", { name: copy["common.retry"], exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: copy["autoSaveStatus.discardChanges"], exact: true }),
    ).toBeVisible();
    expect(await pane.evaluate((node) => node.scrollTop)).toBe(positionBeforeDismiss);
  });
}

test("settings clarity interaction preview", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await settingsClarityScenario(page);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: testInfo.outputPath("dictation-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.waitForTimeout(700);
  await page.getByRole("switch", { name: /^Light cleanup/ }).check();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText))
    .toBe(true);
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: testInfo.outputPath("profiles-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Edit Work notes", exact: true }).click();
  await expect(profileEditor(page)).toBeVisible();
  await page.waitForTimeout(700);
  await profileEditor(page).getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await expect(page.getByRole("switch", { name: /^Light cleanup/ })).toBeChecked();
  await page.waitForTimeout(600);
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await page.waitForTimeout(200);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: testInfo.outputPath("dictation-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.waitForTimeout(700);
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: testInfo.outputPath("profiles-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.waitForTimeout(700);
});

for (const theme of ["dark", "light"]) {
  for (const collapsed of [true, false]) {
    for (const font of [100, 200]) {
      test(`prompts page tabs ${theme} ${collapsed ? "collapsed" : "expanded"} ${font}% text`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width: 760, height: 560 });
        await page.emulateMedia({ reducedMotion: font === 200 ? "reduce" : "no-preference" });
        await page.addInitScript(
          ({ theme, collapsed }) => {
            localStorage.setItem("desktop-theme", theme);
            localStorage.setItem("yap-sidebar-collapsed", String(collapsed));
            const config = window.dictationTest.snapshot.textProcessing;
            config.enabled = true;
            config.model = "local-model";
            config.prompts[0].instruction =
              "Correct punctuation and capitalization while preserving the original meaning, names and language. Return only the cleaned text.";
          },
          { theme, collapsed },
        );
        await page.goto("/#/prompts?section=prompts&from=review");
        await page.evaluate((font) => {
          document.documentElement.style.fontSize = `${font}%`;
        }, font);
        await expectRailFits(page, font);
        const tabs = page.getByRole("tablist", { name: "Prompts sections" });
        const length = await page.evaluate(() => history.length);
        for (const [name, section] of [
          ["Prompts", "prompts"],
          ["Chains", "chains"],
          ["Text model", "models"],
        ]) {
          const tab = tabs.getByRole("tab", { name, exact: true });
          await focusedSettingFits(tab);
          await tab.press("Enter");
          await expect(tab).toHaveAttribute("aria-selected", "true");
          await expect(page).toHaveURL(new RegExp(`section=${section}&from=review`));
          expect(await page.evaluate(() => history.length)).toBe(length);
        }
        await tabs.getByRole("tab", { name: "Prompts", exact: true }).click();
        await page.getByRole("heading", { name: "Prompts & chains", exact: true }).click();
        await page.waitForTimeout(200);
        await page.screenshot({
          path: testInfo.outputPath("prompts-tabs.png"),
          fullPage: true,
          animations: "disabled",
        });
        if (font === 100 && collapsed) {
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.screenshot({
            path: testInfo.outputPath("prompts-desktop.png"),
            animations: "disabled",
          });
        }
      });
    }
  }
}

async function homeModelScenario(page: Page, custom = false) {
  await page.addInitScript((custom) => {
    const state = window.dictationTest;
    state.snapshot.models = ["tiny", "base", "small"].map((id) => ({
      id,
      name: `Whisper ${id[0].toUpperCase()}${id.slice(1)}`,
      description: "Speech model",
      size: 100,
      diskBytes: id === "small" ? 0 : 100,
      removable: id !== "small",
      installed: id !== "small",
      path: `/${id}`,
    }));
    state.snapshot.settings.modelPath = custom ? "/models/custom-speech.bin" : "/tiny";
  }, custom);
  await page.goto("/");
  await openRecordingOptions(page);
}

async function saveDraft(page: Page) {
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  if (await retry.isVisible()) await retry.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Changes save automatically|Changes not saved|Not saved yet:/ })
      .first(),
  ).toBeVisible();
}

async function promptAction(page: Page, name: "Delete prompt" | "Reset instructions") {
  await page.getByRole("button", { name: "More prompt actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("motion setup buttons remain visible through held pointer presses and advance on release", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.settings.setupComplete = false;
    window.dictationTest.snapshot.microphoneTested = false;
  });
  await page.goto("/");
  const next = page.getByRole("button", { name: "Next", exact: true });
  for (let i = 0; i < 5; i++) {
    await next.hover();
    await page.mouse.down();
    await expect(next).toHaveCSS("transform", "matrix(0.98, 0, 0, 0.98, 0, 0)");
    await expect(next).toHaveCSS("opacity", "1");
    await expect(next).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole("heading", { name: "Let’s hear you" })).toBeVisible();
    await expect(next).toBeVisible();
    await expect(next).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Choose your speech model" })).toBeVisible();
  }
  await next.click();
  await expect(page.getByRole("heading", { name: "Let’s hear you" })).toBeVisible();
  await expect(next).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
});

test("motion press feedback resets on pointer exit, responds to reduced motion, and preserves keyboard activation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await homeModelScenario(page);
  const button = page.getByRole("button", { name: "Import audio", exact: true });
  await button.hover();
  await page.mouse.down();
  await expect
    .poll(() => button.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe("none");
  // Changing the OS preference while a press is active must remove spatial motion immediately.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(button).toHaveCSS("transform", "none");
  await expect(button).toHaveCSS("opacity", "0.88");
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(button).toHaveCSS("opacity", "1");
  expect(await page.evaluate(() => window.dictationTest.audioImports)).toBe(0);
  await button.focus();
  await page.keyboard.down("Space");
  await expect(button).toHaveCSS("transform", "none");
  await expect(button).toHaveCSS("opacity", "1");
  await page.keyboard.up("Space");
  await expect.poll(() => page.evaluate(() => window.dictationTest.audioImports)).toBe(1);
  // Imports can queue while transcription is running.
  await expect(button).toBeEnabled();
  await expect(button).toHaveCSS("opacity", "1");
});

for (const reduced of [false, true]) {
  test(`motion setup keeps keyboard navigation instant and celebrates the microphone only once${reduced ? " with reduced motion" : ""}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.addInitScript(() => {
      window.dictationTest.snapshot.settings.setupComplete = false;
      window.dictationTest.snapshot.microphoneTested = false;
    });
    await page.goto("/");
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeEnabled();
    const transforms = await next.evaluate(async (button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const surface = document.querySelector('[aria-label="Microphone setup"]')!.parentElement!;
      return surface.getAnimations().flatMap((animation) =>
        animation.effect instanceof KeyframeEffect
          ? animation.effect
              .getKeyframes()
              .map((frame) => frame.transform)
              .filter(Boolean)
          : [],
      );
    });
    if (reduced) expect(transforms).toEqual([]);
    else expect(transforms).toContain("translateX(24px)");
    await expect(page.getByRole("heading", { name: "Let’s hear you" })).toBeFocused();
    const meter = page.getByRole("meter", { name: "Microphone level", exact: true });
    await expect(meter).toHaveCount(0);
    await page.getByRole("button", { name: "Test microphone", exact: true }).click();
    await expect(meter).toHaveCount(1);
    await page.getByRole("button", { name: "Stop test", exact: true }).click();
    await expect(meter).toHaveCount(0);
    await expect(page.getByText("Inactive", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Last microphone test passed", { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="setup-mic-success"]')).toHaveCSS(
      "transform",
      reduced ? "none" : "matrix(1, 0, 0, 1, 0, 0)",
    );
    const halo = page.locator('[data-slot="setup-success-halo"]');
    await expect(halo).toHaveCount(reduced ? 0 : 1);
    await page.getByRole("button", { name: "Test again", exact: true }).click();
    await page.getByRole("button", { name: "Stop test", exact: true }).click();
    await expect(page.getByText("Last microphone test passed", { exact: true })).toBeVisible();
    await expect(halo).toHaveCount(0);
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "One shortcut. Ready when you are." }),
    ).toBeFocused();
    await expect(page.getByRole("region", { name: "Microphone setup" })).toHaveCount(0);
    const shortcut = page.getByRole("region", { name: "Shortcut setup" });
    await expect(shortcut.locator("..")).toHaveCSS("transform", "none");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByText("Last microphone test passed", { exact: true })).toBeVisible();
    await expect(halo).toHaveCount(0);
  });
}

for (const reduced of [false, true]) {
  test(`motion toasts and interrupted file-drop feedback remain usable${reduced ? " with reduced motion" : ""}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await homeModelScenario(page);
    await page.evaluate(async () => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["audio"], "meeting.wav"));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    const overlay = page.getByRole("status").filter({ hasText: "Drop audio files to import" });
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(":scope > div")).toHaveCSS(
      "transform",
      reduced ? "none" : "matrix(1, 0, 0, 1, 0, 0)",
    );
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("blur"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const transfer = new DataTransfer();
      transfer.items.add(new File(["audio"], "meeting.wav"));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
    });
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveCSS("opacity", "1");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      const state = window.dictationTest;
      state.status("transcribing");
      state.snapshot.status.phase = "done";
      state.snapshot.status.message = "Copied to clipboard";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    });
    await expect(overlay).toHaveCount(0);
    const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Transcription finished" });
    await expect(toast).toHaveCSS("transform", reduced ? "none" : "matrix(1, 0, 0, 1, 0, 0)");
    await toast.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(toast).toHaveCount(0);
  });
}

test("transcription completion uses one toast across navigation", async ({ page }, testInfo) => {
  await homeModelScenario(page);
  await page.evaluate(() => window.dictationTest.status("transcribing"));
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status = {
      ...state.snapshot.status,
      phase: "done",
      message: "Copied to clipboard",
      transcript: "Finished transcription.",
      startedAt: 0,
    };
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Transcription finished" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Copied to clipboard");
  await navigateMain(page, "Dictate");
  await expect(page.getByRole("region", { name: "Dictation recorder" })).toBeVisible();
  await expect(page.locator("#main-content").getByText("Finished transcription.")).toHaveCount(0);
  await expect(page.locator("#main-content").getByText("Copied to clipboard")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("transcription-finished-toast.png") });
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.history();
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await settle(page);
  await navigateMain(page, "History");
  await navigateMain(page, "Dictate");
  await page.evaluate(() => {
    const state = window.dictationTest;
    const finished = structuredClone(state.snapshot.status);
    state.status("text-processing");
    state.snapshot.status = finished;
    state.callbacks["dictation:status"](finished);
  });
  await settle(page);
  await expect(toast).toHaveCount(0);
  // A new transcription with failed delivery needs explicit recovery.
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.snapshot.status.phase = "done";
    state.snapshot.status.message = "Saved to history; clipboard failed: unavailable";
    state.snapshot.status.completionWarning = true;
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  const warning = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Transcript ready — action needed" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Review the latest result on Home");
  await expect(warning.locator(".lucide-circle-alert")).toBeVisible();
  await expect(warning.getByRole("button", { name: "Copy transcript" })).toHaveCount(0);
});

test("transcription failures use an error toast and cancellations do not report completion", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.status.phase = "done";
    window.dictationTest.snapshot.status.message = "Copied to clipboard";
    window.dictationTest.snapshot.status.transcript = "Old transcription.";
  });
  await homeModelScenario(page);
  await expect(page.getByRole("region", { name: "Dictation recorder" })).toBeVisible();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await expect(page.locator("#main-content").getByText("Old transcription.")).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.status("idle");
  });
  await settle(page);
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.snapshot.status.phase = "error";
    state.snapshot.status.message = "Transcription failed. Check the speech model.";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Transcription failed." });
  await expect(toast).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("Transcription failed. Check the speech model."),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Transcription finished" }),
  ).toHaveCount(0);
  await page.keyboard.press("F6");
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await page.evaluate(() =>
    window.dictationTest.callbacks["dictation:status"](
      structuredClone(window.dictationTest.snapshot.status),
    ),
  );
  await settle(page);
  await expect(toast).toHaveCount(0);
});

for (const theme of ["dark", "light"] as const) {
  test(`dictation recorder ${theme} fits narrow windows and reflects recording activity`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript((theme) => {
      localStorage.setItem("desktop-theme", theme);
      localStorage.setItem("yap-sidebar-collapsed", "true");
    }, theme);
    await page.setViewportSize({ width: 1347, height: 800 });
    await homeModelScenario(page);
    const recorder = page.getByRole("region", { name: "Dictation recorder" });
    await openRecordingOptions(page);
    const options = page.getByRole("region", { name: "Recording options", exact: true });
    const selector = options.getByRole("combobox", { name: "Speech model", exact: true });
    await expect(page.getByRole("heading", { name: "Ready to record" })).toBeVisible();
    await expect(selector).toContainText("Whisper Tiny");
    await page.screenshot({ path: testInfo.outputPath("dictation-ready-desktop.png") });
    await page.evaluate(() => {
      Reflect.get(window, "mockBackend").main.App.StopRecording = async () => {
        window.dictationTest.status("transcribing");
      };
    });
    for (const width of [1347, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(recorder.getByRole("button", { name: "Start recording" })).toBeEnabled();
      await openRecordingOptions(page);
      await expect(selector).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (width === 360) {
        await page.screenshot({ path: testInfo.outputPath("dictation-ready-narrow.png") });
      }
      await page.keyboard.press("Escape");
      await recorder.getByRole("button", { name: "Start recording" }).click();
      await expect(page.getByRole("heading", { name: "Recording", exact: true })).toBeVisible();
      await openRecordingOptions(page);
      await expect(selector).toBeDisabled();
      await page.keyboard.press("Escape");
      const bars = recorder.locator('[data-slot="recording-level-meter"] > span');
      expect(await bars.count()).toBeGreaterThan(1);
      const quietHeight = await bars.nth(0).evaluate((bar) => bar.getBoundingClientRect().height);
      await page.evaluate(() => window.dictationTest.callbacks["dictation:level"](0.8));
      await expect
        .poll(() => bars.nth(0).evaluate((bar) => bar.getBoundingClientRect().height))
        .toBeGreaterThan(quietHeight);
      const meterBounds = await bars.nth(0).evaluate((bar) => {
        const meter = bar.parentElement!.getBoundingClientRect();
        const content = bar.parentElement!.parentElement!.parentElement!.getBoundingClientRect();
        return {
          left: meter.left,
          right: meter.right,
          contentLeft: content.left,
          contentRight: content.right,
        };
      });
      expect(meterBounds.left).toBeGreaterThanOrEqual(meterBounds.contentLeft);
      expect(meterBounds.right).toBeLessThanOrEqual(meterBounds.contentRight);
      await page.screenshot({
        path: testInfo.outputPath(`dictation-recording-${width}.png`),
        animations: "disabled",
      });
      await recorder.getByRole("button", { name: "Stop recording" }).click();
      await expect(page.getByRole("heading", { name: "Transcribing…" })).toBeVisible();
      await expect(
        recorder.getByRole("button", { name: "Transcribing…", exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => {
        window.dictationTest.status("idle");
        window.dictationTest.callbacks["dictation:level"](0);
      });
    }
    await simulateModelDownload(page);
    await openRecordingOptions(page);
    await selector.click();
    await page.getByRole("option", { name: /Whisper Small/ }).click();
    await page.evaluate(() => {
      const state = window.dictationTest;
      state.snapshot.status.progress = 0.42;
      state.snapshot.status.message = "Downloading Whisper Small…";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    });
    await expect(recorder.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    await expect(recorder.getByRole("button", { name: "Cancel download" })).toBeInViewport();
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("dictation-download-narrow.png") });
    await recorder.getByRole("button", { name: "Cancel download" }).click();
    await openRecordingOptions(page);
    await expect(selector).toBeEnabled();
  });
}

test("home speech model selector shows the active model and saves installed selections", async ({
  page,
}, testInfo) => {
  await homeModelScenario(page);
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Speech model", exact: true });
  await expect(selector).toContainText("Whisper Tiny");
  const settings = await page.evaluate(() =>
    structuredClone(window.dictationTest.snapshot.settings),
  );
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    const save = app.SaveSettings;
    app.SaveSettings = async (settings: Settings) => {
      await new Promise<void>((resolve) => Reflect.set(window, "finishModelSwitch", resolve));
      return save(settings);
    };
  });
  await selector.click();
  await expect(page.getByRole("option", { name: "Whisper Tiny", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page
      .getByRole("option", { name: /Whisper Small/ })
      .getByRole("img", { name: "Download required" }),
  ).toBeVisible();
  await page.getByRole("option", { name: "Whisper Base", exact: true }).click();
  await expect(selector).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, "finishModelSwitch")());
  await expect(selector).toBeEnabled();
  await expect(selector).toContainText("Whisper Base");
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings)).toEqual({
    ...settings,
    modelPath: "/base",
  });
  await page.screenshot({
    path: testInfo.outputPath("home-model-selector.png"),
    animations: "disabled",
  });
  await navigateMain(page, "Models");
  await expectActiveModel(page.getByRole("region", { name: "Whisper Base", exact: true }));
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await expect(selector).toContainText("Whisper Base");
});

test("home speech model selector retains custom and failed selections and blocks active work", async ({
  page,
}) => {
  await homeModelScenario(page, true);
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Speech model", exact: true });
  await expect(selector).toContainText("custom-speech.bin");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await selector.click();
  await page.getByRole("option", { name: "Whisper Base", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Settings save failed" })).toBeVisible();
  await expect(selector).toBeEnabled();
  await expect(selector).toContainText("custom-speech.bin");
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.modelPath)).toBe(
    "/models/custom-speech.bin",
  );
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await selector.click();
  await page.getByRole("option", { name: "Whisper Base", exact: true }).click();
  await expect(selector).toContainText("Whisper Base");
  for (const phase of ["recording", "transcribing", "downloading"]) {
    await page.evaluate((phase) => window.dictationTest.status(phase), phase);
    await expect(selector).toBeDisabled();
  }
  await page.evaluate(() => window.dictationTest.status("idle"));
  await expect(selector).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.snapshot.ready = false;
    window.dictationTest.history();
  });
  await expect(selector).toBeEnabled();
  const choose = page.getByRole("button", { name: "Choose speech model", exact: true });
  await expect(choose).toBeEnabled();
  await choose.click();
  await expect(page).toHaveURL(/#\/models$/);
});

async function simulateModelDownload(page: Page) {
  await page.evaluate(() => {
    Reflect.get(window, "mockBackend").main.App.InstallModel = async (id: string) => {
      const state = window.dictationTest;
      if (state.failSave) throw new Error("Download could not start");
      state.installedModelIDs.push(id);
      state.status("downloading");
    };
  });
}

test("home model downloads notify only on completion even after navigation", async ({
  page,
}, testInfo) => {
  await homeModelScenario(page);
  await simulateModelDownload(page);
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Speech model", exact: true });
  await selector.click();
  const small = page.getByRole("option", { name: /Whisper Small/ });
  await expect(small.getByRole("img", { name: "Download required" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("home-download-options.png"),
    animations: "disabled",
  });
  await small.click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs))
    .toEqual(["small"]);
  await expect(selector).toBeDisabled();
  await expect(selector).toContainText("Whisper Tiny");
  await expect(page.getByRole("button", { name: "Cancel download", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    const model = state.snapshot.models.find((model) => model.id === "small")!;
    model.installed = true;
    state.snapshot.settings.modelPath = model.path;
    state.snapshot.status.message = "Model installed. Ready to dictate.";
    state.snapshot.status.phase = "idle";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    state.history();
  });
  const success = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Whisper Small downloaded and ready to use." });
  await expect(success).toBeVisible();
  await page.evaluate(() => window.dictationTest.history());
  await expect(success).toHaveCount(1);
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await expect(selector).toContainText("Whisper Small");
  await selector.click();
  await expect(
    page
      .getByRole("option", { name: "Whisper Small", exact: true })
      .getByRole("img", { name: "Download required" }),
  ).toHaveCount(0);
});

test("home model download errors and cancellation preserve the active model and allow retry", async ({
  page,
}) => {
  await homeModelScenario(page);
  await simulateModelDownload(page);
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Speech model", exact: true });
  async function download() {
    await selector.click();
    await page.getByRole("option", { name: /Whisper Small/ }).click();
  }
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await download();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Download could not start" }),
  ).toBeVisible();
  await expect(selector).toBeEnabled();
  await expect(selector).toContainText("Whisper Tiny");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await download();
  await expect(selector).toBeDisabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.phase = "error";
    state.snapshot.status.message = "Download failed";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Download failed" }),
  ).toBeVisible();
  await expect(selector).toBeEnabled();
  await download();
  await expect(selector).toBeDisabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.phase = "idle";
    state.snapshot.status.message = "Download cancelled";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(selector).toBeEnabled();
  await expect(selector).toContainText("Whisper Tiny");
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await download();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs.length))
    .toBe(3);
  await expect(selector).toBeDisabled();
});

async function shortcutPermissionScenario(page: Page, setup = false) {
  await page.addInitScript((setup) => {
    const state = window.dictationTest;
    state.snapshot.status.shortcutError =
      "Yap needs Accessibility access for global shortcuts and automatic paste. Enable Yap in System Settings, then retry.";
    state.snapshot.settings.setupComplete = !setup;
    state.snapshot.microphoneTested = true;
    const permission = { granted: false, attempts: 0 };
    Reflect.set(window, "shortcutPermissionTest", permission);
    Reflect.set(Reflect.get(window, "mockBackend").main.App, "RetryShortcut", async () => {
      permission.attempts++;
      if (permission.granted) state.snapshot.status.shortcutError = "";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    });
  }, setup);
}

for (const recovery of ["button", "focus"] as const) {
  test(`shortcut permission recovery via ${recovery} keeps settings edits`, async ({ page }) => {
    await shortcutPermissionScenario(page);
    await page.goto("/#/settings");
    const retry = page.getByRole("button", {
      name: "Retry shortcut",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+J");
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(page.getByRole("alert").filter({ hasText: "Accessibility access" })).toBeVisible();
    await page.evaluate(() => {
      Reflect.get(window, "shortcutPermissionTest").granted = true;
    });
    if (recovery === "button") await retry.click();
    else await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(retry).toBeHidden();
    await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+J");
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
      .toBe("Ctrl+Alt+J");
    expect(await page.evaluate(() => window.dictationTest.snapshot.status.phase)).toBe("idle");
    // A late notice must inherit the modal background isolation and recover on close.
    await page.evaluate(() => {
      const state = window.dictationTest;
      state.snapshot.status.indicatorError = "Delayed indicator failure";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    });
    await expect(page.getByRole("region", { name: "App status", includeHidden: true })).toHaveCount(
      1,
    );
    await expect(page.getByRole("region", { name: "App status" })).toHaveCount(0);
    await navigateMain(page, "Dictate");
    const notices = page.getByRole("region", { name: "App status" });
    await expect(notices).toBeVisible();
    await notices.locator("summary").click();
    await expect(notices.getByText("Delayed indicator failure", { exact: true })).toBeVisible();
  });
}

test("setup retries shortcut permission and still requires a real shortcut test", async ({
  page,
}) => {
  await shortcutPermissionScenario(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const retry = page.getByRole("button", {
    name: "Retry shortcut",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(retry).toBeDisabled();
  const attempts = await page.evaluate(
    () => Reflect.get(window, "shortcutPermissionTest").attempts,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => Reflect.get(window, "shortcutPermissionTest").attempts)).toBe(
    attempts,
  );
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    Reflect.get(window, "shortcutPermissionTest").granted = true;
  });
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.snapshot.shortcutTested = true;
    window.dictationTest.callbacks["setup:changed"]();
  });
  await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeEnabled();
});

test("settings dialog keeps vertical categories beside content and preserves edits", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
  });
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("/#/settings");
  const tabs = page.getByRole("tablist", { name: "Settings sections" });
  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveCount(1);
  const navBounds = await tabs.boundingBox();
  const contentBounds = await panel.boundingBox();
  expect(contentBounds!.x).toBeGreaterThan(navBounds!.x + navBounds!.width);
  expect(contentBounds!.width).toBeGreaterThan(600);
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeHidden();
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+J");
  await page.screenshot({
    path: testInfo.outputPath("settings-dictation.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.getByRole("switch", { name: "Launch at login", exact: true }).check();
  await page.screenshot({
    path: testInfo.outputPath("settings-general.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  await page.getByRole("switch", { name: /^Keep recordings/ }).check();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        shortcut: window.dictationTest.snapshot.settings.shortcut,
        login: window.dictationTest.snapshot.settings.launchAtLogin,
        audio: window.dictationTest.snapshot.settings.saveAudio,
      })),
    )
    .toEqual({ shortcut: "Ctrl+Alt+J", login: true, audio: true });
  await page.screenshot({
    path: testInfo.outputPath("settings-history.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await showCustomModelFiles(page);
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("settings-advanced.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+J");
  await page.setViewportSize({ width: 760, height: 680 });
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("settings-narrow.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Dictation", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Profiles", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("settings save automatically, keep failed drafts, and offer retry or discard", async ({
  page,
}, testInfo) => {
  await page.goto("/#/settings");
  const shortcut = page.getByLabel("Global shortcut", { exact: true });
  const status = page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("status");
  const failed = page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" });
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toHaveCount(0);
  await expect(status).toHaveText("Saved");
  await shortcut.fill("Ctrl+Alt+J");
  await expect(status).toHaveText("Saves when you leave the field");
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    "Ctrl+Alt+Space",
  );
  await shortcut.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+J");
  await expect(status).toHaveText("Saved");
  await page.screenshot({
    path: testInfo.outputPath("settings-autosaved.png"),
    animations: "disabled",
  });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await shortcut.fill("Ctrl+Alt+K");
  await shortcut.press("Enter");
  await expect(failed).toBeVisible();
  await expect(
    page.locator('[data-slot="settings-save-notice-host"] [data-slot="toast"]'),
  ).toContainText("Settings not saved");
  const settingsPane = await page.locator('[data-slot="settings-scroll-pane"]').boundingBox();
  const noticeBox = await failed.boundingBox();
  expect(noticeBox!.y + noticeBox!.height).toBeLessThanOrEqual(settingsPane!.y + 1);
  await expect(failed.getByText("Settings not saved", { exact: true })).toBeVisible();
  await failed.getByRole("button", { name: "Error details", exact: true }).click();
  const errorReader = page.getByRole("dialog", { name: "Error details", exact: true });
  const failureCause = errorReader.getByRole("region", { name: "Full error details", exact: true });
  await expect(failureCause).toHaveText("Settings save failed");
  await failureCause.focus();
  await expect(failureCause).toBeFocused();
  await errorReader.getByRole("button", { name: "Back", exact: true }).click();
  await expect(status).toHaveText("Changes not saved");
  await expect(shortcut).toHaveValue("Ctrl+Alt+K");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
  await expect(
    page
      .getByRole("dialog", { name: "Settings", exact: true })
      .locator('[data-slot="settings-save-state"]'),
  ).toBeInViewport();
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    "Ctrl+Alt+J",
  );
  await page.keyboard.press("F6");
  await failed.getByRole("button", { name: "Dismiss notification" }).click();
  await page.waitForTimeout(600);
  await expect(failed).toHaveCount(0);
  // Dismissing an owned save notice must not orphan the shared viewport used
  // by later notifications and their F6/Tab keyboard route.
  await page.evaluate(async () => {
    const modulePath = "/src/components/ui/toast.tsx";
    const { toastManager } = await import(modulePath);
    toastManager.add({
      id: "notification-after-settings",
      type: "error",
      title: "Independent notification after save-error dismissal",
      timeout: 8000,
    });
  });
  const followingNotice = page.locator('[data-slot="toast"]').filter({
    hasText: "Independent notification after save-error dismissal",
  });
  await expect(followingNotice).toBeVisible();
  await page.keyboard.press("F6");
  await expect(page.getByRole("region", { name: "Notifications", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(followingNotice).toBeFocused();
  await followingNotice.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await expect(followingNotice).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+K");
  await expect(status).toHaveText("Saved");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await shortcut.fill("Ctrl+Alt+L");
  await shortcut.press("Enter");
  await expect(status).toHaveText("Changes not saved");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(shortcut).toHaveValue("Ctrl+Alt+K");
  await expect(status).toHaveText("Saved");
});

for (const theme of ["light", "dark"] as const) {
  test(`prompt library transfers the automatic selection and keeps drafts across layouts in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("desktop-theme", theme);
      localStorage.setItem("yap-sidebar-collapsed", "true");
      const settings = window.dictationTest.snapshot.textProcessing;
      settings.enabled = true;
      settings.model = "saved-model";
      settings.autoPromptId = "summary";
      settings.prompts[0].instruction =
        "Correct all punctuation, capitalization, and grammatical errors within the provided transcript. Eliminate filler words (e.g., um, uh, like) and remove accidental repetitions while maintaining natural flow. Preserve the original meaning, all proper nouns and names, specialized technical terminology, and the source language. The output must consist solely of the cleaned and revised text.";
      settings.prompts.push(
        {
          id: "translate",
          name: "Translate to German",
          instruction:
            "Translate the provided transcript to German. Preserve the meaning and names.",
        },
        {
          id: "markdown",
          name: "Format to Markdown",
          instruction:
            "Format the transcript as structured Markdown with clear headings and lists.",
        },
        {
          id: "email",
          name: "Professional email",
          instruction: "Rewrite the transcript as a concise professional email.",
        },
        {
          id: "meeting",
          name: "Meeting notes",
          instruction: "Extract key decisions and action items with their owners.",
        },
        {
          id: "ticket",
          name: "Technical ticket",
          instruction: "Format the transcript as a technical issue with steps to reproduce.",
        },
      );
    }, theme);
    await page.setViewportSize({ width: 1140, height: 720 });
    await page.goto("/#/prompts");
    const library = page.getByRole("navigation", { name: "Saved prompts", exact: true });
    const automatic = page.getByRole("switch", { name: "Run after dictation", exact: true });
    const cleanup = library.getByRole("button", { name: "Cleanup", exact: true });
    const summary = library.getByRole("button", { name: "Summary", exact: true });
    await expect(page.getByRole("tab", { name: "Prompts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("combobox", { name: "Saved prompt", exact: true })).toBeHidden();
    await expect(cleanup).toHaveAttribute("aria-pressed", "true");
    await expect(summary.getByText("Automatic", { exact: true })).toBeVisible();
    await expect(automatic).not.toBeChecked();
    await expect(
      page.getByText("Turn on to replace Summary after dictation.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Automatic processing", exact: true }),
    ).toHaveCount(0);
    const instructionsWidth = await page
      .getByLabel("Instructions", { exact: true })
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(instructionsWidth).toBeGreaterThan(500);
    await automatic.focus();
    await page.keyboard.press("Space");
    await expect(automatic).toBeChecked();
    await expect(cleanup.getByText("Automatic", { exact: true })).toBeVisible();
    await expect(summary.getByText("Automatic", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId),
    ).toBe("summary");
    await page.getByLabel("Instructions", { exact: true }).fill("Preserve all technical names.");
    await summary.click();
    await expect(automatic).not.toBeChecked();
    await automatic.check();
    await expect(library.getByText("Automatic", { exact: true })).toHaveCount(1);
    await automatic.uncheck();
    await expect(library.getByText("Automatic", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(automatic).toBeChecked();
    await cleanup.click();
    await automatic.check();
    await saveDraft(page);
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
      .toBe("cleanup");
    await expect(page.getByRole("button", { name: "Refine prompt", exact: true })).toBeInViewport();
    await expect(page.getByRole("region", { name: "Prompt details", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await page.screenshot({
      path: testInfo.outputPath(`prompt-library-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByLabel("Name", { exact: true }).fill("My cleanup");
    await page.setViewportSize({ width: 760, height: 560 });
    await expect(library).toBeHidden();
    const picker = page.getByRole("combobox", { name: "Saved prompt", exact: true });
    await expect(picker).toContainText("My cleanup");
    await picker.click();
    await page.getByRole("option", { name: "Summary", exact: true }).click();
    await expect(automatic).not.toBeChecked();
    await automatic.check();
    await picker.click();
    await page.getByRole("option", { name: "My cleanup", exact: true }).click();
    await expect(automatic).not.toBeChecked();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My cleanup");
    await page.getByLabel("Instructions", { exact: true }).scrollIntoViewIfNeeded();
    await expect(
      page.locator('header[aria-label="Prompts & chains"]').getByRole("status"),
    ).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`prompt-library-narrow-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("prompt automation help supports keyboard and touch without changing the automatic selection", async ({
  page,
  browser,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
  });
  await page.goto("/#/prompts");
  const automatic = page.getByRole("switch", { name: "Run after dictation", exact: true });
  const info = page.getByRole("button", {
    name: "About running prompts after dictation",
    exact: true,
  });
  const explanation =
    "Turn on to use this prompt after dictation. Profiles and chains can override the default.";
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Cleanup");
  await expect(automatic).toHaveAccessibleDescription(explanation);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(info).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveText(explanation);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await info.press("Enter");
  await expect(page.getByRole("tooltip")).toHaveText(explanation);
  await expect(automatic).not.toBeChecked();
  await page.keyboard.press("Escape");
  await automatic.check();
  await info.press("Enter");
  await expect(page.getByRole("tooltip")).toContainText("Default after every dictation.");
  await expect(automatic).toBeChecked();
  await testInfo.attach("prompt-automation-help", {
    body: await page.screenshot(),
    contentType: "image/png",
  });

  const touch = await browser.newContext({ hasTouch: true, viewport: { width: 360, height: 760 } });
  try {
    const mobile = await touch.newPage();
    await installDictationFixture(mobile);
    await mobile.goto(new URL("/#/prompts", page.url()).href, { timeout: 5000 });
    const touchInfo = mobile.getByRole("button", {
      name: "About running prompts after dictation",
      exact: true,
    });
    await touchInfo.tap({ timeout: 5000 });
    await expect(mobile.getByRole("tooltip")).toHaveText(explanation);
    await expect(
      mobile.getByRole("switch", { name: "Run after dictation", exact: true }),
    ).not.toBeChecked();
    await mobile.getByLabel("Instructions", { exact: true }).tap({ timeout: 5000 });
    await expect(mobile.getByRole("tooltip")).toHaveCount(0);
  } finally {
    await touch.close();
  }
});

test("prompt automatic switch respects model and busy guards and preserves a failed save", async ({
  page,
}) => {
  await page.goto("/#/prompts");
  const automatic = page.getByRole("switch", { name: "Run after dictation", exact: true });
  await expect(automatic).toBeDisabled();
  await page
    .locator("#auto-prompt-help")
    .getByRole("button", { name: "Text model", exact: true })
    .click();
  await page.getByRole("switch", { name: "Enable text processing", exact: true }).check();
  await page.getByLabel("Model identifier", { exact: true }).fill("saved-model");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await automatic.check();
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(automatic).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "More prompt actions", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("navigation", { name: "Saved prompts" })
      .getByRole("button", { name: "Summary", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.failSave = true;
  });
  await saveDraft(page);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Prompts save failed" }),
  ).toBeVisible();
  await expect(automatic).toBeChecked();
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId)).toBe(
    "",
  );
  await navigateMain(page, "History");
  await navigateMain(page, "Prompts & chains");
  await expect(automatic).toBeChecked();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
    .toBe("cleanup");
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByRole("switch", { name: "Enable text processing", exact: true }).uncheck();
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await expect(automatic).not.toBeChecked();
  await expect(automatic).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(automatic).toBeChecked();
  await expect(automatic).toBeEnabled();
});

test("prompt library restores an empty collection and fits long names at the prompt limit", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.prompts = [];
  });
  await page.goto("/#/prompts");
  await expect(page.getByRole("heading", { name: "No saved prompts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Custom prompt");
  await page.getByLabel("Instructions", { exact: true }).fill("Preserve all names.");
  await promptAction(page, "Delete prompt");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete prompt", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "No saved prompts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore default prompts", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Cleanup");
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.length))
    .toBe(2);
  await page.evaluate(() => {
    window.dictationTest.snapshot.textProcessing.prompts = Array.from({ length: 30 }, (_, i) => ({
      id: `prompt-${i}`,
      name: `${i} ${"長い名前".repeat(19)}`,
      instruction: "UnbrokenInstruction".repeat(120),
    }));
    window.dictationTest.history();
  });
  await expect(page.getByRole("button", { name: "Add prompt", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("navigation", { name: "Saved prompts" }).getByRole("button"),
  ).toHaveCount(30);
  const library = page.getByRole("navigation", { name: "Saved prompts" });
  expect(await library.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await library.getByRole("button").last().click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`29 ${"長い名前".repeat(19)}`);
  await expect(
    page.getByRole("switch", { name: "Run after dictation", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 760, height: 560 });
  const picker = page.getByRole("combobox", { name: "Saved prompt", exact: true });
  await picker.click();
  await page.getByRole("option").last().click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`29 ${"長い名前".repeat(19)}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("prompt-library-long-name.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("prompts tabs preserve shared drafts and keep save actions visible in narrow windows", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
  });
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.goto("/#/prompts");
  const tabs = page.getByRole("tablist", { name: "Prompts sections" });
  const modelsTab = tabs.getByRole("tab", { name: "Text model", exact: true });
  const promptsTab = tabs.getByRole("tab", { name: "Prompts", exact: true });
  await expect(promptsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await modelsTab.click();
  await expect(page.getByLabel("Name", { exact: true })).toBeHidden();
  await page.getByLabel("Model identifier", { exact: true }).fill("draft-model");
  await page.screenshot({
    path: testInfo.outputPath("models-wide.png"),
    fullPage: true,
    animations: "disabled",
  });
  await promptsTab.click();
  await expect(page).toHaveURL(/section=prompts/);
  await expect(page.getByLabel("Model identifier", { exact: true })).toBeHidden();
  await expect(
    page.getByRole("switch", { name: "Run after dictation", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("My cleanup");
  await expect(
    page.getByRole("status").filter({ hasText: /Saving|Changes save automatically/ }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("prompts-wide.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Instructions", { exact: true }).scrollIntoViewIfNeeded();
  const save = page.locator('header[aria-label="Prompts & chains"]').getByRole("status");
  await expect(save).toBeInViewport();
  await saveDraft(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        name: window.dictationTest.snapshot.textProcessing.prompts[0].name,
        model: window.dictationTest.snapshot.textProcessing.model,
      })),
    )
    .toEqual({ name: "My cleanup", model: "draft-model" });
  await page.setViewportSize({ width: 760, height: 680 });
  await page.getByLabel("Name", { exact: true }).fill("Narrow cleanup");
  const pickerBounds = await page
    .getByRole("combobox", { name: "Saved prompt", exact: true })
    .boundingBox();
  const addBounds = await page
    .getByRole("button", { name: "Add prompt", exact: true })
    .boundingBox();
  expect(pickerBounds).not.toBeNull();
  expect(addBounds).not.toBeNull();
  expect(Math.abs(pickerBounds!.y - addBounds!.y)).toBeLessThan(1);
  expect(Math.abs(pickerBounds!.height - addBounds!.height)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(save).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("prompts-narrow.png"),
    fullPage: true,
    animations: "disabled",
  });
  await modelsTab.click();
  await page.getByLabel("Model identifier", { exact: true }).fill("discard-model");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByLabel("Model identifier", { exact: true })).toHaveValue("draft-model");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("models-narrow.png"),
    fullPage: true,
    animations: "disabled",
  });
  await modelsTab.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(promptsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My cleanup");
  await page.reload();
  await expect(promptsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
});

test("prompt auto-save status and model response toasts reflect saved state", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
  });
  await page.goto("/#/prompts?section=models");
  await page.getByLabel("Model identifier", { exact: true }).fill("new-model");
  await saveDraft(page);
  const saved = page.locator('header[aria-label="Prompts & chains"]').getByRole("status");
  await expect(saved).toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.model)).toBe(
    "new-model",
  );
  await expect(saved).toHaveText("Changes save automatically");
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  const response = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Model responded successfully." });
  await expect(response).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("Model responded successfully.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("model-response-toast.png"),
    animations: "disabled",
  });
  await response.getByRole("button", { name: "Dismiss notification" }).click();
  await page.evaluate(() => {
    window.dictationTest.failProcessing = true;
  });
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  const failure = page.locator('[data-slot="toast"]').filter({ hasText: "Model unavailable" });
  await expect(failure).toBeVisible();
  await expect(response).toHaveCount(0);
  await page.keyboard.press("F6");
  await failure.getByRole("button", { name: "Dismiss notification" }).click();
  await page.evaluate(() => {
    window.dictationTest.failProcessing = false;
  });
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  await expect(response).toHaveCount(1);
  await expect(response).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(response).toBeVisible();
});

test("failed prompt saves show an error toast and retain edits for retry", async ({ page }) => {
  await page.goto("/#/prompts?section=prompts");
  await page.getByLabel("Name", { exact: true }).fill("Retry cleanup");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await saveDraft(page);
  const failure = page.locator('[data-slot="toast"]').filter({ hasText: "Prompts save failed" });
  await expect(failure).toBeVisible();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Prompts saved." }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Retry cleanup");
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].name),
  ).toBe("Cleanup");
  await page.keyboard.press("F6");
  await failure.getByRole("button", { name: "Dismiss notification" }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await saveDraft(page);
  await expect(
    page.locator('header[aria-label="Prompts & chains"]').getByRole("status"),
  ).toHaveText("Changes save automatically");
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].name),
  ).toBe("Retry cleanup");
});

test("model testing stays inside its form and cancellation remains available", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
    Reflect.set(
      Reflect.get(window, "mockBackend").main.App,
      "TestTextModel",
      async () => new Promise<string>((resolve) => Reflect.set(window, "finishModelTest", resolve)),
    );
  });
  await page.goto("/#/prompts?section=models");
  const card = page.getByRole("region", { name: "Text model", exact: true });
  await card.getByRole("button", { name: "Test model", exact: true }).click();
  await expect(card.getByRole("status").filter({ hasText: "Testing model…" })).toBeVisible();
  await expect(page.getByLabel("Local server URL")).toBeDisabled();
  const cancel = card.getByRole("button", { name: "Cancel test", exact: true });
  await expect(cancel).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("model-test-in-card.png"),
    animations: "disabled",
  });
  await cancel.click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length))
    .toBe(1);
  await page.evaluate(() => Reflect.get(window, "finishModelTest")("OK"));
  await expect(cancel).toBeHidden();
  await expect(card.getByRole("button", { name: "Test model", exact: true })).toBeEnabled();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Model responded successfully." }),
  ).toHaveCount(0);
});

test("model response toasts dismiss automatically", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
  });
  await page.goto("/#/prompts?section=models");
  await expect(page.getByRole("button", { name: "Test model", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  const response = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Model responded successfully." });
  await expect(response).toBeVisible();
  await page.mouse.move(0, 0);
  // Keep the timeout and Motion's exit animation on the same browser clock.
  await expect(response).toBeHidden({ timeout: 10000 });
});

test("prompt deletion asks for confirmation and cancel preserves draft edits", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.autoPromptId = "cleanup";
  });
  await page.goto("/#/prompts?section=prompts");
  await page.getByLabel("Name", { exact: true }).fill("My cleanup");
  await page.getByLabel("Instructions", { exact: true }).fill("Keep all names unchanged.");
  const actions = page.getByRole("button", {
    name: "More prompt actions",
    exact: true,
  });
  await promptAction(page, "Delete prompt");
  const dialog = page.getByRole("dialog", {
    name: "Delete this prompt?",
    exact: true,
  });
  await expect(dialog).toContainText("My cleanup");
  await expect(dialog).toContainText("removed. You can undo this deletion");
  await expect(dialog).toContainText("Automatic processing after dictation will be turned off");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("delete-prompt-confirmation.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My cleanup");
  await expect(page.getByLabel("Instructions", { exact: true })).toHaveValue(
    "Keep all names unchanged.",
  );
  await expect(
    page.getByRole("switch", { name: "Run after dictation", exact: true }),
  ).toBeChecked();
  await promptAction(page, "Delete prompt");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My cleanup");
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.length),
  ).toBe(2);
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId)).toBe(
    "cleanup",
  );
});

test("confirmed prompt deletion can be discarded and persists only after save", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
    window.dictationTest.snapshot.textProcessing.autoPromptId = "cleanup";
  });
  await page.goto("/#/prompts?section=prompts");
  const dialog = page.getByRole("dialog", {
    name: "Delete this prompt?",
    exact: true,
  });
  await promptAction(page, "Delete prompt");
  await dialog.getByRole("button", { name: "Delete prompt", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Summary");
  await expect(
    page.getByRole("switch", { name: "Run after dictation", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByText(
      "Turn on to use this prompt after dictation. Profiles and chains can override the default.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.length),
  ).toBe(2);
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId)).toBe(
    "cleanup",
  );
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Saved prompts" })
    .getByRole("button", { name: "Cleanup", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Run after dictation", exact: true }),
  ).toBeChecked();
  await promptAction(page, "Delete prompt");
  await dialog.getByRole("button", { name: "Delete prompt", exact: true }).click();
  await saveDraft(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        ids: window.dictationTest.snapshot.textProcessing.prompts.map((p) => p.id),
        automatic: window.dictationTest.snapshot.textProcessing.autoPromptId,
        model: window.dictationTest.snapshot.textProcessing.model,
      })),
    )
    .toEqual({ ids: ["summary"], automatic: "", model: "saved-model" });
});

test("prompt deletion confirmation stays protected if work starts while open", async ({ page }) => {
  await page.goto("/#/prompts?section=prompts");
  await promptAction(page, "Delete prompt");
  const dialog = page.getByRole("dialog", {
    name: "Delete this prompt?",
    exact: true,
  });
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(dialog.getByRole("button", { name: "Delete prompt", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => window.dictationTest.status("idle"));
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Cleanup");
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.length),
  ).toBe(2);
});

test("reset instructions preserves customized prompt names", async ({ page }) => {
  await page.goto("/#/prompts?section=prompts");
  for (const name of ["Cleanup", "Summary"]) {
    await page
      .getByRole("navigation", { name: "Saved prompts" })
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(`My ${name}`);
    await page.getByLabel("Instructions", { exact: true }).fill("My special instructions");
    await promptAction(page, "Reset instructions");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`My ${name}`);
    await expect(page.getByLabel("Instructions", { exact: true })).not.toHaveValue(
      "My special instructions",
    );
    await saveDraft(page);
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.dictationTest.snapshot.textProcessing.prompts.find((p) => p.id === id)?.name,
          name.toLowerCase(),
        ),
      )
      .toBe(`My ${name}`);
  }
});

test("prompt refinement previews an unsaved draft and saves only after applying", async ({
  page,
}, testInfo) => {
  await page.goto("/#/prompts?section=models");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refine prompt", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByLabel("Model identifier", { exact: true }).fill("draft-model");
  await showServerAddress(page);
  await page.getByLabel("Local server URL", { exact: true }).fill("http://127.0.0.1:1234/v1");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByLabel("Instructions", { exact: true }).fill("summarize in bullets, keep names");
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Refine prompt",
    exact: true,
  });
  await expect(dialog.getByLabel("Your instructions", { exact: true })).toHaveValue(
    "summarize in bullets, keep names",
  );
  await expect(dialog.getByRole("button", { name: "Apply to draft", exact: true })).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.refinements.map(({ endpoint, model, input }) => ({
          endpoint,
          model,
          input,
        })),
      ),
    )
    .toEqual([
      {
        endpoint: "http://127.0.0.1:1234/v1",
        model: "draft-model",
        input: "summarize in bullets, keep names",
      },
    ]);
  await page.evaluate(() =>
    window.dictationTest.processing!.resolve("Summarize in bullet points. Preserve all names."),
  );
  await expect(dialog.getByLabel("Refined instructions", { exact: true })).toHaveValue(
    "Summarize in bullet points. Preserve all names.",
  );
  await page.screenshot({
    path: testInfo.outputPath("prompt-refinement.png"),
    animations: "disabled",
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
    )
    .toBe("Clean up text.");
  await dialog.getByRole("button", { name: "Apply to draft", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Instructions", { exact: true })).toHaveValue(
    "Summarize in bullet points. Preserve all names.",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Refined instructions applied" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
    )
    .toBe("Clean up text.");
  await saveDraft(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
    )
    .toBe("Summarize in bullet points. Preserve all names.");
  expect(
    await page.evaluate(() => ({
      enabled: window.dictationTest.snapshot.textProcessing.enabled,
      outputs: window.dictationTest.outputs.length,
      clipboard: window.dictationTest.clipboard,
    })),
  ).toEqual({ enabled: false, outputs: 0, clipboard: "" });
});

test("discarding prompt refinement preserves draft and cancels late results", async ({ page }) => {
  await page.goto("/#/prompts?section=models");
  await page.getByLabel("Model identifier", { exact: true }).fill("local");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByLabel("Instructions", { exact: true }).fill("My rough draft");
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.processing)).toBe(true);
  await page.getByRole("button", { name: "Discard preview", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length))
    .toBe(1);
  await page.evaluate(() => window.dictationTest.processing!.resolve("Late result"));
  await expect(page.getByLabel("Instructions", { exact: true })).toHaveValue("My rough draft");
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Fresh result"));
  await expect(page.getByLabel("Refined instructions", { exact: true })).toHaveValue(
    "Fresh result",
  );
  await page.getByRole("button", { name: "Discard preview", exact: true }).click();
  await expect(page.getByLabel("Instructions", { exact: true })).toHaveValue("My rough draft");
});

test("prompt refinement can cancel and retry after a model failure", async ({ page }) => {
  await page.goto("/#/prompts?section=models");
  await page.getByLabel("Model identifier", { exact: true }).fill("local");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failProcessing = true;
  });
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Model unavailable");
  await page.evaluate(() => {
    window.dictationTest.failProcessing = false;
  });
  await page.getByRole("button", { name: "Refine again", exact: true }).click();
  await page.getByRole("button", { name: "Cancel refinement", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Cancelled late result"));
  await expect(page.getByRole("alert")).toHaveText("Processing cancelled");
  await expect(page.getByRole("button", { name: "Apply to draft", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refine again", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("New instructions"));
  await expect(page.getByLabel("Refined instructions", { exact: true })).toHaveValue(
    "New instructions",
  );
});

test("leaving prompts cancels refinement and old backends show recovery guidance", async ({
  page,
}) => {
  await page.goto("/#/prompts?section=models");
  await page.getByLabel("Model identifier", { exact: true }).fill("local");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.processing)).toBe(true);
  await page.evaluate(() => {
    location.hash = "#/history";
  });
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length))
    .toBe(1);
  await page.evaluate(() => window.dictationTest.processing!.resolve("Late instructions"));
  await page.goto("/#/prompts?section=models");
  await page.getByLabel("Model identifier", { exact: true }).fill("local");
  await page.evaluate(() => {
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "RefinePrompt");
  });
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Yap's interface and backend are different versions",
  );
});

test("disconnected saved microphone allows unrelated settings saves", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.settings.microphoneId = "unplugged";
  });
  await page.goto("/#/settings");
  await expect(
    page.getByText("Reconnect the selected microphone or choose another input.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "Light cleanup" }).check();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.microphoneId))
    .toBe("unplugged");
});

test("setup ignores an older microphone enumeration reply", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.settings.setupComplete = false;
    const app = Reflect.get(window, "mockBackend").main.App;
    const pending: ((devices: { id: string; name: string }[]) => void)[] = [];
    Reflect.set(window, "micReplies", pending);
    app.GetMicrophones = () => new Promise((resolve) => pending.push(resolve));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "micReplies").length)).toBe(1);
  await page.getByRole("button", { name: "Refresh microphones", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "micReplies").length)).toBe(2);
  await page.evaluate(() =>
    Reflect.get(window, "micReplies")[1]([{ id: "new", name: "New input" }]),
  );
  await page.getByRole("combobox", { name: "Microphone", exact: true }).click();
  await expect(page.getByRole("option", { name: "New input", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    Reflect.get(window, "micReplies")[0]([{ id: "old", name: "Old input" }]),
  );
  await page.getByRole("combobox", { name: "Microphone", exact: true }).click();
  await expect(page.getByRole("option", { name: "New input", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Old input", exact: true })).toHaveCount(0);
});

test("obsolete snapshot failures cannot undo connection recovery", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const s = window.dictationTest;
    s.deferSnapshots = true;
    s.legacySnapshot = true;
    s.history();
    s.legacySnapshot = false;
    s.history();
    s.pendingSnapshots[1]();
  });
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
  await page.evaluate(() => window.dictationTest.pendingSnapshots[0]());
  await settle(page);
  await expect(page.getByRole("heading", { name: "Connection recovery", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Couldn’t connect to Yap", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("Models compares models, updates the current selection, and fits narrow screens", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("desktop-theme")) localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const s = window.dictationTest.snapshot;
    s.settings.modelPath = "/small";
    s.models = [
      {
        id: "tiny",
        name: "Whisper Tiny",
        description: "Fastest · short dictation",
        size: 77691713,
        installed: true,
        path: "/tiny",
        diskBytes: 77691713,
        removable: true,
      },
      {
        id: "base",
        name: "Whisper Base",
        description: "Lightweight · everyday dictation",
        size: 147951465,
        installed: true,
        path: "/base",
        diskBytes: 147951465,
        removable: true,
      },
      {
        id: "small",
        name: "Whisper Small",
        description: "Balanced · better accuracy",
        size: 487601967,
        installed: true,
        path: "/small",
        diskBytes: 487601967,
        removable: true,
      },
    ];
  });
  await page.setViewportSize({ width: 1347, height: 840 });
  await page.goto("/#/models");
  const current = currentSpeechModel(page);
  await expect(current).toContainText("Whisper Small");
  await expect(page.getByLabel("Model storage", { exact: true })).toContainText("713.2 MB");
  await page.screenshot({ path: testInfo.outputPath("models-redesign-dark.png"), fullPage: true });
  await page
    .getByRole("region", { name: "Whisper Base", exact: true })
    .getByRole("button", { name: "Use model", exact: true })
    .click();
  await expect(current).toContainText("Whisper Base");
  await expect(
    (await modelMenu(page, "Whisper Base")).getByRole("menuitem", {
      name: "Remove model",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    (await modelMenu(page, "Whisper Small")).getByRole("menuitem", {
      name: "Remove model",
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    localStorage.setItem("desktop-theme", "light");
  });
  await page.reload();
  await expect(current).toContainText("Whisper Small");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("models-redesign-light.png"), fullPage: true });
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(page.getByRole("link", { name: "Bring your own model" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("models-redesign-narrow.png"),
    fullPage: true,
  });
});

const additionalSpeechModels = [
  { id: "medium", name: "Whisper Medium", size: 1533763059 },
  { id: "large-v3", name: "Whisper Large v3", size: 3095033483 },
  { id: "parakeet-tdt-0.6b-v3", name: "NVIDIA Parakeet TDT v3", size: 713975456 },
  { id: "moonshine-v2-tiny", name: "Moonshine V2 Tiny", size: 45233659 },
  { id: "moonshine-v2-small", name: "Moonshine V2 Small", size: 142300974 },
  { id: "moonshine-v2-medium", name: "Moonshine V2 Medium", size: 269141623 },
  { id: "moonshine-base", name: "Moonshine Base", size: 141001190 },
];

test("Models searches and filters compact rows, exposes languages, and retains download lifecycle", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    (catalog) => {
      const snapshot = window.dictationTest.snapshot;
      snapshot.models = catalog.map((model) => ({
        ...model,
        description: model.id.startsWith("moonshine")
          ? "English only"
          : "Multilingual speech model",
        installed: model.id === "moonshine-base",
        path: `/models/${model.id}`,
        diskBytes: model.id === "moonshine-base" ? model.size : 0,
        removable: model.id === "moonshine-base",
      }));
      snapshot.settings.modelPath = "/models/moonshine-base";
      localStorage.setItem("yap-sidebar-collapsed", "true");
    },
    [
      { id: "tiny", name: "Whisper Tiny", size: 77691713 },
      { id: "base", name: "Whisper Base", size: 147951465 },
      { id: "small", name: "Whisper Small", size: 487601967 },
      ...additionalSpeechModels,
    ],
  );
  await page.setViewportSize({ width: 1347, height: 840 });
  await page.goto("/#/models");
  const rows = page.locator('[data-slot="model-row"]');
  await expect(page.getByRole("button", { name: "Downloaded", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "All models", exact: true }).click();
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText("Moonshine Base");
  const search = page.getByRole("textbox", { name: "Search speech models" });
  await search.fill("Parakeet");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("NVIDIA Parakeet TDT v3");
  await search.fill("Japanese");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("Whisper");
  await search.fill("no-such-model");
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: "No matching models" }),
  ).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "Downloaded", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Moonshine Base");
  await page.getByRole("button", { name: "All models", exact: true }).click();
  const badge = page.getByRole("button", {
    name: /^Supported languages for Whisper Tiny/,
  });
  await badge.click();
  const languages = page.getByRole("dialog", {
    name: "Supported languages for Whisper Tiny",
    exact: true,
  });
  await expect(languages).toContainText("99 languages");
  await expect(languages).toContainText("Japanese");
  await expect(languages).toContainText("Yoruba");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 480, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("models-compact-narrow.png"), fullPage: true });
  await navigateMain(page, "Dictate");
  await simulateModelDownload(page);
  await openRecordingOptions(page);
  await page.getByRole("combobox", { name: "Speech model", exact: true }).click();
  await page.getByRole("option", { name: /NVIDIA Parakeet TDT v3/ }).click();
  await navigateMain(page, "Models");
  const parakeet = page.getByRole("region", { name: "NVIDIA Parakeet TDT v3", exact: true });
  await expect(
    parakeet.getByRole("progressbar", { name: "Model download progress" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Whisper Tiny", exact: true })
      .getByRole("button", { name: "Download & use", exact: true }),
  ).toBeDisabled();
  await parakeet.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(parakeet.getByRole("progressbar")).toHaveCount(0);
});

for (const model of additionalSpeechModels) {
  test(`${model.name} can download from Models and become the active speech model`, async ({
    page,
  }) => {
    await homeModelScenario(page);
    await page.evaluate((model) => {
      window.dictationTest.snapshot.models.push({
        ...model,
        description: model.id.startsWith("moonshine")
          ? "English only"
          : "Multilingual speech model",
        installed: false,
        path: model.id.startsWith("moonshine")
          ? `/models/${model.id}`
          : model.id.startsWith("parakeet")
            ? `/models/${model.id}.q8_0.gguf`
            : `/models/ggml-${model.id}.bin`,
        diskBytes: 0,
        removable: false,
      });
      window.dictationTest.history();
    }, model);
    await simulateModelDownload(page);
    await navigateMain(page, "Models");
    await page.getByRole("button", { name: "All models", exact: true }).click();
    const card = page.getByRole("region", { name: model.name, exact: true });
    await expect(card.getByTitle("Download size", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Download & use", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs))
      .toEqual([model.id]);
    await expect(card.getByRole("progressbar", { name: "Model download progress" })).toBeVisible();
    await expect(currentSpeechModel(page)).toContainText("Whisper Tiny");
    await page.evaluate((id) => {
      const state = window.dictationTest;
      const downloaded = state.snapshot.models.find((entry) => entry.id === id)!;
      downloaded.installed = true;
      downloaded.removable = true;
      downloaded.diskBytes = downloaded.size;
      state.snapshot.settings.modelPath = downloaded.path;
      state.snapshot.status.phase = "idle";
      state.snapshot.status.message = "Model installed. Ready to dictate.";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
      state.history();
    }, model.id);
    await expectActiveModel(card);
    await expect(currentSpeechModel(page)).toContainText(model.name);
    await navigateMain(page, "Dictate");
    await openRecordingOptions(page);
    const selector = page.getByRole("combobox", { name: "Speech model", exact: true });
    await expect(selector).toContainText(model.name);
    await selector.click();
    await expect(
      page
        .getByRole("option", { name: model.name, exact: true })
        .getByRole("img", { name: "Download required" }),
    ).toHaveCount(0);
  });
}

test("model downloads stay inside the matching card across navigation and cancellation", async ({
  page,
}, testInfo) => {
  await homeModelScenario(page);
  await simulateModelDownload(page);
  await openRecordingOptions(page);
  await page.getByRole("combobox", { name: "Speech model", exact: true }).click();
  await page.getByRole("option", { name: /Whisper Small/ }).click();
  await navigateMain(page, "Models");
  const small = page.getByRole("region", { name: "Whisper Small", exact: true });
  const progress = small.getByRole("progressbar", { name: "Model download progress" });
  await expect(progress).toBeVisible();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.message = "Downloading Whisper runtime…";
    state.snapshot.status.progress = 0.42;
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(progress).toHaveAttribute("aria-valuenow", "42");
  await expect(small).toContainText("Downloading Whisper runtime…");
  await expect(page.getByRole("progressbar", { name: "Model download progress" })).toHaveCount(1);
  await expectActiveModel(page.getByRole("region", { name: "Whisper Tiny", exact: true }));
  await expect(
    page
      .getByRole("region", { name: "Whisper Base", exact: true })
      .getByRole("button", { name: "Use model", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.message = "Checking or downloading Whisper small…";
    state.snapshot.status.progress = 0.65;
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(progress).toHaveAttribute("aria-valuenow", "65");
  await expect(small).toContainText("65%");
  await page.screenshot({
    path: testInfo.outputPath("model-download-in-card.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await navigateMain(page, "Models");
  await expect(progress).toHaveAttribute("aria-valuenow", "65");
  await small.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(small.getByRole("button", { name: "Download & use", exact: true })).toBeEnabled();
  await expect(currentSpeechModel(page)).toContainText("Whisper Tiny");
  await small.getByRole("button", { name: "Download & use", exact: true }).click();
  await expect(progress).toBeVisible();
  await page.evaluate(() => {
    const state = window.dictationTest;
    const model = state.snapshot.models.find((model) => model.id === "small")!;
    model.installed = true;
    state.snapshot.settings.modelPath = model.path;
    state.snapshot.status.phase = "idle";
    state.snapshot.status.message = "Model installed. Ready to dictate.";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    state.history();
  });
  await expect(progress).toHaveCount(0);
  await expectActiveModel(small);
});

test("Models handles custom selections and missing model files", async ({ page }) => {
  await homeModelScenario(page, true);
  await simulateModelDownload(page);
  await page.goto("/#/models");
  const current = currentSpeechModel(page);
  await expect(current).toContainText("Custom model");
  await expect(current).toContainText("Active");
  await expect(page.getByRole("button", { name: "Check & repair runtime" })).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.settings.modelPath = "/small";
    state.snapshot.models.find((model) => model.id === "small")!.removable = true;
    state.history();
  });
  await expect(current).toContainText("Needs attention");
  const repair = page.getByRole("button", { name: "Repair & use", exact: true });
  await expect(repair).toBeEnabled();
  await expect(
    (await modelMenu(page, "Whisper Small")).getByRole("menuitem", {
      name: "Remove model",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await repair.click();
  const card = page.getByRole("region", { name: "Whisper Small", exact: true });
  await expect(card.getByRole("progressbar", { name: "Model download progress" })).toBeVisible();
  await expect(repair).toHaveCount(0);
  await card.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(repair).toBeEnabled();
});

test("active valid models offer runtime verification and repair", async ({ page }) => {
  await page.addInitScript(() => {
    const s = window.dictationTest.snapshot;
    s.settings.modelPath = "/base";
    s.models = [
      {
        id: "base",
        name: "Whisper Base",
        description: "Everyday",
        size: 100,
        path: "/base",
        installed: true,
        diskBytes: 100,
        removable: true,
      },
    ];
  });
  await page.goto("/#/models");
  await expectActiveModel(currentSpeechModel(page));
  await modelAction(page, "Check & repair runtime");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs))
    .toEqual(["base"]);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.modelPath))
    .toBe("/base");
});

for (const theme of ["light", "dark"] as const) {
  test(`indicator restores saved ${theme} appearance`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
    await page.addInitScript((saved) => localStorage.setItem("desktop-theme", saved), theme);
    await page.goto("/#/settings?section=general");
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.indicatorThemes.at(-1)))
      .toBe(theme === "dark");
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.indicatorThemes.at(-1)))
      .toBe(theme === "dark");
  });
}

test("indicator appearance follows live theme selection and system changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings?section=general");
  const lastTheme = () => page.evaluate(() => window.dictationTest.indicatorThemes.at(-1));
  const appearance = page.getByRole("group", { name: "Color theme", exact: true });
  await expect.poll(lastTheme).toBe(false);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(lastTheme).toBe(true);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await appearance.getByRole("button", { name: "Light", exact: true }).click();
  await expect.poll(lastTheme).toBe(false);
  await page.emulateMedia({ colorScheme: "light" });
  await appearance.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(lastTheme).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await appearance.getByRole("button", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(lastTheme).toBe(false);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

declare global {
  interface Window {
    dictationTest: {
      snapshot: Snapshot;
      recentlyDeleted: Session[];
      indicatorThemes: boolean[];
      callbacks: Record<string, (...args: unknown[]) => void>;
      deferSnapshots: boolean;
      failSnapshot: boolean;
      legacySnapshot: boolean;
      installedModelIDs: string[];
      pendingSnapshots: (() => void)[];
      deferHistory: boolean;
      pendingHistory: { query: string; page: number; resolve: () => void }[];
      historyRequests: { query: string; page: number; deleted: boolean }[];
      failSession: boolean;
      deferSessions: boolean;
      pendingSessions: { id: string; resolve: () => void }[];
      failHistory: boolean;
      failSave: boolean;
      captureToken: string;
      captureEnded: number;
      failCapture: boolean;
      failRestore: boolean;
      deferCapture: boolean;
      resolveCapture: (() => void) | null;
      occupiedShortcut: string;
      processing: {
        id: string;
        input: string;
        prompt: string;
        resolve: (result: string) => void;
        reject: (error: Error) => void;
      } | null;
      outputs: GeneratedOutput[];
      failOutputs: boolean;
      failProcessing: boolean;
      textModels: string[];
      modelListError: string;
      deferModelList: boolean;
      modelListRequests: { id: string; endpoint: string }[];
      pendingModelLists: {
        id: string;
        endpoint: string;
        resolve: (models: string[]) => void;
      }[];
      cancelledProcessing: string[];
      refinements: {
        id: string;
        endpoint: string;
        model: string;
        input: string;
      }[];
      exportedText: string;
      clipboard: string;
      failClipboard: boolean;
      audioImports: number;
      droppedAudio: string[][];
      cancelAudioDialog: boolean;
      failAudioImport: boolean;
      backupExports: boolean[];
      backupRestores: { id: string; preferences: boolean }[];
      discardedBackups: string[];
      backupPreview: BackupPreview | null;
      failBackup: boolean;
      deferBackup: boolean;
      resolveBackup: (() => void) | null;
      checks: DiagnosticCheck[];
      status: (phase: string) => void;
      history: () => void;
    };
  }
}

async function installDictationFixture(page: Page) {
  await page.addInitScript(() => {
    const state: Window["dictationTest"] = {
      recentlyDeleted: [],
      historyRequests: [],
      snapshot: {
        textProcessing: {
          enabled: false,
          endpoint: "http://127.0.0.1:11434/v1",
          model: "",
          autoPromptId: "",
          prompts: [
            { id: "cleanup", name: "Cleanup", instruction: "Clean up text." },
            { id: "summary", name: "Summary", instruction: "Summarize text." },
          ],
        },
        settings: {
          microphoneId: "",
          whisperPath: "/whisper",
          modelPath: "/model",
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
          statsForNerds: false,
        },
        status: {
          phase: "idle",
          message: "Ready",
          startedAt: 0,
          transcript: "",
          progress: 0,
          shortcutError: "",
          indicatorError: "",
          trayError: "",
          startupError: "",
          historyError: "",
        },
        models: [],
        history: [],
        ready: true,
        dataDir: "",
        floatingIndicator: true,
        launchAtLoginAvailable: true,
        startInTrayAvailable: true,
        vocabulary: [],
        microphoneTested: false,
        shortcutTested: false,
        diagnostic: {
          phase: "",
          message: "",
          details: "",
          transcript: "",
          durationMs: 0,
        },
      },
      callbacks: {},
      indicatorThemes: [],
      failSession: false,
      deferSessions: false,
      pendingSessions: [],
      failSnapshot: false,
      legacySnapshot: false,
      installedModelIDs: [],
      deferSnapshots: false,
      pendingSnapshots: [],
      deferHistory: false,
      pendingHistory: [],
      failHistory: false,
      captureToken: "",
      captureEnded: 0,
      failCapture: false,
      failRestore: false,
      deferCapture: false,
      resolveCapture: null,
      occupiedShortcut: "",
      failSave: false,
      exportedText: "",
      clipboard: "",
      failClipboard: false,
      checks: [
        {
          id: "runtime",
          name: "Whisper runtime",
          ready: true,
          message: "Executable found",
        },
        {
          id: "model",
          name: "Speech model",
          ready: true,
          message: "Model file readable",
        },
        {
          id: "microphone",
          name: "Microphone",
          ready: true,
          message: "System default",
        },
      ],
      status(phase: string) {
        if (phase === "recording") state.snapshot.latestResult = null;
        state.snapshot.status = {
          ...state.snapshot.status,
          phase,
          message: phase === "transcribing" ? "Transcribing…" : "Ready",
          startedAt: Date.now(),
        };
        state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
      },
      outputs: [],
      failOutputs: false,
      processing: null,
      failProcessing: false,
      cancelledProcessing: [],
      refinements: [],
      textModels: [],
      modelListError: "",
      deferModelList: false,
      modelListRequests: [],
      pendingModelLists: [],
      backupExports: [],
      backupRestores: [],
      discardedBackups: [],
      backupPreview: null,
      failBackup: false,
      deferBackup: false,
      resolveBackup: null,
      audioImports: 0,
      droppedAudio: [],
      cancelAudioDialog: false,
      failAudioImport: false,
      history() {
        state.callbacks["dictation:history"]();
      },
    };
    function beginOutput(id: string, sessionID: string, prompt: TextPrompt, input: string) {
      if (state.failProcessing) return Promise.reject(new Error("Model unavailable"));
      const config = structuredClone(state.snapshot.textProcessing);
      const previous = structuredClone(state.snapshot.status);
      const savedPrompt = structuredClone(prompt);
      state.status("text-processing");
      return new Promise<string>((resolve, reject) => {
        state.processing = {
          id,
          input,
          prompt: prompt.id,
          reject,
          resolve: (text) => {
            state.processing = null;
            state.snapshot.status = previous;
            state.callbacks["dictation:status"](structuredClone(previous));
            if (state.cancelledProcessing.includes(id)) {
              reject(new Error("Processing cancelled"));
              return;
            }
            if (!state.snapshot.history.some((entry) => entry.id === sessionID)) {
              reject(new Error("This dictation no longer exists"));
              return;
            }
            state.outputs.unshift({
              id: crypto.randomUUID(),
              sessionId: sessionID,
              createdAt: new Date().toISOString(),
              prompt: savedPrompt,
              model: config.model,
              endpoint: config.endpoint,
              input,
              text,
            });
            state.history();
            resolve(text);
          },
        };
      });
    }
    let homeResultHidden = false;
    function getHomeResult(): HomeResult | null {
      if (
        ["recording", "transcribing", "text-processing", "backup"].includes(
          state.snapshot.status.phase,
        )
      )
        throw new Error("Finish the current operation before using the result");
      const temporary = state.snapshot.latestResult;
      if (temporary) homeResultHidden = false;
      if (homeResultHidden) return null;
      const session = temporary?.session ?? state.snapshot.history[0];
      if (!session) return null;
      const result: HomeResult = {
        session: structuredClone(session),
        text: temporary?.text ?? session.finalTranscript,
        outputs: structuredClone(
          temporary
            ? (temporary.outputs ?? (temporary.output ? [temporary.output] : []))
            : state.outputs.filter((output) => output.sessionId === session.id),
        ),
        outputId: "",
        saved: !temporary,
        imported: false,
        revision: "",
        outcomes: {
          transcription: "complete",
          history: temporary ? "temporary" : "saved",
          processing: "unknown",
          clipboard: "unknown",
          paste: "unknown",
        },
      };
      result.revision = JSON.stringify(result);
      return result;
    }
    window.dictationTest = state;
    function profileSnapshot() {
      if (state.snapshot.settings.setupComplete) {
        const profiles = state.snapshot.dictationProfiles ?? [];
        let baseline = profiles.find((p) => p.id === state.snapshot.defaultProfileId);
        if (!baseline) {
          baseline = profiles.find((p) => p.name === "Default");
          if (!baseline) {
            baseline = {
              id: "default",
              name: "Default",
              modelPath: state.snapshot.settings.modelPath,
              language: state.snapshot.settings.language,
              cleanText: state.snapshot.settings.cleanText,
              autoPromptId: state.snapshot.textProcessing.autoPromptId,
            };
            profiles.unshift(baseline);
          }
          state.snapshot.defaultProfileId = baseline.id;
          state.snapshot.activeProfileId = baseline.id;
        }
        state.snapshot.dictationProfiles = profiles;
        if (!state.snapshot.activeProfileId) state.snapshot.activeProfileId = baseline.id;
      }
      const selected = state.snapshot.dictationProfiles?.find(
        (p) => p.id === state.snapshot.activeProfileId,
      );
      state.snapshot.profileModified =
        !!selected &&
        (selected.modelPath !== state.snapshot.settings.modelPath ||
          selected.language !== state.snapshot.settings.language ||
          selected.cleanText !== state.snapshot.settings.cleanText ||
          selected.autoPromptId !== state.snapshot.textProcessing.autoPromptId);
    }
    Object.assign(window, {
      mockEvents: {
        onFileDrop(
          handler: (x: number, y: number, paths: string[]) => void,
          useDropTarget: boolean,
        ) {
          if (useDropTarget) throw new Error("Expected window-wide audio drops");
          state.callbacks["wails:file-drop"] = handler as (...args: unknown[]) => void;
        },
        offFileDrop() {
          delete state.callbacks["wails:file-drop"];
        },
        ClipboardSetText: async (text: string) => {
          if (state.failClipboard) return false;
          state.clipboard = text;
          return true;
        },
        subscribe(topic: string, handler: (...args: unknown[]) => void) {
          state.callbacks[topic] = handler;
          return () => {
            delete state.callbacks[topic];
          };
        },
      },
      mockBackend: {
        main: {
          App: {
            SetIndicatorTheme: async (dark: boolean) => {
              state.indicatorThemes.push(dark);
            },
            ImportDroppedAudio: async (paths: string[]) => {
              if (paths.length !== 1) throw new Error("drop one audio file at a time");
              if (!/\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff|wma)$/i.test(paths[0]))
                throw new Error("choose WAV, MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, or WMA audio");
              if (state.failAudioImport)
                throw new Error("choose audio between 0.3 seconds and 25 minutes");
              state.droppedAudio.push(paths);
              state.status("transcribing");
              state.snapshot.status.message = "Transcribing imported audio…";
              state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
            },
            ImportAudio: async () => {
              state.audioImports++;
              if (state.failAudioImport)
                throw new Error("Choose an uncompressed mono or stereo WAV");
              if (state.cancelAudioDialog) return;
              state.status("transcribing");
              state.snapshot.status.message = "Transcribing imported audio…";
              state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
            },
            ExportBackup: async (audio: boolean) => {
              if (state.failBackup) throw new Error("Backup could not be saved");
              state.backupExports.push(audio);
              return {
                sessions: 12,
                outputs: 3,
                prompts: 2,
                vocabulary: 4,
                recordings: audio ? 2 : 0,
                missingRecordings: audio ? 1 : 0,
                duplicateSessions: 0,
                duplicateOutputs: 0,
                skippedPrompts: 0,
                skippedVocabulary: 0,
              } satisfies BackupSummary;
            },
            PreviewBackup: async () => {
              if (state.failBackup) throw new Error("Unsupported or damaged backup");
              if (state.deferBackup)
                return new Promise((resolve) => {
                  state.resolveBackup = () => resolve(structuredClone(state.backupPreview));
                });
              return structuredClone(state.backupPreview);
            },
            DiscardBackupPreview: async (id: string) => {
              state.discardedBackups.push(id);
            },
            RestoreBackup: async (id: string, preferences: boolean) => {
              if (state.failBackup) throw new Error("Restore failed; no changes were saved");
              state.backupRestores.push({ id, preferences });
              if (preferences)
                Object.assign(state.snapshot.settings, state.backupPreview!.preferences);
              state.snapshot.history.unshift({
                id: "restored",
                createdAt: "2026-10-08",
                durationMs: 1000,
                rawTranscript: "Restored transcription",
                finalTranscript: "Restored transcription",
                speechModel: "base",
                language: "de",
                audioPath: "",
              });
              return structuredClone(state.backupPreview!.summary);
            },
            GetSnapshot() {
              profileSnapshot();
              if (state.failSnapshot) return Promise.reject(new Error("Snapshot unavailable"));
              const copy = structuredClone(state.snapshot);
              if (state.legacySnapshot) Reflect.deleteProperty(copy, "textProcessing");
              if (state.deferSnapshots)
                return new Promise((resolve) => {
                  state.pendingSnapshots.push(() => resolve(copy));
                });
              return Promise.resolve(copy);
            },
            GetHomeResult: async () => getHomeResult(),
            HomeResultAction: async (
              id: string,
              revision: string,
              action: string,
              text: string,
            ) => {
              const result = getHomeResult();
              if (!result || result.session.id !== id || result.revision !== revision)
                throw new Error("This result changed or is no longer available");
              if (action === "copy" || action.startsWith("copy:")) {
                const value =
                  action === "copy"
                    ? result.text
                    : result.outputs.find((output) => output.id === action.slice(5))?.text;
                if (value === undefined) throw new Error("This output is no longer available");
                if (state.failClipboard) throw new Error("Clipboard unavailable");
                state.clipboard = value;
                state.snapshot.status.transcript = value;
              } else if (action === "save") {
                if (result.saved || state.failSave) throw new Error("Could not save this result");
                state.snapshot.history.unshift(structuredClone(result.session));
                state.outputs.push(...structuredClone(result.outputs));
                state.snapshot.latestResult = null;
              } else if (action === "dismiss") {
                state.snapshot.latestResult = null;
                homeResultHidden = true;
              } else if (action === "edit") {
                if (!text.trim() || state.failSave) throw new Error("Could not apply this edit");
                const session =
                  state.snapshot.latestResult?.session ??
                  state.snapshot.history.find((entry) => entry.id === id);
                if (!session) throw new Error("This result is no longer available");
                session.finalTranscript = text;
                if (state.snapshot.latestResult) state.snapshot.latestResult.text = text;
              } else throw new Error("Unknown result action");
              state.history();
            },
            GetHistory: async (query: string, page: number) => {
              state.historyRequests.push({ query, page, deleted: false });
              if (state.failHistory) throw new Error("History load failed");
              const entries = state.snapshot.history.filter((entry) =>
                [entry.title ?? "", entry.rawTranscript, entry.finalTranscript].some((text) =>
                  text.toLowerCase().includes(query.toLowerCase()),
                ),
              );
              const result = {
                entries: structuredClone(entries.slice(page * 50, (page + 1) * 50)),
                total: entries.length,
                page,
                pageSize: 50,
              };
              if (state.deferHistory)
                return new Promise((resolve) => {
                  state.pendingHistory.push({
                    query,
                    page,
                    resolve: () => resolve(result),
                  });
                });
              return result;
            },
            GetSession: async (id: string) => {
              if (state.failSession) throw new Error("Dictation load failed");
              const value = structuredClone(
                state.snapshot.history.find((entry) => entry.id === id) ?? null,
              );
              if (state.deferSessions)
                return new Promise((resolve) => {
                  state.pendingSessions.push({
                    id,
                    resolve: () => resolve(value),
                  });
                });
              return value;
            },
            GetRecentlyDeleted: async (query: string, page: number) => {
              state.historyRequests.push({ query, page, deleted: true });
              if (state.failHistory) throw new Error("History load failed");
              const entries = state.recentlyDeleted.filter((entry) =>
                [entry.rawTranscript, entry.finalTranscript].some((text) =>
                  text.toLowerCase().includes(query.toLowerCase()),
                ),
              );
              return {
                entries: structuredClone(entries.slice(page * 50, (page + 1) * 50)),
                total: entries.length,
                page,
                pageSize: 50,
              };
            },
            RestoreSessions: async (ids: string[]) => {
              if (ids.length > 50) throw new Error("Select at most 50 dictations");
              if (state.failSave) throw new Error("History restoration failed");
              const restored = state.recentlyDeleted.filter((entry) => ids.includes(entry.id));
              state.snapshot.history.push(
                ...restored.map((entry) => ({ ...entry, deletedAt: undefined })),
              );
              state.recentlyDeleted = state.recentlyDeleted.filter(
                (entry) => !ids.includes(entry.id),
              );
              state.history();
            },
            PermanentlyDeleteSessions: async (ids: string[]) => {
              if (ids.length > 50) throw new Error("Select at most 50 dictations");
              if (state.failSave) throw new Error("Permanent deletion failed");
              if (state.snapshot.history.some((entry) => ids.includes(entry.id)))
                throw new Error("Only Recently Deleted dictations can be permanently deleted");
              state.recentlyDeleted = state.recentlyDeleted.filter(
                (entry) => !ids.includes(entry.id),
              );
              state.outputs = state.outputs.filter((output) => !ids.includes(output.sessionId));
              state.history();
            },
            DeleteSessions: async (ids: string[]) => {
              if (ids.length > 50) throw new Error("Select at most 50 dictations");
              if (state.failSave) throw new Error("History deletion failed");
              state.recentlyDeleted.push(
                ...state.snapshot.history
                  .filter((entry) => ids.includes(entry.id))
                  .map((entry) => ({ ...entry, deletedAt: new Date().toISOString() })),
              );
              state.snapshot.history = state.snapshot.history.filter(
                (entry) => !ids.includes(entry.id),
              );
              state.history();
            },
            GetTranscriptExportPreview: async (selection: TranscriptExportSelection) => {
              if (Reflect.get(window, "failExportPreview"))
                throw new Error("Export preview failed");
              const entries = state.snapshot.history.filter((entry) =>
                selection.allMatching
                  ? [entry.title ?? "", entry.rawTranscript, entry.finalTranscript].some((text) =>
                      text.toLowerCase().includes(selection.query.toLowerCase()),
                    )
                  : selection.sessionIds?.includes(entry.id),
              );
              const included = entries.filter(
                (entry) => !selection.excludedSessionIds?.includes(entry.id),
              );
              const outputs = state.outputs.filter((output) =>
                included.some((entry) => entry.id === output.sessionId),
              );
              return {
                sessionIds: included.map((entry) => entry.id),
                outputCount: outputs.length,
                outputs:
                  entries.length === 1
                    ? outputs.map((output) => ({
                        id: output.id,
                        name: output.prompt.name,
                        createdAt: output.createdAt,
                        chainName: output.chain?.name ?? "",
                        step: output.chain?.step ?? 0,
                        total: output.chain?.total ?? 0,
                      }))
                    : [],
              };
            },
            ExportTranscripts: async (request: TranscriptExportRequest) => {
              const requests = Reflect.get(window, "transcriptExportRequests") ?? [];
              requests.push(structuredClone(request));
              Reflect.set(window, "transcriptExportRequests", requests);
              if (state.failSave) throw new Error("Export failed");
              if (Reflect.get(window, "cancelExport")) return null;
              const entries = state.snapshot.history.filter((entry) =>
                request.sessionIds?.includes(entry.id),
              );
              const outputs = request.includeOutputs
                ? state.outputs.filter(
                    (output) =>
                      entries.some((entry) => entry.id === output.sessionId) &&
                      (!request.outputIds?.length || request.outputIds.includes(output.id)),
                  )
                : [];
              state.exportedText = request.includeTranscript
                ? entries.map((entry) => entry.finalTranscript).join("\n")
                : outputs.map((output) => output.text).join("\n");
              const transcripts = request.includeTranscript ? entries.length : 0;
              return {
                path: "C:/exports/yap-export",
                files: transcripts + outputs.length,
                transcripts,
                outputs: outputs.length,
              };
            },
            RemoveModel: async (id: string) => {
              if (state.failSave) throw new Error("Model removal failed");
              const model = state.snapshot.models.find((model) => model.id === id)!;
              if (model.path === state.snapshot.settings.modelPath)
                throw new Error("switch to another model before removing the active model");
              model.installed = false;
              model.removable = false;
              model.diskBytes = 0;
              model.path = "";
              state.history();
            },
            GetMicrophones: async () => [{ id: "usb", name: "USB microphone" }],
            GetDiagnosticChecks: async () => structuredClone(state.checks),
            StartDiagnosticTest: async () => {
              state.snapshot.diagnostic = {
                phase: "recording",
                message: "Say a short sentence",
                details: "",
                transcript: "",
                durationMs: 0,
              };
              state.status("diagnostic-recording");
              state.callbacks["dictation:level"](0.6);
            },
            StopDiagnosticTest: async () => {
              state.snapshot.diagnostic.phase = "transcribing";
              state.snapshot.diagnostic.message = "Transcribing test…";
              state.status("diagnostic-transcribing");
            },
            SetSaveHistory: async (enabled: boolean) => {
              state.snapshot.settings.saveHistory = enabled;
            },
            SaveLatestResult: async (id: string) => {
              if (state.snapshot.latestResult?.session.id !== id) throw new Error("stale result");
              state.snapshot.history.unshift(state.snapshot.latestResult.session);
              state.snapshot.latestResult = null;
            },
            DismissLatestResult: async (id: string) => {
              if (state.snapshot.latestResult?.session.id !== id) throw new Error("stale result");
              state.snapshot.latestResult = null;
            },
            SaveSettings: async (settings: Settings) => {
              if (state.failSave) throw new Error("Settings save failed");
              if (settings.setupComplete !== state.snapshot.settings.setupComplete)
                throw new Error("use setup to change its completion state");
              if (settings.shortcut === state.occupiedShortcut)
                throw new Error(
                  "shortcut could not be registered: already in use; choose another combination; your saved shortcut is unchanged",
                );
              if (settings.microphoneId !== state.snapshot.settings.microphoneId)
                state.snapshot.microphoneTested = false;
              if (settings.shortcut !== state.snapshot.settings.shortcut)
                state.snapshot.shortcutTested = false;
              state.snapshot.settings = structuredClone(settings);
              if (settings.historyRetentionDays > 0) {
                const cutoff = Date.now() - settings.historyRetentionDays * 86400000;
                state.snapshot.history = state.snapshot.history.filter(
                  (entry) => !(Date.parse(entry.createdAt) < cutoff),
                );
                state.history();
              }
            },
            RetryShortcut: async () => {},
            BeginShortcutCapture: async () => {
              if (state.failCapture) throw new Error("Could not start shortcut capture");
              if (state.captureToken)
                throw new Error("finish the current operation before recording a shortcut");
              const token = crypto.randomUUID();
              state.captureToken = token;
              if (state.deferCapture)
                return new Promise((resolve) => {
                  state.resolveCapture = () => resolve(token);
                });
              return token;
            },
            EndShortcutCapture: async (token: string) => {
              if (token !== state.captureToken) return;
              state.captureToken = "";
              state.captureEnded++;
              state.callbacks["shortcut:capture-ended"]?.(token);
              if (state.failRestore)
                throw new Error(
                  "could not restore the saved shortcut; choose another combination and save settings",
                );
            },
            SaveVocabulary: async (entries: VocabularyEntry[]) => {
              if (state.failSave) throw new Error("Vocabulary save failed");
              state.snapshot.vocabulary = structuredClone(
                entries.map((entry) => ({
                  ...entry,
                  canonical: entry.canonical.trim(),
                })),
              );
              return structuredClone(state.snapshot.vocabulary);
            },
            GetRevisions: async () => [],
            SaveTextProcessing: async (config: TextProcessing) => {
              if (state.failSave) throw new Error("Prompts save failed");
              state.snapshot.textProcessing = structuredClone(config);
              state.callbacks["setup:changed"]();
              return structuredClone(config);
            },
            ListTextModels: async (id: string, endpoint: string) => {
              state.modelListRequests.push({ id, endpoint });
              if (state.modelListError) throw new Error(state.modelListError);
              if (state.deferModelList)
                return new Promise<string[]>((resolve) => {
                  state.pendingModelLists.push({ id, endpoint, resolve });
                });
              return structuredClone(state.textModels);
            },
            GetSessionOutputs: async (sessionID: string) => {
              if (state.failOutputs) throw new Error("Outputs unavailable");
              return structuredClone(
                state.outputs.filter((output) => output.sessionId === sessionID),
              );
            },
            GenerateSessionOutput: async (id: string, sessionID: string, promptID: string) => {
              const entry = state.snapshot.history.find((entry) => entry.id === sessionID);
              const chain = state.snapshot.textProcessing.chains?.find(
                (chain) => chain.id === promptID,
              );
              if (entry && chain) {
                const completed = new Map<string, GeneratedOutput>();
                const runId = crypto.randomUUID();
                let result = "";
                for (const [index, step] of chain.steps.entries()) {
                  const prompt = state.snapshot.textProcessing.prompts.find(
                    (prompt) => prompt.id === step.promptId,
                  )!;
                  const source = completed.get(step.input.slice(5));
                  const input =
                    step.input === "original"
                      ? entry.rawTranscript
                      : step.input === "transcript"
                        ? entry.finalTranscript
                        : source!.text;
                  const pending = beginOutput(id, sessionID, prompt, input);
                  state.snapshot.status.message = `Step ${index + 1} of ${chain.steps.length} · ${prompt.name}`;
                  state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
                  result = await pending;
                  const output = state.outputs[0];
                  output.chain = {
                    runId,
                    chainId: chain.id,
                    name: chain.name,
                    stepId: step.id,
                    step: index + 1,
                    total: chain.steps.length,
                    input: step.input,
                    sourceOutputId: source?.id ?? "",
                  };
                  completed.set(step.id, output);
                  state.history();
                }
                return result;
              }
              const prompt = state.snapshot.textProcessing.prompts.find(
                (prompt) => prompt.id === promptID,
              );
              if (!entry || !prompt) throw new Error("Missing dictation or prompt");
              return beginOutput(id, sessionID, prompt, entry.finalTranscript);
            },
            RegenerateSessionOutput: async (id: string, sessionID: string, outputID: string) => {
              const output = state.outputs.find(
                (output) => output.sessionId === sessionID && output.id === outputID,
              );
              if (!output) throw new Error("Missing output");
              return beginOutput(id, sessionID, output.prompt, output.input);
            },
            DeleteSessionOutput: async (sessionID: string, outputID: string) => {
              if (state.failSave) throw new Error("Output deletion failed");
              state.outputs = state.outputs.filter(
                (output) => output.sessionId !== sessionID || output.id !== outputID,
              );
              state.history();
            },
            ProcessText: async (id: string, input: string, prompt: string) => {
              if (state.failProcessing) throw new Error("Model unavailable");
              return new Promise<string>((resolve, reject) => {
                state.processing = {
                  id,
                  input,
                  prompt,
                  resolve: (result) => {
                    state.processing = null;
                    resolve(result);
                  },
                  reject,
                };
              });
            },
            RefinePrompt: async (id: string, endpoint: string, model: string, input: string) => {
              state.refinements.push({ id, endpoint, model, input });
              if (state.failProcessing) throw new Error("Model unavailable");
              return new Promise<string>((resolve, reject) => {
                state.processing = {
                  id,
                  input,
                  prompt: "refine",
                  resolve: (result) => {
                    state.processing = null;
                    resolve(result);
                  },
                  reject,
                };
              });
            },
            CancelTextProcessing: async (id: string) => {
              state.cancelledProcessing.push(id);
              // Deliberately leave the reply pending to exercise late results.
            },
            TestTextModel: async () => {
              if (state.failProcessing) throw new Error("Model unavailable");
              return "OK";
            },
            AddVocabularyTerm: async (canonical: string, aliases: string[]) => {
              if (state.failSave) throw new Error("Vocabulary save failed");
              if (state.snapshot.status.phase === "recording")
                throw new Error("finish the current operation before changing vocabulary");
              canonical = canonical.trim();
              for (const phrase of [canonical, ...aliases]) {
                if (
                  state.snapshot.vocabulary.some((entry) =>
                    [entry.canonical, ...entry.aliases].some(
                      (value) => value.toLowerCase() === phrase.toLowerCase(),
                    ),
                  )
                )
                  throw new Error(`"${phrase}" is already assigned to another vocabulary term`);
              }
              state.snapshot.vocabulary.push({
                id: crypto.randomUUID(),
                canonical,
                aliases,
                enabled: true,
              });
              state.callbacks["setup:changed"]();
              return structuredClone(state.snapshot.vocabulary);
            },
            StartMicrophoneTest: async () => {
              state.snapshot.microphoneTested = false;
              state.status("mic-test");
              state.callbacks["dictation:level"](0.6);
            },
            StopMicrophoneTest: async () => {
              state.snapshot.microphoneTested = true;
              state.status("idle");
            },
            Cancel: async () => {
              if (state.snapshot.status.phase.startsWith("diagnostic-"))
                state.snapshot.diagnostic = {
                  phase: "cancelled",
                  message: "Test cancelled",
                  details: "",
                  transcript: "",
                  durationMs: 0,
                };
              state.snapshot.microphoneTested = false;
              state.status("idle");
            },
            CompleteSetup: async () => {
              state.snapshot.settings.setupComplete = true;
            },
            RestartSetup: async () => {
              state.snapshot.settings.setupComplete = false;
              state.snapshot.microphoneTested = false;
              state.snapshot.shortcutTested = false;
            },
            InstallModel: async (id: string) => {
              state.installedModelIDs.push(id);
              state.status("downloading");
              state.snapshot.settings.modelPath = `/${id}`;
              state.snapshot.settings.whisperPath = "/whisper";
              const model = state.snapshot.models.find((item) => item.id === id);
              if (model) {
                model.installed = true;
                model.path = `/${id}`;
              }
            },
            SaveTranscript: async (id: string, text: string) => {
              if (state.failSave) throw new Error("Transcript save failed");
              const entry = state.snapshot.history.find((item) => item.id === id);
              if (!entry) throw new Error("This dictation no longer exists");
              entry.finalTranscript = text;
              state.history();
            },
            CopyText: async (text: string) => {
              if (state.failClipboard) throw new Error("Clipboard unavailable");
              state.clipboard = text;
              state.snapshot.status.transcript = text;
            },
            GetProfileApplications: async () => [
              { id: "windows:outlook.exe", name: "Outlook" },
              { id: "windows:slack.exe", name: "Slack" },
            ],
            SaveProfileAutomation: async (rules: AppProfileRule[], shortcut: string) => {
              if (state.failSave) throw new Error("Could not save profile automation");
              if (shortcut === state.snapshot.settings.shortcut)
                throw new Error("recording and profile cycling must use different shortcuts");
              state.snapshot.appProfileRules = structuredClone(rules);
              state.snapshot.profileShortcut = shortcut;
              state.history();
            },
            SaveDictationProfile: async (profile: DictationProfile) => {
              if (state.failSave) throw new Error("Could not save profile");
              const saved = {
                ...profile,
                id: profile.id || crypto.randomUUID(),
                name: profile.name.trim(),
              };
              const profiles = state.snapshot.dictationProfiles ?? [];
              if (
                profiles.some(
                  (p) => p.id !== saved.id && p.name.toLowerCase() === saved.name.toLowerCase(),
                )
              )
                throw new Error("Profile name already exists");
              state.snapshot.dictationProfiles = [
                ...profiles.filter((p) => p.id !== saved.id),
                saved,
              ];
              state.history();
              return saved;
            },
            ApplyDictationProfile: async (id: string) => {
              if (state.failSave) throw new Error("Profile model unavailable");
              const profile = state.snapshot.dictationProfiles?.find((p) => p.id === id);
              if (!profile) throw new Error("Profile no longer exists");
              if (profile.autoPromptId && !state.snapshot.textProcessing.enabled)
                throw new Error("Enable your local text model in Prompts");
              Object.assign(state.snapshot.settings, {
                modelPath: profile.modelPath,
                language: profile.language,
                cleanText: profile.cleanText,
              });
              state.snapshot.textProcessing.autoPromptId = profile.autoPromptId;
              state.snapshot.activeProfileId = profile.id;
              state.history();
            },
            DeleteDictationProfile: async (id: string) => {
              if (state.failSave) throw new Error("Could not delete profile");
              state.snapshot.dictationProfiles = state.snapshot.dictationProfiles?.filter(
                (p) => p.id !== id,
              );
              if (state.snapshot.activeProfileId === id)
                state.snapshot.activeProfileId = state.snapshot.defaultProfileId;
              state.history();
            },
            StartRecording: async () => {
              state.status("recording");
            },
          },
        },
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installDictationFixture(page);
});

// Wait for React to commit after releasing a deliberately delayed bridge reply.
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

test("startup options save automatically and survive refreshes and failed saves", async ({
  page,
}) => {
  await page.goto("/#/settings?section=general");
  const login = page.getByRole("switch", {
    name: "Launch at login",
    exact: true,
  });
  const background = page.getByRole("switch", {
    name: /Start in tray \/ menu bar/,
  });
  await expect(login).toBeEnabled();
  await expect(login).not.toBeChecked();
  await expect(background).not.toBeChecked();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await login.check();
  await background.check();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await page.evaluate(() => window.dictationTest.history());
  await settle(page);
  await expect(login).toBeChecked();
  await expect(background).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.launchAtLogin))
    .toBe(false);
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.dictationTest.snapshot.settings.startInTray &&
          window.dictationTest.snapshot.settings.launchAtLogin,
      ),
    )
    .toBe(true);
  await login.uncheck();
  await background.uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.dictationTest.snapshot.settings.startInTray ||
          window.dictationTest.snapshot.settings.launchAtLogin,
      ),
    )
    .toBe(false);
});

test("unsupported startup controls are disabled and registration errors are visible", async ({
  page,
}) => {
  await page.goto("/#/settings?section=general");
  const login = page.getByRole("switch", {
    name: "Launch at login",
    exact: true,
  });
  await expect(login).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.snapshot.launchAtLoginAvailable = false;
    window.dictationTest.snapshot.startInTrayAvailable = false;
    window.dictationTest.snapshot.status.startupError =
      "Launch at login unavailable: access denied";
    window.dictationTest.history();
  });
  await expect(login).toBeDisabled();
  await expect(page.getByRole("switch", { name: /Start in tray \/ menu bar/ })).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Launch at login unavailable: access denied" }),
  ).toBeVisible();
});

test("history refresh preserves an uncommitted field and autosave saves it", async ({ page }) => {
  await page.goto("/#/settings");
  const shortcut = page.getByLabel("Global shortcut", { exact: true });
  await expect(shortcut).toHaveValue("Ctrl+Alt+Space");
  await shortcut.fill("Ctrl+Alt+P");
  await page.evaluate(() => window.dictationTest.history());
  await settle(page);
  await expect(shortcut).toHaveValue("Ctrl+Alt+P");
  await page.getByRole("combobox", { name: "Microphone" }).click();
  await page.getByRole("option", { name: "USB microphone", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Microphone" })).toContainText("USB microphone");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+P");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.microphoneId))
    .toBe("usb");
  await expect(shortcut).toHaveValue("Ctrl+Alt+P");
});

test("pristine settings follow backend changes while failed saves retain edits", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const shortcut = page.getByLabel("Global shortcut", { exact: true });
  await expect(shortcut).toHaveValue("Ctrl+Alt+Space");
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.shortcut = "Ctrl+Alt+Q";
    window.dictationTest.history();
  });
  await expect(shortcut).toHaveValue("Ctrl+Alt+Q");
  await shortcut.fill("Ctrl+Alt+P");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await shortcut.press("Enter");
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.language = "en";
    window.dictationTest.history();
  });
  await settle(page);
  await expect(shortcut).toHaveValue("Ctrl+Alt+P");
  await expect(page.getByText("Changes not saved", { exact: true })).toBeVisible();
});

test("history replies preserve newer recording events and still update history", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.history = [
      {
        id: "new",
        createdAt: new Date().toISOString(),
        durationMs: 1000,
        rawTranscript: "Fresh history entry",
        finalTranscript: "Fresh history entry",
        speechModel: "tiny",
        language: "en",
        audioPath: "",
      },
    ];
    state.deferSnapshots = true;
    state.history();
    state.status("recording");
  });
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
  await page.evaluate(() => window.dictationTest.pendingSnapshots[0]());
  // The palette's unfiltered recent entries read the provider snapshot directly.
  // A separate History fetch would not prove this deferred reply was accepted.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("option").filter({ hasText: "Fresh history entry" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
});

test("out-of-order replies cannot replace the newest snapshot", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.deferSnapshots = true;
    state.history();
    state.snapshot.status = {
      ...state.snapshot.status,
      phase: "recording",
      startedAt: Date.now(),
    } as Status;
    state.history();
    state.pendingSnapshots[1]();
  });
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
  await page.evaluate(() => window.dictationTest.pendingSnapshots[0]());
  await settle(page);
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled();
});

test("action refresh replies preserve status events received while awaiting them", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.deferSnapshots = true;
  });
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.pendingSnapshots.length))
    .toBe(1);
  await page.evaluate(() => {
    window.dictationTest.status("transcribing");
    window.dictationTest.pendingSnapshots[0]();
  });
  await settle(page);
  await expect(page.getByRole("heading", { name: "Transcribing…", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Transcribing…", exact: true })).toBeDisabled();
});

test("Vocabulary matches the Models heading and keeps editing actions visible in narrow windows", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    window.dictationTest.snapshot.vocabulary = [
      {
        id: "postgres",
        canonical: "PostgreSQL",
        aliases: ["postgres", "post gre SQL"],
        enabled: true,
      },
      { id: "benji", canonical: "Benji", aliases: ["ben gee"], enabled: true },
      { id: "yap", canonical: "Yap", aliases: [], enabled: false },
    ];
  });
  await page.setViewportSize({ width: 1347, height: 900 });
  await page.goto("/#/models");
  const headingStyle = (element: HTMLElement | SVGElement) => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, weight: style.fontWeight, spacing: style.letterSpacing };
  };
  const modelHeading = await page
    .getByRole("heading", { name: "Models", exact: true })
    .evaluate(headingStyle);
  await navigateMain(page, "Vocabulary");
  expect(
    await page.getByRole("heading", { name: "Vocabulary", exact: true }).evaluate(headingStyle),
  ).toEqual(modelHeading);
  await expect(page.getByText("3 / 100", { exact: true })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Enabled", exact: true })).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "Preferred spelling", exact: true }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Aliases", exact: true })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await page.mouse.move(0, 0);
  const removeHint = table.getByRole("button", { name: "Remove PostgreSQL", exact: true });
  await expect(removeHint).toHaveCSS("opacity", "1");
  await expect(removeHint.locator("svg")).toBeVisible();
  await expect(removeHint.getByText("Remove", { exact: true })).toBeVisible();
  await removeHint.focus();
  await expect(removeHint.getByText("Remove", { exact: true })).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: testInfo.outputPath("vocabulary-desktop.png"),
    animations: "disabled",
  });
  await page.getByLabel("Preferred spelling", { exact: true }).first().fill("Postgres");
  const save = page.getByRole("status").filter({ hasText: "Changes save automatically" });
  for (const width of [600, 360]) {
    await page.setViewportSize({ width, height: 700 });
    const preferred = page.getByLabel("Preferred spelling", { exact: true }).first();
    const aliases = page.getByLabel("Aliases (comma-separated)", { exact: true }).first();
    const preferredBounds = (await preferred.boundingBox())!;
    const aliasBounds = (await aliases.boundingBox())!;
    expect(aliasBounds.y).toBeGreaterThan(preferredBounds.y + preferredBounds.height);
    expect(aliasBounds.width).toBeGreaterThan(180);
    expect(Math.abs(aliasBounds.width - preferredBounds.width)).toBeLessThan(1);
    await page.getByRole("button", { name: "Remove Yap", exact: true }).scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await expect(
      page
        .getByRole("status", { name: "" })
        .filter({ hasText: /Saving|Changes save automatically/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`vocabulary-${width}.png`),
      animations: "disabled",
    });
  }
  await saveDraft(page);
  await expect(page.getByLabel("Preferred spelling", { exact: true }).first()).toHaveValue(
    "Postgres",
  );
  await expect(save).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.snapshot.vocabulary = [];
    window.dictationTest.history();
  });
  await expect(
    page.getByRole("heading", { name: "A vocabulary that sounds like you" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("0 / 100", { exact: true })).toBeVisible();
});

test("vocabulary drafts survive refresh and failed saves, normalize and persist", async ({
  page,
}) => {
  await page.goto("/#/vocabulary");
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await table.getByLabel("Preferred spelling", { exact: true }).fill(" PostgreSQL ");
  await table.getByLabel("Aliases (comma-separated)").fill("postgres, post gre SQL");
  await page.evaluate(() => {
    window.dictationTest.history();
    window.dictationTest.failSave = true;
  });
  await settle(page);
  await saveDraft(page);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Vocabulary save failed" }),
  ).toBeVisible();
  await expect(table.getByLabel("Preferred spelling", { exact: true })).toHaveValue(" PostgreSQL ");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await saveDraft(page);
  await expect(table.getByLabel("Preferred spelling", { exact: true })).toHaveValue(" PostgreSQL ");
  await expect(
    page.getByRole("status").filter({ hasText: "Changes save automatically" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].aliases.join("|")))
    .toBe("postgres|post gre SQL");
  await table.getByRole("checkbox", { name: "Enabled", exact: true }).uncheck();
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].enabled))
    .toBe(false);
  await page.getByRole("button", { name: "Remove  PostgreSQL " }).click();
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length))
    .toBe(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("vocabulary table paginates when there are more than ten terms", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.vocabulary = Array.from({ length: 11 }, (_, index) => ({
      id: `term-${index}`,
      canonical: `Term ${index + 1}`,
      aliases: [],
      enabled: true,
    }));
  });
  await page.goto("/#/vocabulary");
  await expect(page.getByText("11 / 100", { exact: true })).toBeVisible();
  const pages = page.getByRole("navigation", { name: "Vocabulary pages" });
  await expect(pages).toBeVisible();
  await expect(pages.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveCount(10);
  await expect(page.getByLabel("Preferred spelling", { exact: true }).first()).toHaveValue(
    "Term 1",
  );
  await pages.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pages.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveValue("Term 11");
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  await expect(page.getByText("12 / 100", { exact: true })).toBeVisible();
  await expect(pages.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Preferred spelling", { exact: true }).last()).toHaveValue("");
});

test("automatic clipboard copying defaults on and persists with manual copying available", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "clipboard-setting",
        createdAt: new Date().toISOString(),
        durationMs: 2000,
        rawTranscript: "A private thought.",
        finalTranscript: "A private thought.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/settings");
  const copy = page.getByRole("switch", { name: /Copy automatically to clipboard/ });
  const paste = page.getByRole("switch", { name: /Paste automatically/ });
  await expect(copy).toBeChecked();
  await expect(paste).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await copy.uncheck();
  await expect(paste).toBeDisabled();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await expect(copy).not.toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoCopy))
    .toBe(true);
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(copy).toBeChecked();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await copy.uncheck();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoCopy))
    .toBe(false);
  await page.goto("/#/history");
  await page.getByRole("link", { name: /A private thought/ }).click();
  await page.getByRole("button", { name: "Copy transcription", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("A private thought.");
  await page.goto("/#/settings");
  await expect(copy).not.toBeChecked();
  await copy.check();
  await expect(paste).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoCopy))
    .toBe(true);
});

test("light cleanup defaults off and saves automatically", async ({ page }) => {
  await page.goto("/#/settings");
  const cleanup = page.getByRole("switch", { name: /Light cleanup/ });
  await expect(cleanup).not.toBeChecked();
  await cleanup.check();
  await page.evaluate(() => window.dictationTest.history());
  await settle(page);
  await expect(cleanup).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText))
    .toBe(true);
});

for (const theme of ["dark", "light"] as const) {
  test(`onboarding ${theme} guides each step and fits narrow screens`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("desktop-theme", theme);
      localStorage.setItem("yap-sidebar-collapsed", "true");
      const s = window.dictationTest.snapshot;
      s.settings.setupComplete = false;
      s.settings.modelPath = "";
      s.ready = false;
      s.models = [
        {
          id: "tiny",
          name: "Whisper Tiny",
          description: "Fastest · short dictation",
          size: 77691713,
          installed: false,
          path: "/tiny",
          diskBytes: 0,
          removable: false,
        },
        {
          id: "base",
          name: "Whisper Base",
          description: "Lightweight · everyday dictation",
          size: 147951465,
          installed: false,
          path: "/base",
          diskBytes: 0,
          removable: false,
        },
        {
          id: "small",
          name: "Whisper Small",
          description: "Balanced · better accuracy",
          size: 487601967,
          installed: false,
          path: "/small",
          diskBytes: 0,
          removable: false,
        },
      ];
    }, theme);
    await page.setViewportSize({ width: 1347, height: 900 });
    await page.goto("/");
    const next = page.getByRole("button", { name: "Next", exact: true });
    const steps = page.getByRole("list", { name: "Setup steps" });
    await expect(steps.locator('[aria-current="step"]')).toContainText("Speech model");
    await expect(next).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("onboarding-model.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 360, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.evaluate(() => {
      const s = window.dictationTest.snapshot;
      s.models[1].installed = true;
      s.models[1].diskBytes = s.models[1].size;
      s.settings.modelPath = "/base";
      s.ready = true;
      window.dictationTest.history();
    });
    await next.click();
    await expect(page.getByRole("heading", { name: "Let’s hear you" })).toBeFocused();
    await expect(next).toBeDisabled();
    await page.getByRole("button", { name: "Test microphone", exact: true }).click();
    await expect(page.getByRole("meter", { name: "Microphone level" })).toHaveAttribute(
      "value",
      "0.6",
    );
    await expect(page.getByText("Listening…", { exact: true })).toBeVisible();
    await expect(next).toBeDisabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("onboarding-microphone-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1347, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("onboarding-microphone.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Stop test", exact: true }).click();
    await expect(page.getByText("Last microphone test passed", { exact: true })).toBeVisible();
    await next.click();
    await expect(steps.locator('[aria-current="step"]')).toContainText("Shortcut");
    const finish = page.getByRole("button", { name: "Finish setup", exact: true });
    await expect(finish).toBeDisabled();
    await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Shift+J");
    await expect(page.getByLabel("Saved shortcut: Ctrl+Alt+Space", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Apply shortcut", exact: true }).click();
    await expect(page.getByLabel("Saved shortcut: Ctrl+Shift+J", { exact: true })).toBeVisible();
    await expect(finish).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("onboarding-shortcut.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 360, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await finish.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("onboarding-shortcut-narrow.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.evaluate(() => {
      window.dictationTest.snapshot.shortcutTested = true;
      window.dictationTest.callbacks["setup:changed"]();
    });
    await expect(page.getByText("Shortcut test passed", { exact: true })).toBeVisible();
    await finish.click();
    await expect(
      page.getByRole("region", { name: "Dictation recorder", exact: true }),
    ).toBeVisible();
  });
}

test("setup footer stays at the viewport bottom while scrolling and resizing", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    window.dictationTest.snapshot.settings.setupComplete = false;
  });
  await page.setViewportSize({ width: 1347, height: 900 });
  await page.goto("/");
  const footer = page.locator("footer");
  async function expectFooterAtBottom() {
    await expect
      .poll(async () => {
        const bounds = await footer.boundingBox();
        return bounds ? Math.abs(bounds.y + bounds.height - page.viewportSize()!.height) : Infinity;
      })
      .toBeLessThan(2);
  }
  await expectFooterAtBottom();
  await expect(page.locator('[data-slot="toast"]')).toBeVisible();
  await expect
    .poll(async () => {
      const toastBounds = await page.locator('[data-slot="toast"]').boundingBox();
      const footerBounds = await footer.boundingBox();
      return toastBounds && footerBounds
        ? toastBounds.y + toastBounds.height - footerBounds.y
        : Infinity;
    })
    .toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expectFooterAtBottom();
  for (const width of [1347, 480, 360]) {
    await page.setViewportSize({ width, height: 600 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectFooterAtBottom();
    await expect(footer.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectFooterAtBottom();
    const testButton = page.getByRole("button", { name: "Test microphone", exact: true });
    await testButton.scrollIntoViewIfNeeded();
    const buttonBounds = (await testButton.boundingBox())!;
    const footerBounds = (await footer.boundingBox())!;
    expect(buttonBounds.y + buttonBounds.height).toBeLessThanOrEqual(footerBounds.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`setup-sticky-footer-${width}.png`),
      animations: "disabled",
    });
  }
});

test("speech model readiness uses one success toast across refreshes and setup steps", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const s = window.dictationTest.snapshot;
    s.settings.setupComplete = false;
    s.settings.modelPath = "/base";
    s.models = [
      {
        id: "base",
        name: "Whisper Base",
        description: "Everyday dictation",
        size: 147000000,
        installed: true,
        path: "/base",
        diskBytes: 147000000,
        removable: true,
      },
    ];
  });
  await page.goto("/");
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Speech model ready" });
  await expect(toast).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("Speech model ready", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => window.dictationTest.history());
  await expect(toast).toHaveCount(1);
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => window.dictationTest.history());
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(toast).toHaveCount(0);
  await simulateModelDownload(page);
  await modelAction(page, "Check & repair runtime");
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.ready = false;
    state.history();
  });
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.ready = true;
    state.snapshot.status.phase = "idle";
    state.snapshot.status.message = "Model installed. Ready to dictate.";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    state.history();
  });
  await expect(toast).toBeVisible();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
});

test("microphone errors use a dismissible toast without adding a page banner", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    const state = window.dictationTest;
    state.snapshot.settings.setupComplete = false;
    Reflect.get(window, "mockBackend").main.App.StopMicrophoneTest = async () => {
      const error =
        "no microphone signal detected; check microphone access and choose another input";
      state.snapshot.microphoneTested = false;
      state.snapshot.status.phase = "idle";
      state.snapshot.status.message = error;
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
      state.history();
      throw new Error(error);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const error = "no microphone signal detected; check microphone access and choose another input";
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: error });
  async function failTest() {
    await page.getByRole("button", { name: "Test microphone", exact: true }).click();
    await page.getByRole("button", { name: "Stop test", exact: true }).click();
  }
  await failTest();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(1);
  await expect(page.locator("#main-content").getByText(error, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dictationTest.history());
  await expect(toast).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("microphone-error-toast.png"),
    animations: "disabled",
  });
  await page.keyboard.press("F6");
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(toast).toHaveCount(0);
  await failTest();
  await expect(toast).toBeVisible();
  await navigateMain(page, "Models");
  await expect(toast).toBeVisible();
  // Keep the timeout and Motion's exit animation on the same browser clock.
  await expect(toast).toHaveCount(0, { timeout: 10000 });
});

test("first run guides installation, mic testing and shortcut verification", async ({ page }) => {
  await page.addInitScript(() => {
    const s = window.dictationTest.snapshot;
    s.settings.setupComplete = false;
    s.settings.modelPath = "";
    s.ready = false;
    s.models = [
      {
        id: "base",
        name: "Whisper Base",
        description: "Everyday dictation",
        size: 147000000,
        path: "/base",
        installed: false,
        diskBytes: 0,
        removable: false,
      },
    ];
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Yap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Download & use" }).click();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.snapshot.ready = true;
    window.dictationTest.snapshot.models[0].installed = true;
    window.dictationTest.status("idle");
    window.dictationTest.history();
  });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Microphone", exact: true }).click();
  await page.getByRole("option", { name: "USB microphone", exact: true }).click();
  await page.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(page.getByRole("meter", { name: "Microphone level" })).toHaveAttribute(
    "value",
    "0.6",
  );
  await expect(page.getByRole("button", { name: "Skip setup" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop test", exact: true }).click();
  await expect(page.getByText("Last microphone test passed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("button", { name: "Finish setup" })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.snapshot.shortcutTested = true;
    window.dictationTest.callbacks["setup:changed"]();
  });
  await expect(page.getByText("Shortcut test passed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("region", { name: "Dictation recorder", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(0);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await showCustomModelFiles(page);
  await page.getByRole("button", { name: "Run setup" }).click();
  await expect(page.getByRole("heading", { name: "Set up Yap" })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.getByRole("region", { name: "Dictation recorder", exact: true })).toBeVisible();
});

test("history uses processed text for copy and exposes searchable originals", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "clean",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "um, send postgres",
        finalTranscript: "Send PostgreSQL.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByLabel("Search transcripts").fill("um,");
  await page.getByRole("link", { name: /Send PostgreSQL/ }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Send PostgreSQL.",
  );
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Original transcription", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("um, send postgres", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy original", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("um, send postgres");
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Send PostgreSQL.");
});

test("History opens a dictation page with content tabs that fit narrow windows", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    window.dictationTest.snapshot.history = [
      {
        id: "summary",
        createdAt: "2026-10-08T11:17:07",
        durationMs: 18000,
        rawTranscript:
          "um yesterday the Paris based AI lab released a new model. We should test it with our dictation workflow and compare the results with our current model.",
        finalTranscript:
          "A Paris-based AI lab released a new model. Test it with the dictation workflow and compare it with the current model.",
        speechModel: "ggml-small.bin",
        language: "en",
        audioPath: "",
      },
      {
        id: "plain",
        createdAt: "2026-10-08T10:00:00",
        durationMs: 5000,
        rawTranscript: "An unchanged transcription.",
        finalTranscript: "An unchanged transcription.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
      {
        id: "notes",
        createdAt: "2026-10-07T19:40:00",
        durationMs: 34000,
        rawTranscript:
          "Hey everyone, my name is Danny. I wanted to say how thankful I am for all the comments and people responding to the video. The next update is nearly ready, and I have a few things to share.",
        finalTranscript:
          "Hey everyone, my name is Danny. I wanted to say how thankful I am for all the comments and people responding to the video. The next update is nearly ready, and I have a few things to share.",
        speechModel: "ggml-small.bin",
        language: "en",
        audioPath: "",
      },
      {
        id: "meeting",
        createdAt: "2026-10-07T16:15:00",
        durationMs: 51000,
        rawTranscript:
          "um we should test the new model tomorrow and check how it handles names and brands",
        finalTranscript: "Test the new model tomorrow and check how it handles names and brands.",
        speechModel: "ggml-base.en.bin",
        language: "en",
        audioPath: "",
      },
      {
        id: "reminder",
        createdAt: "2026-10-06T09:30:00",
        durationMs: 12000,
        rawTranscript:
          "Pick up the conversation with Alex about the desktop app and send the updated design before our next meeting.",
        finalTranscript:
          "Pick up the conversation with Alex about the desktop app and send the updated design before our next meeting.",
        speechModel: "custom-model.bin",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "History", exact: true })
    .click();
  const recent = page.locator("#main-content");
  await expect(recent.getByRole("article")).toHaveCount(5);
  await expect(recent.getByRole("article").first()).toContainText("A Paris-based AI lab");
  await expect(recent.getByRole("article").first()).toContainText("Whisper Small");
  await expect(recent.getByRole("article").nth(1)).toContainText("An unchanged transcription.");
  await expect(recent.getByRole("checkbox")).toHaveCount(6);
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await recent.screenshot({
      path: testInfo.outputPath(`history-retrieval-${width}.png`),
      animations: "disabled",
    });
  }
  await recent.getByRole("link", { name: /A Paris-based AI lab/ }).click();
  await expect(page).toHaveURL(/#\/history\/summary$/);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "History", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/history$/);
  await page.setViewportSize({ width: 1280, height: 900 });
  const cards = page.getByRole("article");
  await expect(cards.first()).toContainText("A Paris-based AI lab");
  await expect(cards.nth(1)).toContainText("An unchanged transcription.");
  await page.screenshot({
    path: testInfo.outputPath("history-list-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  const firstCheckbox = page.getByRole("checkbox", {
    name: "Select dictation 1",
    exact: true,
  });
  const pageCheckbox = page.getByRole("checkbox", {
    name: "Select loaded",
    exact: true,
  });
  await firstCheckbox.focus();
  await firstCheckbox.press("Space");
  await expect(cards.first()).toHaveAttribute("data-selected", "true");
  await expect(pageCheckbox).toHaveAttribute("aria-checked", "mixed");
  await page.screenshot({
    path: testInfo.outputPath("history-list-selected.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByText("Select loaded", { exact: true }).click();
  await expect(pageCheckbox).toBeChecked();
  await expect(page.locator("article[data-selected=true]")).toHaveCount(5);
  await pageCheckbox.focus();
  await pageCheckbox.press("Space");
  await expect(pageCheckbox).not.toBeChecked();
  await expect(page.locator("article[data-selected=true]")).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("history-list-narrow.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: /A Paris-based AI lab/ }).click();
  await expect(page).toHaveURL(/#\/history\/summary$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /^A Paris-based AI lab/ }),
  ).toBeFocused();
  const result = page.getByRole("region", { name: "Result", exact: true });
  const original = page.getByRole("region", {
    name: "Original transcription",
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect(original).not.toBeVisible();
  const contents = page.getByRole("tablist", { name: "Dictation contents" });
  for (const width of [1280, 600, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["Transcription", "Original", "Outputs"]) {
      await contents.getByRole("tab", { name, exact: true }).click();
      await expect(contents.getByRole("tab", { name, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`dictation-${name.toLowerCase()}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await expect(page.getByText("No generated outputs yet.", { exact: true })).toBeVisible();
  }
  await contents.getByRole("tab", { name: "Original", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(contents.getByRole("tab", { name: "Outputs", exact: true })).toBeFocused();
  await expect(contents.getByRole("tab", { name: "Outputs", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await contents.getByRole("tab", { name: "Transcription", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const dialog = page.getByRole("region", {
    name: "Edit transcript",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Compare with original" }).click();
  await expect(
    dialog.getByRole("region", { name: "Original transcription", exact: true }),
  ).toContainText("um yesterday");
  await dialog.getByRole("textbox", { name: "Editable text", exact: true }).focus();
  await expect(dialog.getByRole("textbox", { name: "Editable text", exact: true })).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("editor-comparison.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await page.getByRole("link", { name: /An unchanged transcription/ }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Original transcription", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Transcription", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy transcription", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("An unchanged transcription.");
});

test("transcription and editor Changes compare the correct versions and remain usable on narrow screens", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    window.dictationTest.snapshot.history = [
      {
        id: "compare",
        createdAt: "2026-10-07T12:30:00",
        durationMs: 12000,
        rawTranscript: "Send postgres tomorrow.\n\nConfirm the meeting with the team.",
        finalTranscript: "Send PostgreSQL today.\n\nConfirm the meeting with the team.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history/compare");
  const contents = page.getByRole("tablist", { name: "Dictation contents" });
  await contents.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(contents.getByRole("tab", { name: "Changes", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const changes = page.getByRole("region", { name: "Changes", exact: true });
  await expect(changes.locator("del").first()).toContainText("postgres");
  await expect(changes.locator("ins").first()).toContainText("PostgreSQL");
  await expect(changes).toContainText("Original recording → Current transcription");
  await settle(page);
  await page.screenshot({
    path: testInfo.outputPath("detail-changes-desktop.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Edit transcript", exact: true });
  const input = dialog.getByRole("textbox", { name: "Editable text" });
  await dialog.getByRole("button", { name: "Compare with original" }).click();
  const reference = dialog.getByRole("tablist", { name: "Editor reference" });
  await expect(reference.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0);
  await input.fill("Send PostgreSQL on Friday.\n\nConfirm the meeting with the team.");
  await reference.getByRole("tab", { name: "Changes", exact: true }).click();
  const draft = dialog.getByRole("region", { name: "Draft changes", exact: true });
  await expect(draft.locator("del")).toContainText(["today"]);
  await expect(draft.locator("ins")).toContainText(["on Friday"]);
  await expect(draft).toContainText("Saved text → Your draft");
  await input.fill("Send PostgreSQL today.\n\nConfirm the meeting with the team.");
  await expect(reference.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(reference.getByRole("tab", { name: "Original", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByRole("region", { name: "Original transcription" })).toBeVisible();
  await input.fill("Send PostgreSQL on Friday.\n\nConfirm the meeting with the team.");
  await reference.getByRole("tab", { name: "Changes", exact: true }).click();
  for (const width of [1280, 600, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(input).toBeVisible();
    const save = dialog.getByRole("button", { name: "Done", exact: true });
    await expect(save).toBeInViewport();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await settle(page);
    await page.screenshot({
      path: testInfo.outputPath(`editor-changes-${width}.png`),
      animations: "disabled",
    });
  }
  await reference.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(input).toHaveValue(
    "Send PostgreSQL on Friday.\n\nConfirm the meeting with the team.",
  );
  await expect(dialog.getByRole("region", { name: "Original transcription" })).toContainText(
    "postgres tomorrow",
  );
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(changes.locator("ins").last()).toContainText("on Friday");
  await contents.getByRole("tab", { name: "Transcription", exact: true }).click();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Send PostgreSQL on Friday.\n\nConfirm the meeting with the team.");
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await input.fill("Send postgres tomorrow.\n\nConfirm the meeting with the team.");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(contents.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Transcription", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await input.fill("New saved transcription.");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await contents.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.history[0].finalTranscript = state.snapshot.history[0].rawTranscript;
    state.history();
  });
  await expect(contents.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(contents.getByRole("tab", { name: "Transcription", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("region", { name: "Transcription", exact: true })).toBeVisible();
});

test("dictation pages preserve the History search and loaded batches when returning and deleting", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 52 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: "2026-10-07",
      durationMs: 1000,
      rawTranscript: `Original ${i}`,
      finalTranscript: `Dictation ${i}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history?q=Original&page=1");
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(52);
  await page.getByRole("link", { name: /Dictation 50\b/ }).click();
  await expect(page).toHaveURL(/#\/history\/row-50\?q=Original&page=1$/);
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Dictation 50",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "History", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/history\/row-50\?q=Original&page=1$/);
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await expect(page.getByLabel("Search transcripts")).toHaveValue("Original");
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(52);
  await page.getByRole("link", { name: /Dictation 50\b/ }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await detailAction(page, "Delete dictation");
  await expect(activeDialog(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("History deletion failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await detailAction(page, "Delete dictation");
  await expect(page).toHaveURL(/#\/history\?q=Original&page=1$/);
  await expect(page.getByLabel("Search transcripts")).toHaveValue("Original");
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(51);
  await expect(page.getByRole("link", { name: /Dictation 51\b/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dictation 50\b/ })).toHaveCount(0);
  const toast = page.locator('[data-slot="toast"]').last();
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Dictation deleted");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(toast).toContainText("History restoration failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("link", { name: /Dictation 50\b/ })).toBeVisible();
  await expect(toast).toContainText("Dictation restored");
});

test("direct dictation pages load older entries outside the snapshot, retry errors and handle missing entries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.history = Array.from({ length: 501 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: "2026-10-07",
      durationMs: 1000,
      rawTranscript: `Original ${i}`,
      finalTranscript: `Saved ${i}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
    Reflect.set(Reflect.get(window, "mockBackend").main.App, "GetSnapshot", async () => ({
      ...structuredClone(state.snapshot),
      history: structuredClone(state.snapshot.history.slice(0, 500)),
    }));
  });
  await page.goto("/#/history/row-500");
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Saved 500",
  );
  await page.reload();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Original transcription", exact: true }),
  ).toContainText("Original 500");
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failSession = true;
    window.dictationTest.history();
  });
  await expect(page.getByRole("alert").filter({ hasText: "Dictation load failed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy result", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.failSession = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy result", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.location.hash = "/history/missing";
  });
  await expect(
    page.getByRole("heading", { name: "Dictation not found", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy result", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
});

test("dictation pages ignore a late reply from another entry", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.deferSessions = true;
    state.snapshot.history = ["one", "two"].map((id) => ({
      id,
      createdAt: "2026-10-07",
      durationMs: 1000,
      rawTranscript: `Original ${id}`,
      finalTranscript: `Result ${id}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history/one");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.pendingSessions.some((request) => request.id === "one"),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.location.hash = "/history/two";
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.pendingSessions.some((request) => request.id === "two"),
      ),
    )
    .toBe(true);
  // StrictMode may start and discard an extra request when mounting the second page.
  await page.evaluate(() => {
    window.dictationTest.pendingSessions
      .filter((request) => request.id === "two")
      .forEach((request) => request.resolve());
  });
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Result two",
  );
  await page.evaluate(() => {
    window.dictationTest.pendingSessions
      .filter((request) => request.id === "one")
      .forEach((request) => request.resolve());
  });
  await settle(page);
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Result two",
  );
  await expect(page.getByText("Result one", { exact: true })).toHaveCount(0);
});

test("dictation pages show restart guidance for an outdated backend", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "GetSession");
  });
  await page.goto("/#/history/one");
  await expect(page.getByRole("alert").filter({ hasText: "restart wails3 dev" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dictation", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to History", exact: true })).toBeVisible();
});

test("saved outputs retain their recipes, regenerate as new versions and leave edited text intact", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.snapshot.history = [
      JSON.parse(sessionStorage.getItem("output-test-entry") ?? "null") ?? {
        id: "one",
        createdAt: "2026-10-07T12:30:00",
        durationMs: 12000,
        rawTranscript:
          "um we should test the new model and compare its recognition of names and technical terms",
        finalTranscript:
          "Test the new model and compare its recognition of names and technical terms.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    state.outputs = JSON.parse(sessionStorage.getItem("output-test-versions") ?? "[]");
  });
  await page.goto("/#/history/one");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "New output", exact: true }).click();
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  await page.getByRole("option", { name: "Summary", exact: true }).click();
  await generateWith(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Test the new model and compare its recognition of names and technical terms.");
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await page.evaluate(() =>
    window.dictationTest.processing!.resolve(
      "Compare the new model's recognition of names and technical terms.",
    ),
  );
  await expect(page.getByRole("tab", { name: "Original", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  const first = page
    .getByRole("article", { name: "Summary output", exact: true })
    .filter({ hasText: "Compare the new model's recognition" });
  await expect(first).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  const savedOutput = page.getByRole("combobox", { name: /^Saved output \(/ });
  await expect(savedOutput).toHaveAttribute("title", /^Summary · /);
  await expect(savedOutput).toHaveAttribute("aria-description", /^Summary · /);
  expect(
    await savedOutput.locator("time").evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect(),
        box = node.getBoundingClientRect();
      return text.left >= box.left - 1 && text.right <= box.right + 1;
    }),
  ).toBe(true);
  await savedOutput.click();
  await expect(page.getByRole("option", { name: /^Summary · / })).toBeVisible();
  await expect
    .poll(() =>
      page.locator('[data-slot="select-content"]').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.left >= -1 &&
          rect.right <= innerWidth + 1 &&
          node.scrollWidth <= node.clientWidth + 1
        );
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(savedOutput).toBeFocused();
  const createOutput = page.getByRole("button", { name: "New output", exact: true });
  const toolbar = page.locator('[data-slot="output-toolbar"]');
  const toolbarBounds = await toolbar.boundingBox();
  const articleBounds = await page.locator("article").boundingBox();
  expect(await createOutput.innerText()).toBe("");
  const copyOutput = page.getByRole("button", { name: "Copy output", exact: true });
  const copyBounds = (await copyOutput.boundingBox())!;
  expect(copyBounds.width).toBe(copyBounds.height);
  await expect(copyOutput.locator('[aria-live="polite"]')).toHaveClass("sr-only");
  await createOutput.click();
  const composer = page.getByRole("dialog", { name: "Create an output", exact: true });
  await expect(composer).toBeVisible();
  await expect(
    composer.getByRole("combobox", { name: "Output prompt", exact: true }),
  ).toBeFocused();
  expect(await toolbar.boundingBox()).toEqual(toolbarBounds);
  expect(await page.locator("article").boundingBox()).toEqual(articleBounds);
  await composer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(composer).toBeHidden();
  await expect(createOutput).toBeFocused();
  expect(await toolbar.boundingBox()).toEqual(toolbarBounds);
  expect(await page.locator("article").boundingBox()).toEqual(articleBounds);
  await createOutput.press("Enter");
  await expect(composer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer).toBeHidden();
  await expect(createOutput).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(1);
  await first.getByText("Source & prompt", { exact: true }).click();
  await expect(first).toContainText("local-model");
  await expect(first).toContainText("Test the new model and compare its recognition");
  await page.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Compare the new model's recognition of names and technical terms.");
  await expect(copyOutput.locator("svg.lucide-check")).toBeVisible();
  expect(await copyOutput.boundingBox()).toEqual(copyBounds);
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Editable text", exact: true })
    .fill("Updated transcription for the next comparison.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.model = "new-model";
    state.snapshot.textProcessing.prompts = state.snapshot.textProcessing.prompts.filter(
      (prompt) => prompt.id !== "summary",
    );
    state.callbacks["setup:changed"]();
  });
  await outputAction(page, "Regenerate");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Test the new model and compare its recognition of names and technical terms.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
    .toBe("summary");
  await page.evaluate(() =>
    window.dictationTest.processing!.resolve(
      "Test the model with names and technical terms, then compare results.",
    ),
  );
  const second = page
    .getByRole("article", { name: "Summary output", exact: true })
    .filter({ hasText: "Test the model with names" });
  await expect(second).toBeVisible();
  await expect(second).toContainText("new-model");
  await expect(first).toHaveCount(0);
  await selectSavedOutput(page, 1);
  await expect(first).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("saved-outputs.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => {
    sessionStorage.setItem(
      "output-test-entry",
      JSON.stringify(window.dictationTest.snapshot.history[0]),
    );
    sessionStorage.setItem("output-test-versions", JSON.stringify(window.dictationTest.outputs));
  });
  await page.reload();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(second).toBeVisible();
  await selectSavedOutput(page, 1);
  await expect(first).toContainText("local-model");
  await outputAction(page, "Delete output");
  const confirmation = page.getByRole("dialog", { name: "Delete this output?", exact: true });
  await page.evaluate(() => (window.dictationTest.failSave = true));
  await confirmation.getByRole("button", { name: "Delete output", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toHaveText("Output deletion failed");
  await page.evaluate(() => (window.dictationTest.failSave = false));
  await confirmation.getByRole("button", { name: "Delete output", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(first).toHaveCount(0);
  await expect(second).toBeVisible();
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Updated transcription",
  );
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript),
  ).toContain("um we should test");
});

test("output generation handles failure and cancellation and survives navigation", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "model";
    state.snapshot.history = [
      {
        id: "one",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original speech",
        finalTranscript: "Edited speech",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    state.failProcessing = true;
  });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/#/history/one");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await generateWith(page);
  await expect(page.getByRole("alert").filter({ hasText: "Model unavailable" })).toBeVisible();
  await expect(page.getByText("No generated outputs yet.", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failProcessing = false;
  });
  await generateWith(page);
  await expect(
    page.getByRole("button", { name: "Cancel generation", exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("output-controls-generating-narrow.png") });
  const activeID = await page.evaluate(() => window.dictationTest.processing!.id);
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Edited speech",
  );
  expect(await page.evaluate(() => window.dictationTest.cancelledProcessing)).not.toContain(
    activeID,
  );
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  expect(await page.evaluate(() => window.dictationTest.processing!.id)).toBe(activeID);
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Cancelled result"));
  await expect(page.getByRole("alert").filter({ hasText: "Processing cancelled" })).toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.outputs.length)).toBe(0);
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Edited speech",
  );
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await generateWith(page);
  await page.evaluate(() => window.dictationTest.processing!.resolve("Successful retry"));
  await expect(page.getByRole("article")).toContainText("Successful retry");
  await generateWith(page);
  const requestID = await page.evaluate(() => window.dictationTest.processing!.id);
  await page.getByRole("button", { name: "Minimize activity pane", exact: true }).click();
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await expect(page).toHaveURL(/#\/history$/);
  await expect(page.getByRole("tab", { name: "Outputs", exact: true })).toHaveCount(0);
  await settle(page);
  expect(await page.evaluate(() => window.dictationTest.cancelledProcessing)).not.toContain(
    requestID,
  );
  await page.goBack();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Finished after navigation"));
  await expect(page.getByRole("article")).toContainText("Finished after navigation");
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  const regenerationID = await page.evaluate(() => window.dictationTest.processing!.id);
  await navigateMain(page, "Models");
  await expect(page).toHaveURL(/#\/models$/);
  await expect(page.getByRole("tab", { name: "Outputs", exact: true })).toHaveCount(0);
  await settle(page);
  expect(await page.evaluate(() => window.dictationTest.cancelledProcessing)).not.toContain(
    regenerationID,
  );
  await page.evaluate(() =>
    window.dictationTest.processing!.resolve("Regenerated after navigation"),
  );
  await page.goBack();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("article")).toContainText("Regenerated after navigation");
  expect(
    await page.evaluate(() => window.dictationTest.outputs.map((output) => output.text)),
  ).toEqual(["Regenerated after navigation", "Finished after navigation", "Successful retry"]);
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    "Edited speech",
  );
  expect(await page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("");
});

test("prompt chain generation continues while viewing another transcription", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.snapshot.textProcessing.chains = [
      {
        id: "background-chain",
        name: "Background chain",
        steps: [
          { id: "cleanup", promptId: "cleanup", input: "original" },
          { id: "summary", promptId: "summary", input: "step:cleanup" },
        ],
      },
    ];
    state.snapshot.history = ["First", "Second"].map((name) => ({
      id: name.toLowerCase(),
      title: `${name} transcription`,
      createdAt: "2026-11-06T12:00:00Z",
      durationMs: 1000,
      rawTranscript: `${name} recording.`,
      finalTranscript: `${name} saved transcript.`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history/first");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "New output", exact: true }).click();
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  await page.getByRole("option", { name: "Background chain", exact: true }).click();
  await generateWith(page, "Run chain");
  const requestID = await page.evaluate(() => window.dictationTest.processing!.id);
  await navigateMain(page, "History");
  await page.getByRole("link", { name: /Second transcription/ }).click();
  await expect(
    page.getByRole("heading", { name: "Second transcription", exact: true }),
  ).toBeVisible();
  await settle(page);
  expect(await page.evaluate(() => window.dictationTest.cancelledProcessing)).not.toContain(
    requestID,
  );
  await page.evaluate(() => window.dictationTest.processing!.resolve("Cleaned first recording."));
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
    .toBe("summary");
  expect(await page.evaluate(() => window.dictationTest.processing!.input)).toBe(
    "Cleaned first recording.",
  );
  await page.evaluate(() => window.dictationTest.processing!.resolve("First recording summary."));
  await expect.poll(() => page.evaluate(() => window.dictationTest.outputs.length)).toBe(2);
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByText("No generated outputs yet.", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.dictationTest.outputs.map((output) => output.sessionId)),
  ).toEqual(["first", "first"]);
  await navigateMain(page, "History");
  await page.getByRole("link", { name: /First transcription/ }).click();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("article", { name: "Summary output", exact: true })).toContainText(
    "First recording summary.",
  );
  expect(
    await page.evaluate(() =>
      window.dictationTest.snapshot.history.map((entry) => entry.finalTranscript),
    ),
  ).toEqual(["First saved transcript.", "Second saved transcript."]);
});

test("standalone output metadata omits the backend's empty chain", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.history = [
      {
        id: "one",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original speech",
        finalTranscript: "Edited speech",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    state.outputs = [
      {
        id: "summary",
        sessionId: "one",
        createdAt: "2026-10-07T12:30:00Z",
        prompt: { id: "summary", name: "Summary", instruction: "Summarize the input" },
        model: "local-model",
        endpoint: "http://127.0.0.1:1234/v1",
        input: "Edited speech",
        text: "A saved summary",
        chain: {
          runId: "",
          chainId: "",
          name: "",
          stepId: "",
          step: 0,
          total: 0,
          input: "",
          sourceOutputId: "",
        },
      },
    ];
  });
  await page.goto("/#/history/one");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  const savedOutput = page.getByRole("combobox", { name: /^Saved output \(/ });
  const output = page.getByRole("article", { name: "Summary output", exact: true });
  await expect(savedOutput).not.toContainText("0/0");
  await expect(output).toContainText("From: Saved transcript");
  await expect(output).not.toContainText("0/0");
  await savedOutput.click();
  await expect(page.getByRole("option")).not.toContainText("0/0");
  await page.keyboard.press("Escape");
  await output.getByText("Source & prompt", { exact: true }).click();
  await expect(output).not.toContainText("Earlier step");
});

test("saved outputs remain usable with the model disabled and recover after a failed load", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.history = [
      {
        id: "one",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original speech",
        finalTranscript: "Edited speech",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    state.snapshot.textProcessing.prompts = [];
    state.outputs = [
      {
        id: "output",
        sessionId: "one",
        createdAt: "2026-10-07T12:30:00Z",
        prompt: {
          id: "removed",
          name: "Saved summary",
          instruction: "Summarize the input",
        },
        model: "previous-model",
        endpoint: "http://127.0.0.1:1234/v1",
        input: "Edited speech",
        text: "A saved summary",
      },
    ];
    state.failOutputs = true;
  });
  await page.goto("/#/history/one");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Outputs unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New output", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.failOutputs = false;
  });
  await page.getByRole("button", { name: "Retry outputs", exact: true }).click();
  const output = page.getByRole("article", {
    name: "Saved summary output",
    exact: true,
  });
  await expect(output).toContainText("previous-model");
  await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("A saved summary");
  await outputAction(page, "Delete output");
  await page
    .getByRole("dialog", { name: "Delete this output?", exact: true })
    .getByRole("button", { name: "Delete output", exact: true })
    .click();
  await expect(output).toHaveCount(0);
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Edited speech",
  );
});

test("an outdated outputs backend keeps the transcription visible and provides restart guidance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "one",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original speech",
        finalTranscript: "Edited speech",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "GetSessionOutputs");
  });
  await page.goto("/#/history/one");
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Edited speech",
  );
  await expect(page.getByRole("button", { name: "Copy result", exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "restart wails3 dev" })).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(Reflect.get(window, "mockBackend").main.App, "GetSessionOutputs", async () => []);
  });
  await page.getByRole("button", { name: "Retry outputs", exact: true }).click();
  await expect(page.getByText("No generated outputs yet.", { exact: true })).toBeVisible();
});

test("microphone test remains stoppable after navigating away from setup", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.settings.setupComplete = false;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop test", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop microphone test", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Stop microphone test", exact: true }),
  ).toBeVisible();
  await navigateMain(page, "Dictate");
  await expect(
    page.getByRole("heading", { name: "Test your microphone", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop test", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Stop microphone test", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop microphone test", exact: true })).toHaveCount(
    0,
  );
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.microphoneTested))
    .toBe(true);
});

test("diagnostics show microphone activity and an isolated transcript preview", async ({
  page,
}) => {
  await page.goto("/#/settings?section=advanced");
  await showCustomModelFiles(page);
  await expect(page.getByText("Executable found", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Test dictation", exact: true }).click();
  await expect(
    page.getByRole("meter", { name: "Dictation test microphone level" }),
  ).toHaveAttribute("value", "0.6");
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Stop dictation test", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Transcribing test…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel test", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.diagnostic = {
      phase: "done",
      message: "Runtime and model verified",
      details: "",
      transcript: "A short test sentence.",
      durationMs: 2000,
    };
    state.status("idle");
    state.callbacks["setup:changed"]();
  });
  await expect(page.getByText("Runtime and model verified", { exact: true })).toBeVisible();
  await expect(page.getByText("A short test sentence.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("");
});

test("diagnostics block unsaved settings and unavailable files until refreshed", async ({
  page,
}) => {
  await page.goto("/#/settings?section=advanced");
  await showCustomModelFiles(page);
  const testDictation = page.getByRole("button", {
    name: "Test dictation",
    exact: true,
  });
  await expect(testDictation).toBeEnabled();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await showCustomModelFiles(page);
  await expect(page.getByText("Changes not saved", { exact: true })).toBeVisible();
  await expect(testDictation).toBeDisabled();
  await expect(
    page.getByText("Finish saving settings before testing the changes.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(testDictation).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.checks[1] = {
      id: "model",
      name: "Speech model",
      ready: false,
      message: "Speech model is empty; download it again in Models.",
    };
  });
  await page.getByRole("button", { name: "Refresh diagnostics" }).click();
  await expect(
    page.getByText("Speech model is empty; download it again in Models.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(testDictation).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.checks[1] = {
      id: "model",
      name: "Speech model",
      ready: true,
      message: "Model file readable",
    };
  });
  await page.getByRole("button", { name: "Refresh diagnostics" }).click();
  await expect(testDictation).toBeEnabled();
});

test("diagnostic errors include recovery guidance and expandable details", async ({ page }) => {
  await page.goto("/#/settings?section=advanced");
  await showCustomModelFiles(page);
  await page.getByRole("button", { name: "Test dictation", exact: true }).click();
  await page.getByRole("button", { name: "Stop dictation test", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.diagnostic = {
      phase: "error",
      message: "Transcription failed. Reinstall the model in Models.",
      details: "Whisper could not load model: invalid header",
      transcript: "",
      durationMs: 0,
    };
    state.status("idle");
    state.callbacks["setup:changed"]();
  });
  await expect(page.getByRole("alert").filter({ hasText: "Reinstall the model" })).toBeVisible();
  await page
    .getByRole("region", { name: "Dictation diagnostics", exact: true })
    .getByText("Technical details", { exact: true })
    .click();
  await expect(
    page.getByText("Whisper could not load model: invalid header", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Test dictation", exact: true }).click();
  await expect(
    page.getByText("Whisper could not load model: invalid header", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel test", exact: true }).click();
  await expect(page.getByText("Test cancelled", { exact: true })).toBeVisible();
});

test("test capture and transcription remain cancellable across navigation", async ({ page }) => {
  await page.goto("/#/settings?section=advanced");
  await showCustomModelFiles(page);
  await page.getByRole("button", { name: "Test dictation", exact: true }).click();
  await navigateMain(page, "Models");
  await page.getByRole("button", { name: "Stop test recording", exact: true }).click();
  await expect(page.getByText("Transcribing test…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await showCustomModelFiles(page);
  await expect(page.getByText("Test cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeEnabled();
});

declare global {
  interface Window {
    sessionTitleTest: {
      calls: { id: string; title: string }[];
      fail: boolean;
      defer: boolean;
      finish?: () => void;
      generationCalls: { id: string; sessionID: string }[];
      generationFail: boolean;
      generationDefer: boolean;
      finishGeneration?: (title: string) => void;
      cancelledGeneration: string[];
    };
  }
}

async function sessionTitleScenario(page: Page) {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.history = [
      {
        id: "title-one",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "um, original recording",
        finalTranscript: "Original saved transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "/saved/one.wav",
      },
      {
        id: "title-two",
        createdAt: "2026-10-06",
        durationMs: 2000,
        rawTranscript: "Second recording.",
        finalTranscript: "Second saved transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    window.sessionTitleTest = {
      calls: [],
      fail: false,
      defer: false,
      generationCalls: [],
      generationFail: false,
      generationDefer: false,
      cancelledGeneration: [],
    };
    const api = (window as unknown as { mockBackend: { main: { App: Record<string, unknown> } } })
      .mockBackend.main.App;
    const cancelText = api.CancelTextProcessing as (id: string) => Promise<void>;
    Object.assign(api, {
      GenerateSessionTitle: async (id: string, sessionID: string) => {
        const test = window.sessionTitleTest;
        test.generationCalls.push({ id, sessionID });
        if (test.generationFail) throw new Error("Title model unavailable");
        if (test.generationDefer) {
          state.status("text-processing");
          try {
            return await new Promise<string>((resolve) => {
              test.finishGeneration = resolve;
            });
          } finally {
            state.status("idle");
          }
        }
        return "Generated meeting notes";
      },
      CancelTextProcessing: async (id: string) => {
        const test = window.sessionTitleTest;
        if (test.generationCalls.some((call) => call.id === id)) {
          test.cancelledGeneration.push(id);
          return;
        }
        return cancelText(id);
      },
      RenameSession: async (id: string, title: string) => {
        const test = window.sessionTitleTest;
        test.calls.push({ id, title });
        if (test.defer)
          await new Promise<void>((resolve) => {
            test.finish = resolve;
          });
        if (test.fail) throw new Error("Title save failed");
        const entry = state.snapshot.history.find((item) => item.id === id);
        if (!entry) throw new Error("This dictation no longer exists");
        entry.title = title;
        state.history();
      },
    });
  });
  await page.goto("/#/history/title-one");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Original saved transcript.");
}

test("output dialog keeps prompt and chain controls usable at narrow or enlarged sizes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "local-model";
    window.dictationTest.snapshot.textProcessing.chains = [
      {
        id: "action-items",
        name: "Action Items",
        steps: [{ id: "one", promptId: "cleanup", input: "original" }],
      },
    ];
  });
  await sessionTitleScenario(page);
  await page.setViewportSize({ width: 1086, height: 722 });
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "New output", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create an output", exact: true });
  const selector = composer.getByRole("combobox", { name: "Output prompt", exact: true });
  await selector.click();
  await page.getByRole("option", { name: "Action Items", exact: true }).click();
  const action = composer.getByRole("button", { name: "Run chain", exact: true });
  for (const state of [
    { width: 1086, height: 722, scale: "100%" },
    { width: 360, height: 760, scale: "100%" },
    { width: 480, height: 760, scale: "200%" },
  ]) {
    await page.setViewportSize({ width: state.width, height: state.height });
    await page.evaluate((scale) => {
      document.documentElement.style.fontSize = scale;
    }, state.scale);
    await action.scrollIntoViewIfNeeded();
    const field = (await selector.boundingBox())!;
    const button = (await action.boundingBox())!;
    if (button.x >= field.x + field.width - 1) {
      expect(Math.abs(field.y + field.height / 2 - button.y - button.height / 2)).toBeLessThan(1);
    } else {
      expect(button.y).toBeGreaterThanOrEqual(field.y + field.height);
    }
    expect(field.width).toBeGreaterThan(100);
    expect(await composer.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await expect(action).toBeInViewport();
    await testInfo.attach(`composer-${state.width}-${state.scale}`, {
      body: await composer.screenshot({
        path: testInfo.outputPath(`output-dialog-${state.width}-${state.scale}.png`),
      }),
      contentType: "image/png",
    });
  }
});

test("generated dictation title remains an editable draft until explicitly saved", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "local-model";
  });
  await sessionTitleScenario(page);
  await page.getByRole("button", { name: "Rename dictation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename dictation", exact: true });
  const input = dialog.getByRole("textbox", { name: "Title", exact: true });
  await input.fill("My draft");
  expect(await page.evaluate(() => window.sessionTitleTest.generationCalls)).toEqual([]);
  await page.evaluate(() => {
    window.sessionTitleTest.generationDefer = true;
  });
  const generate = dialog.getByRole("button", { name: "Generate title", exact: true });
  const field = (await input.boundingBox())!;
  const action = (await generate.boundingBox())!;
  expect(action.x).toBeGreaterThanOrEqual(field.x + field.width - 1);
  expect(Math.abs(action.y + action.height / 2 - field.y - field.height / 2)).toBeLessThanOrEqual(
    1,
  );
  await generate.click();
  await expect(input).toBeDisabled();
  const stop = dialog.getByRole("button", { name: "Cancel generation", exact: true });
  await expect(stop).toBeEnabled();
  expect(
    await stop.evaluate((node) => {
      let opacity = 1;
      for (let element: Element | null = node; element; element = element.parentElement) {
        opacity *= Number(getComputedStyle(element).opacity);
      }
      return opacity;
    }),
  ).toBe(1);
  await expect(dialog.getByRole("button", { name: "Save title", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.sessionTitleTest.generationCalls.map((call) => call.sessionID),
    ),
  ).toEqual(["title-one"]);
  await page.evaluate(() => window.sessionTitleTest.finishGeneration!("Generated meeting notes"));
  await expect(input).toHaveValue("Generated meeting notes");
  await expect(input).toBeFocused();
  await testInfo.attach("title-suggestion-desktop", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([]);
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].title)).toBeUndefined();
  await input.fill("Reviewed meeting notes");
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reviewed meeting notes");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0])).toMatchObject({
    title: "Reviewed meeting notes",
    rawTranscript: "um, original recording",
    finalTranscript: "Original saved transcript.",
    audioPath: "/saved/one.wav",
  });
});

test("title generation preserves typed names on failure or cancellation and ignores replies after close", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "local-model";
  });
  await sessionTitleScenario(page);
  const rename = page.getByRole("button", { name: "Rename dictation", exact: true });
  await rename.click();
  const dialog = page.getByRole("dialog", { name: "Rename dictation", exact: true });
  const input = dialog.getByRole("textbox", { name: "Title", exact: true });
  const generate = dialog.getByRole("button", { name: "Generate title", exact: true });
  await input.fill("Keep this draft");
  await page.evaluate(() => {
    window.sessionTitleTest.generationFail = true;
  });
  await generate.click();
  await expect(dialog.getByRole("alert")).toContainText("Title model unavailable");
  await expect(input).toHaveValue("Keep this draft");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription("Title model unavailable");
  await expect(dialog.getByRole("button", { name: "Save title", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.sessionTitleTest.generationFail = false;
    window.sessionTitleTest.generationDefer = true;
  });
  await generate.click();
  await dialog.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.evaluate(() => window.sessionTitleTest.finishGeneration!("Cancelled suggestion"));
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("Keep this draft");
  await expect(dialog.getByRole("alert")).toContainText("Processing cancelled");
  await generate.click();
  await expect(
    dialog.getByRole("button", { name: "Cancel generation", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.sessionTitleTest.cancelledGeneration.length))
    .toBe(2);
  await page.evaluate(() => window.sessionTitleTest.finishGeneration!("Too late to apply"));
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(input).toHaveValue("");
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([]);
  expect(await page.evaluate(() => window.sessionTitleTest.generationCalls)).toHaveLength(3);
});

test("title generation follows text model setup and fits enlarged German rename dialog", async ({
  page,
}, testInfo) => {
  await sessionTitleScenario(page);
  await page.getByRole("button", { name: "Rename dictation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate title", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.callbacks["setup:changed"]();
    localStorage.setItem("desktop-language", "de");
  });
  await page.reload();
  // Init fixtures reset the connection on reload; update it through the real snapshot event.
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.callbacks["setup:changed"]();
  });
  await page.setViewportSize({ width: 480, height: 760 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.getByRole("button", { name: "Diktat umbenennen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Diktat umbenennen", exact: true });
  const generate = dialog.getByRole("button", { name: "Titel generieren", exact: true });
  await expect(generate).toBeVisible();
  await generate.click();
  await expect(dialog.getByRole("textbox", { name: "Titel", exact: true })).toHaveValue(
    "Generated meeting notes",
  );
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(480);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await dialog.getByRole("button", { name: "Titel speichern", exact: true }).focus();
  await expect(
    dialog.getByRole("button", { name: "Titel speichern", exact: true }),
  ).toBeInViewport();
  await testInfo.attach("title-suggestion-german-enlarged", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });
});

test("session titles save, search and clear without changing literal transcripts or audio", async ({
  page,
}) => {
  await sessionTitleScenario(page);
  const rename = page.getByRole("button", { name: "Rename dictation", exact: true });
  await rename.click();
  const dialog = page.getByRole("dialog", { name: "Rename dictation", exact: true });
  const input = dialog.getByRole("textbox", { name: "Title", exact: true });
  await expect(input).toBeFocused();
  await input.fill("Discard this name");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rename).toBeFocused();
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([]);
  await rename.click();
  await input.fill("会議 notes 🎙️");
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("会議 notes 🎙️");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0])).toMatchObject({
    rawTranscript: "um, original recording",
    finalTranscript: "Original saved transcript.",
    audioPath: "/saved/one.wav",
    title: "会議 notes 🎙️",
  });
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await page.getByRole("textbox", { name: "Search transcripts", exact: true }).fill("会議");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("会議 notes 🎙️");
  await page.getByRole("link", { name: /会議 notes/ }).click();
  await rename.click();
  await expect(input).toHaveValue("会議 notes 🎙️");
  await input.fill("");
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Original saved transcript.");
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([
    { id: "title-one", title: "会議 notes 🎙️" },
    { id: "title-one", title: "" },
  ]);
});

test("History renames in place, preserves text and returns focus when a title search stops matching", async ({
  page,
}) => {
  await sessionTitleScenario(page);
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  const row = page.getByRole("article").filter({ hasText: "Original saved transcript." });
  const rename = row.getByRole("button", { name: /^Rename dictation:/ });
  await page.mouse.move(0, 0);
  await expect(rename).toHaveCSS("opacity", "1");
  await expect(rename.locator("svg")).toBeVisible();
  await rename.hover();
  const renameHelp = page.getByRole("tooltip", { name: "Rename dictation", exact: true });
  await expect(renameHelp).toBeVisible();
  await page.mouse.move(0, 0);
  await rename.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(rename).toBeFocused();
  await expect(renameHelp).toBeVisible();
  await expect(renameHelp).toHaveCSS("opacity", "1");
  await expect(rename).toHaveCSS("opacity", "1");
  await rename.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Rename dictation", exact: true });
  const input = dialog.getByRole("textbox", { name: "Title", exact: true });
  await input.fill("Unsubmitted title");
  await page.keyboard.press("Escape");
  await expect(rename).toBeFocused();
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([]);
  await rename.click();
  await input.fill("Searchable meeting notes");
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("Searchable meeting notes");
  await expect(rename).toBeFocused();
  expect(new URL(page.url()).hash).toBe("#/history");
  const search = page.getByRole("textbox", { name: "Search transcripts", exact: true });
  await search.fill("Searchable meeting");
  await expect(page.getByRole("article")).toHaveCount(1);
  await rename.click();
  await input.fill("");
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No matching transcripts", exact: true }),
  ).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0])).toMatchObject({
    rawTranscript: "um, original recording",
    finalTranscript: "Original saved transcript.",
    audioPath: "/saved/one.wav",
    title: "",
  });
});

test("session title editing keeps IME and failed drafts and guards pending dismissal", async ({
  page,
}) => {
  await sessionTitleScenario(page);
  await page.getByRole("button", { name: "Rename dictation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename dictation", exact: true });
  const input = dialog.getByRole("textbox", { name: "Title", exact: true });
  await input.fill("Recovery notes");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toEqual([]);
  await input.dispatchEvent("compositionend");
  await page.evaluate(() => {
    window.sessionTitleTest.fail = true;
  });
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Title save failed");
  await expect(input).toHaveValue("Recovery notes");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription("Title save failed");
  await expect(
    page.locator("#main-content").getByRole("heading", { level: 1, includeHidden: true }),
  ).toHaveText("Original saved transcript.");
  await page.evaluate(() => {
    window.sessionTitleTest.fail = false;
    window.sessionTitleTest.defer = true;
  });
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.sessionTitleTest.finish?.());
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recovery notes");
  expect(await page.evaluate(() => window.sessionTitleTest.calls)).toHaveLength(2);
});

test("a late title save cannot replace the next dictation after navigation", async ({ page }) => {
  await sessionTitleScenario(page);
  await page.evaluate(() => {
    window.sessionTitleTest.defer = true;
  });
  await page.getByRole("button", { name: "Rename dictation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rename dictation", exact: true });
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("First dictation name");
  await dialog.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    location.hash = "#/history/title-two";
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second saved transcript.");
  await page.evaluate(() => window.sessionTitleTest.finish?.());
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].title))
    .toBe("First dictation name");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second saved transcript.");
  await expect(dialog).toHaveCount(0);
});

test("saved transcript edits drive display, search, copy and export while keeping originals", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "edit",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "um, send postgres",
        finalTranscript: "Send PostgreSQL.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /Send PostgreSQL/ }).click();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Edit transcript" });
  const input = dialog.getByRole("textbox", {
    name: "Editable text",
    exact: true,
  });
  await expect(input).toHaveValue("Send PostgreSQL.");
  await expect(input).toBeFocused();
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: /Saved|Changes save automatically|Not saved yet:/ }),
  ).toBeVisible();
  await input.fill("Send PostgreSQL to Benji.\nThanks!");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Send PostgreSQL to Benji.\nThanks!", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Send PostgreSQL to Benji.\nThanks!");
  await detailAction(page, "Export");
  await page
    .getByRole("dialog", { name: "Export transcripts", exact: true })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.exportedText))
    .toBe("Send PostgreSQL to Benji.\nThanks!");
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await page.getByLabel("Search transcripts").fill("Benji");
  await expect(page.getByText("Send PostgreSQL to Benji.\nThanks!", { exact: true })).toBeVisible();
  await page.getByLabel("Search transcripts").fill("um,");
  await page.getByRole("link", { name: /Send PostgreSQL to Benji/ }).click();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Original transcription", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("um, send postgres", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript))
    .toBe("um, send postgres");
});

test("editor retains its draft across refresh and failed saves, then saves with keyboard shortcut", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "edit",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original plain transcript.",
        finalTranscript: "Original plain transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /Original plain transcript/ }).click();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Edit transcript" });
  const input = dialog.getByRole("textbox", {
    name: "Editable text",
    exact: true,
  });
  await input.fill("My correction.");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
    window.dictationTest.history();
  });
  await settle(page);
  await expect(input).toHaveValue("My correction.");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Transcript save failed");
  await expect(input).toHaveValue("My correction.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Original plain transcript.");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await input.press("Control+Enter");
  await expect(dialog.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Result", exact: true })
      .getByText("My correction.", { exact: true }),
  ).toBeVisible();
});

test("Done and Escape flush edits, empty edits cannot be saved, and outside clicks keep the draft", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "edit",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original plain transcript.",
        finalTranscript: "Original plain transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /Original plain transcript/ }).click();
  const edit = page.getByRole("button", {
    name: "Edit transcript",
    exact: true,
  });
  await edit.click();
  const dialog = page.getByRole("region", { name: "Edit transcript" });
  const input = dialog.getByRole("textbox", {
    name: "Editable text",
    exact: true,
  });
  await input.fill(" \n ");
  await expect(
    dialog
      .getByRole("status")
      .filter({ hasText: /Saved|Changes save automatically|Not saved yet:/ }),
  ).toBeVisible();
  await input.fill("Discard this.");
  await page.mouse.click(5, 5);
  await expect(input).toHaveValue("Discard this.");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Discard this.");
  await edit.click();
  await expect(input).toHaveValue("Discard this.");
  await input.fill("Escape this.");
  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Escape this.");
});

test("deleted recordings fail safely without losing the editor draft", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "edit",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original plain transcript.",
        finalTranscript: "Original plain transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /Original plain transcript/ }).click();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Edit transcript" });
  await dialog.getByRole("textbox", { name: "Editable text", exact: true }).fill("Keep my draft.");
  await page.evaluate(() => {
    window.dictationTest.snapshot.history = [];
    window.dictationTest.history();
  });
  await settle(page);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This dictation no longer exists");
  await expect(dialog.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    "Keep my draft.",
  );
  await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dictation not found", exact: true }),
  ).toBeVisible();
});

async function openCorrectionEditor(page: Page) {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "correction",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "postgres connection ready.",
        finalTranscript: "postgres connection ready.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /postgres connection ready/ }).click();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "Editable text",
    exact: true,
  });
  await input.fill("PostgreSQL connection ready.");
  return input;
}

test("a selected correction adds a confirmed term without saving the transcript draft", async ({
  page,
}) => {
  const input = await openCorrectionEditor(page);
  const add = page.getByRole("button", {
    name: "Add to vocabulary",
    exact: true,
  });
  await expect(add).toHaveCount(0);
  await input.press("Home");
  await input.press("Control+Shift+ArrowRight");
  await expect(add).toBeEnabled();
  await add.click();
  const term = page.getByRole("dialog", {
    name: "Add to vocabulary",
    exact: true,
  });
  await expect(term.getByLabel("Preferred spelling", { exact: true })).toHaveValue("PostgreSQL");
  await expect(term.getByLabel("Preferred spelling", { exact: true })).toBeFocused();
  await term.getByLabel("Aliases (comma-separated)").fill("postgres, post gre SQL");
  // A newer saved vocabulary must survive even if the editor's snapshot is older.
  await page.evaluate(() => {
    window.dictationTest.snapshot.vocabulary.push({
      id: "newer",
      canonical: "SQLite",
      aliases: [],
      enabled: false,
    });
  });
  await term.getByRole("button", { name: "Save term", exact: true }).click();
  await expect(page.getByRole("region", { name: "Edit transcript" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Added to vocabulary" })).toBeVisible();
  await expect(input).toHaveValue("PostgreSQL connection ready.");
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.snapshot.vocabulary.map((entry) => ({
          ...entry,
          id: "",
        })),
      ),
    )
    .toEqual([
      { id: "", canonical: "SQLite", aliases: [], enabled: false },
      {
        id: "",
        canonical: "PostgreSQL",
        aliases: ["postgres", "post gre SQL"],
        enabled: true,
      },
    ]);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("postgres connection ready.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("");
  await input.press("Control+Enter");
  await expect(page.getByRole("region", { name: "Edit transcript", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(activeDialog(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("PostgreSQL connection ready.");
  await navigateMain(page, "Vocabulary");
  await expect(page.getByLabel("Preferred spelling", { exact: true }).last()).toHaveValue(
    "PostgreSQL",
  );
});

test("term save failures and conflicts preserve both drafts for retry", async ({ page }) => {
  const input = await openCorrectionEditor(page);
  await input.press("Home");
  await input.press("Control+Shift+ArrowRight");
  await page.getByRole("button", { name: "Add to vocabulary", exact: true }).click();
  const term = page.getByRole("dialog", { name: "Add to vocabulary" });
  const aliases = term.getByLabel("Aliases (comma-separated)");
  await aliases.fill("postgres");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
    window.dictationTest.history();
  });
  await term.getByRole("button", { name: "Save term", exact: true }).click();
  await expect(term.getByRole("alert")).toHaveText("Vocabulary save failed");
  await expect(aliases).toHaveValue("postgres");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
    window.dictationTest.snapshot.vocabulary = [
      { id: "taken", canonical: "Other", aliases: ["postgres"], enabled: true },
    ];
  });
  await aliases.press("Control+Enter");
  await expect(term.getByRole("alert")).toHaveText(
    '"postgres" is already assigned to another vocabulary term',
  );
  await aliases.fill("post gre SQL");
  await aliases.press("Enter");
  await expect(input).toHaveValue("PostgreSQL connection ready.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length))
    .toBe(2);
});

test("Cancel and Escape return from vocabulary confirmation without losing edits", async ({
  page,
}) => {
  const input = await openCorrectionEditor(page);
  for (const cancelWithEscape of [false, true]) {
    await input.press("Home");
    await input.press("Control+Shift+ArrowRight");
    await page.getByRole("button", { name: "Add to vocabulary", exact: true }).click();
    const term = page.getByRole("dialog", { name: "Add to vocabulary" });
    await term.getByLabel("Preferred spelling", { exact: true }).fill("Discarded");
    await page.mouse.click(5, 5);
    await expect(term).toBeVisible();
    if (cancelWithEscape)
      await term.getByLabel("Preferred spelling", { exact: true }).press("Escape");
    else await term.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(input).toHaveValue("PostgreSQL connection ready.");
    await expect(input).toBeFocused();
  }
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length))
    .toBe(0);
  await input.press("Escape");
  await expect(activeDialog(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("PostgreSQL connection ready.");
});

test("vocabulary selection rejects multiline or oversized terms and respects active recording", async ({
  page,
}) => {
  const input = await openCorrectionEditor(page);
  const add = page.getByRole("button", {
    name: "Add to vocabulary",
    exact: true,
  });
  await input.fill("a".repeat(81));
  await input.press("Control+A");
  await expect(add).toHaveCount(0);
  await input.fill("Two\nlines");
  await input.press("Control+A");
  await expect(add).toHaveCount(0);
  await input.fill("PostgreSQL");
  await input.press("Control+A");
  await expect(add).toBeEnabled();
  await add.click();
  const term = page.getByRole("dialog", { name: "Add to vocabulary" });
  await term.getByLabel("Preferred spelling", { exact: true }).fill(" ");
  await expect(term.getByRole("button", { name: "Save term", exact: true })).toBeDisabled();
  await term.getByLabel("Preferred spelling", { exact: true }).fill("PostgreSQL");
  await page.evaluate(() => {
    window.dictationTest.status("recording");
  });
  await expect(term.getByRole("button", { name: "Save term", exact: true })).toBeDisabled();
  await expect(
    term.getByText("Finish the current operation before adding a term.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.status("idle");
  });
  await term.getByRole("button", { name: "Save term", exact: true }).click();
  await expect(input).toHaveValue("PostgreSQL");
});

test("History loads one batch at a time, stops at the end, and deletes and restores a selection across batches", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 105 }, (_, index) => ({
      id: `scroll-${index}`,
      createdAt: "2026-11-06T10:00:00Z",
      durationMs: 1000,
      rawTranscript: `Scroll dictation ${index}`,
      finalTranscript: `Scroll dictation ${index}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history");
  const rows = page.getByRole("checkbox", { name: /^Select dictation / });
  await expect(rows).toHaveCount(50);
  await expect(page.getByRole("navigation", { name: "History pages" })).toHaveCount(0);
  await rows.first().check();
  await page.evaluate(() => {
    window.dictationTest.deferHistory = true;
  });
  await rows.last().scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("status").filter({ hasText: "Loading more dictations" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(1);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.first()).toBeEnabled();
  await expect(rows.first()).toBeChecked();
  expect(
    await page.evaluate(() => window.dictationTest.historyRequests.map(({ page }) => page)),
  ).toEqual([0, 1]);
  await page.evaluate(() => {
    window.dictationTest.deferHistory = false;
    window.dictationTest.pendingHistory[0].resolve();
  });
  await expect(rows).toHaveCount(100);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows).toHaveCount(105);
  await rows.last().scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => window.dictationTest.historyRequests.map(({ page }) => page)),
  ).toEqual([0, 1, 2]);
  // Refresh the entire loaded range after an external edit and shifted boundary.
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.history[75].finalTranscript = "Updated older dictation";
    state.snapshot.history.splice(20, 1);
    state.history();
  });
  await expect(rows).toHaveCount(104);
  await expect(page.getByRole("link", { name: /Updated older dictation/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Scroll dictation 20\b/ })).toHaveCount(0);
  await expect(rows.first()).toBeChecked();
  await page.getByRole("checkbox", { name: "Select loaded", exact: true }).check();
  await expect(page.getByText("104 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect(page.getByText("No dictations yet", { exact: true })).toBeVisible();
  await page
    .locator('[data-slot="toast"]')
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(page.getByText("104 dictations", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.recentlyDeleted.length)).toBe(0);
});

test("History retries a failed next batch and ignores its reply after a new search", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 52 }, (_, index) => ({
      id: `retry-${index}`,
      createdAt: "2026-11-06T10:00:00Z",
      durationMs: 1000,
      rawTranscript: `Retry dictation ${index}`,
      finalTranscript: `Retry dictation ${index}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history");
  const rows = page.getByRole("checkbox", { name: /^Select dictation / });
  await expect(rows).toHaveCount(50);
  await page.evaluate(() => {
    window.dictationTest.failHistory = true;
  });
  await rows.last().scrollIntoViewIfNeeded();
  await expect(page.getByRole("alert")).toContainText("History load failed");
  await expect(rows).toHaveCount(50);
  await expect(rows.last()).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.failHistory = false;
    window.dictationTest.deferHistory = true;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(1);
  expect(await page.evaluate(() => window.dictationTest.pendingHistory[0].page)).toBe(1);
  await page.getByLabel("Search transcripts", { exact: true }).fill("Retry dictation 51");
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(2);
  await page.evaluate(() => {
    window.dictationTest.pendingHistory[1].resolve();
  });
  await expect(rows).toHaveCount(1);
  await page.evaluate(() => {
    window.dictationTest.pendingHistory[0].resolve();
  });
  await settle(page);
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Retry dictation 51/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/history\?q=Retry\+dictation\+51$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("History preserves selections while scrolling, exports selected entries, and refreshes after deletion", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 52 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: "2026-10-07",
      durationMs: 1000,
      rawTranscript: `Original ${i}`,
      finalTranscript: `Dictation ${i}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history");
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(50);
  await page.getByRole("checkbox", { name: "Select loaded", exact: true }).check();
  await expect(page.getByText("50 selected", { exact: true })).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Select dictation 50", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(52);
  await expect(page.getByText("50 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select dictation 51", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select dictation 52", exact: true }).check();
  await page.getByRole("button", { name: "Export selected", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Export transcripts", exact: true })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.exportedText))
    .toBe("Dictation 50\nDictation 51");
  await page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "2 files exported" })
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect(activeDialog(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("History deletion failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(50);
  await expect(page.getByText("50 dictations", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dictation 0\b/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "History pages" })).toHaveCount(0);
  await page
    .locator('[data-slot="toast"]')
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await page.getByRole("button", { name: "Show Recently Deleted", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show all dictations", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("heading", { name: "Recently Deleted", exact: true })).toBeVisible();
  await expect(page.getByText("Dictation 50", { exact: true })).toBeVisible();
  await expect(page.getByText(/30 days left to restore/)).toHaveCount(2);
  await page.getByLabel("Search transcripts").fill("Original 50");
  await expect(page.getByText("Dictation 51", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("No matching transcripts", { exact: true })).toBeVisible();
  await page.getByLabel("Search transcripts").fill("");
  await expect(page.getByText("Dictation 51", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select loaded", exact: true }).check();
  await page.getByRole("button", { name: "Restore selected", exact: true }).click();
  await expect(page.getByText("No recently deleted dictations", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show all dictations", exact: true }).click();
  await expect(page.getByText("52 dictations", { exact: true })).toBeVisible();
});

test("Recently Deleted supports retry and restoration on narrow screens after the toast is gone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 480, height: 850 });
  await page.addInitScript(() => {
    localStorage.setItem("desktop-theme", "dark");
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const state = window.dictationTest;
    state.failHistory = true;
    state.recentlyDeleted = [
      {
        id: "deleted-one",
        createdAt: "2026-10-07",
        durationMs: 17000,
        rawTranscript: "Meeting notes from the design review.",
        finalTranscript:
          "Meeting notes from the design review. Keep the deletion flow simple and make recovery easy to find.",
        speechModel: "base",
        language: "en",
        audioPath: "/recordings/one.wav",
        deletedAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ];
  });
  await page.goto("/#/history?view=deleted");
  await expect(page.getByRole("alert")).toContainText("History load failed");
  await page.evaluate(() => {
    window.dictationTest.failHistory = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText(/29 days left to restore/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show all dictations", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const selectPage = page.getByRole("checkbox", { name: "Select loaded", exact: true });
  const uncheckedBounds = (await selectPage.boundingBox())!;
  await selectPage.check();
  const checkedBounds = (await selectPage.boundingBox())!;
  expect(checkedBounds.x).toBeCloseTo(uncheckedBounds.x, 0);
  expect(checkedBounds.y).toBeCloseTo(uncheckedBounds.y, 0);
  await expect(page.getByRole("region", { name: "Selection actions", exact: true })).toBeVisible();
  for (const width of [1086, 360]) {
    await page.setViewportSize({ width, height: 850 });
    const restore = page.getByRole("button", { name: "Restore", exact: true });
    const remove = page.getByRole("button", { name: "Delete permanently", exact: true });
    const restoreBounds = (await restore.boundingBox())!;
    const removeBounds = (await remove.boundingBox())!;
    const sameRow =
      Math.abs(
        restoreBounds.y + restoreBounds.height / 2 - removeBounds.y - removeBounds.height / 2,
      ) < 1;
    expect(sameRow).toBe(true);
    expect(removeBounds.x).toBeGreaterThanOrEqual(restoreBounds.x + restoreBounds.width + 4);
    for (const bounds of [restoreBounds, removeBounds]) {
      expect(bounds.width).toBeCloseTo(bounds.height, 0);
    }
    for (const button of [restore, remove]) {
      expect(await button.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    }
    await expect(restore).toHaveText("");
    await expect(remove).toHaveText("");
    await remove.hover();
    const tooltip = page
      .locator('[data-slot="tooltip-content"]')
      .filter({ hasText: "Delete permanently" });
    await expect(tooltip).toBeVisible();
    await page.getByRole("heading", { name: "Recently Deleted", exact: true }).hover();
    await expect(tooltip).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`recently-deleted-icons-${width}.png`),
      fullPage: true,
    });
  }
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("History restoration failed");
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("No recently deleted dictations", { exact: true })).toBeVisible();
});

test("Recently Deleted permanently deletes individual entries and selections without a modal", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const state = window.dictationTest;
    state.recentlyDeleted = Array.from({ length: 52 }, (_, index) => ({
      id: `deleted-${index}`,
      createdAt: "2026-10-07",
      durationMs: 1000,
      rawTranscript: `Original ${index}`,
      finalTranscript: `Deleted dictation ${index}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
      deletedAt: new Date().toISOString(),
    }));
  });
  await page.goto("/#/history?view=deleted&page=1");
  await expect(page.getByRole("article")).toHaveCount(52);
  await page.setViewportSize({ width: 360, height: 850 });
  await expect(
    page.getByRole("button", { name: "Delete permanently", exact: true }).first(),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("recently-deleted-permanent-360.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page
    .getByRole("article")
    .filter({ hasText: "Deleted dictation 50" })
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText("Permanent deletion failed");
  await expect(page.getByText("Deleted dictation 50", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page
    .getByRole("article")
    .filter({ hasText: "Deleted dictation 50" })
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.getByText("Deleted dictation 50", { exact: true })).toHaveCount(0);
  const toast = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Dictation permanently deleted" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select loaded", exact: true }).check();
  const selectionBounds = (await page
    .getByRole("region", { name: "Selection actions", exact: true })
    .boundingBox())!;
  const toastBounds = (await toast.boundingBox())!;
  expect(toastBounds.y + toastBounds.height).toBeLessThanOrEqual(selectionBounds.y);
  await page.getByRole("button", { name: "Delete selected permanently", exact: true }).click();
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await expect(page.getByText("No recently deleted dictations", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/view=deleted$/);
  await expect.poll(() => page.evaluate(() => window.dictationTest.recentlyDeleted.length)).toBe(0);
});

test("deletion Undo remains available after navigating away from History", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "undo-across-navigation",
        createdAt: new Date().toISOString(),
        durationMs: 1000,
        rawTranscript: "Original transcript",
        finalTranscript: "Corrected transcript",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /Corrected transcript/ }).click();
  await detailAction(page, "Delete dictation");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .locator('[data-slot="toast"]')
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.recentlyDeleted.length)).toBe(0);
  await navigateMain(page, "History");
  await expect(page.getByRole("link", { name: /Corrected transcript/ })).toBeVisible();
});

test("History keeps its header stable and selection actions at the bottom while scrolling", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("yap-sidebar-collapsed", "true");
    localStorage.setItem("desktop-theme", "dark");
    window.dictationTest.snapshot.floatingIndicator = false;
    window.dictationTest.snapshot.history = Array.from({ length: 40 }, (_, index) => ({
      id: `sticky-${index}`,
      createdAt: "2026-10-09",
      durationMs: 1000,
      rawTranscript: `Dictation ${index + 1}`,
      finalTranscript: `Dictation ${index + 1}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/#/models");
  const headingStyle = (element: HTMLElement | SVGElement) => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, weight: style.fontWeight, spacing: style.letterSpacing };
  };
  const modelsStyle = await page
    .getByRole("heading", { name: "Models", exact: true })
    .evaluate(headingStyle);
  await page.goto("/#/history");
  await expect(page.getByText("40 dictations", { exact: true })).toBeVisible();
  const title = page.getByRole("heading", { name: "History", exact: true });
  const search = page.getByLabel("Search transcripts", { exact: true });
  const importAudio = page.getByRole("button", { name: "Import audio", exact: true });
  expect(await title.evaluate(headingStyle)).toEqual(modelsStyle);
  const titleBounds = (await title.boundingBox())!;
  const searchBounds = (await search.boundingBox())!;
  const importBounds = (await importAudio.boundingBox())!;
  expect(searchBounds.x).toBeGreaterThan(titleBounds.x + titleBounds.width);
  expect(Math.abs(searchBounds.y - importBounds.y)).toBeLessThan(2);
  expect(searchBounds.y).toBeLessThan(titleBounds.y + titleBounds.height + 12);
  await page.screenshot({
    path: testInfo.outputPath("history-header-desktop.png"),
    animations: "disabled",
  });
  const selectPage = page.getByRole("checkbox", { name: "Select loaded", exact: true });
  const checkboxBefore = (await selectPage.boundingBox())!;
  const selectionBar = page.getByRole("region", { name: "Selection actions", exact: true });
  await expect(selectionBar).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).check();
  const checkboxAfter = (await selectPage.boundingBox())!;
  expect(checkboxAfter.x).toBeCloseTo(checkboxBefore.x, 0);
  expect(checkboxAfter.y).toBeCloseTo(checkboxBefore.y, 0);
  await expect(selectionBar).toBeVisible();
  for (const width of [1280, 760, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(async () => (await title.boundingBox())!.y).toBeLessThan(30);
    const controls = [title, search, importAudio, selectPage];
    for (const control of controls) {
      const bounds = await control.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThan(width === 360 ? 380 : 300);
    }
    const barBounds = (await selectionBar.boundingBox())!;
    expect(barBounds.y).toBeGreaterThan(720 - 160);
    expect(barBounds.y + barBounds.height).toBeLessThanOrEqual(720 - 12);
    for (const name of ["Export selected", "Delete selected"]) {
      const bounds = (await selectionBar.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(barBounds.y);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(barBounds.y + barBounds.height);
    }
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
    await page.screenshot({
      path: testInfo.outputPath(`history-sticky-${width}.png`),
      animations: "disabled",
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.evaluate(() => window.dictationTest.status("recording"));
  const recordingControls = page.getByRole("status").filter({ hasText: /Recording ·/ });
  await expect(recordingControls).toBeVisible();
  const recordingBounds = (await recordingControls.boundingBox())!;
  const barBounds = (await selectionBar.boundingBox())!;
  expect(recordingBounds.y + recordingBounds.height).toBeLessThanOrEqual(barBounds.y);
  await page.evaluate(() => window.dictationTest.status("idle"));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const lastRow = (await page.getByRole("article").last().boundingBox())!;
  expect(lastRow.y + lastRow.height).toBeLessThanOrEqual((await selectionBar.boundingBox())!.y);
  await selectionBar.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(selectionBar).toHaveCount(0);
  await expect(selectPage).not.toBeChecked();
  await expect(selectPage).toBeFocused();
  await page.getByLabel("Search transcripts", { exact: true }).fill("Dictation 39");
  await expect(page.getByText("1 dictation", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dictation 39/ })).toBeVisible();
});

test("History searches all entries beyond 500 and ignores older search replies", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 501 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: "2026-10-07",
      durationMs: 1000,
      rawTranscript: i === 500 ? "Älterer Name" : "alpha",
      finalTranscript: i === 500 ? "beta correction" : "alpha",
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history");
  await expect(page.getByText("501 dictations", { exact: true })).toBeVisible();
  const search = page.getByLabel("Search transcripts");
  await search.fill("ÄLTERER");
  await expect(page.getByRole("link", { name: /beta correction/ })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.deferHistory = true;
  });
  await search.fill("alpha");
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(1);
  await search.fill("beta");
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(2);
  await page.evaluate(() => {
    window.dictationTest.pendingHistory[1].resolve();
  });
  await expect(page.getByText("1 dictation", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.pendingHistory[0].resolve();
  });
  await settle(page);
  await expect(page.getByRole("link", { name: /beta correction/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^alpha/ })).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.deferHistory = false;
    window.dictationTest.failHistory = true;
  });
  await search.fill("missing");
  await expect(page.getByRole("alert").filter({ hasText: "History load failed" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select loaded", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.failHistory = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching transcripts", exact: true }),
  ).toBeVisible();
});

test("retention defaults to forever and requires confirmation before saving or deleting", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "old",
        createdAt: "2000-01-01T00:00:00Z",
        durationMs: 1000,
        rawTranscript: "Old",
        finalTranscript: "Edited old",
        speechModel: "base",
        language: "en",
        audioPath: "/audio.wav",
      },
    ];
  });
  await page.goto("/#/settings");
  const recordingMode = page.getByRole("combobox", {
    name: "Recording mode",
    exact: true,
  });
  await recordingMode.click();
  await page
    .getByRole("option", {
      name: "Press to start / press to stop",
      exact: true,
    })
    .click();
  await page.getByRole("combobox", { name: "Spoken language", exact: true }).click();
  await page.getByRole("option", { name: "German", exact: true }).click();
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  const retention = page.getByRole("combobox", {
    name: "History retention",
    exact: true,
  });
  await expect(retention.locator('[data-slot="select-value"]')).toHaveText("Keep forever");
  await retention.click();
  await page.getByRole("option", { name: "30 days", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Enable automatic deletion?" });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays))
    .toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(1);
  await expect(retention.locator('[data-slot="select-value"]')).toHaveText("Keep forever");
  await page.waitForTimeout(600);
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await retention.click();
  await page.getByRole("option", { name: "30 days", exact: true }).click();
  await dialog.getByRole("button", { name: "Save and delete older history", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(retention.locator('[data-slot="select-value"]')).toHaveText("30 days");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(1);
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await dialog.getByRole("button", { name: "Save and delete older history", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays))
    .toBe(30);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.interaction))
    .toBe("toggle");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
    .toBe("de");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(0);
  await retention.click();
  await page.getByRole("option", { name: "Keep forever", exact: true }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Enable automatic deletion?",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays))
    .toBe(0);
});

test("Models shows actual disk usage and protects the active model during removal and retries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.models = [
      {
        id: "base",
        name: "Whisper Base",
        description: "Balanced",
        size: 147000000,
        installed: true,
        path: "/model",
        diskBytes: 3000000,
        removable: true,
      },
      {
        id: "tiny",
        name: "Whisper Tiny",
        description: "Fast",
        size: 77000000,
        installed: true,
        path: "/tiny",
        diskBytes: 2000000,
        removable: true,
      },
    ];
  });
  await page.goto("/#/models");
  await expect(page.getByLabel("Model storage", { exact: true })).toContainText("5 MB");
  await expect(page.getByLabel("Model storage", { exact: true })).toContainText("2 downloaded");
  await expect(
    (await modelMenu(page, "Whisper Base")).getByRole("menuitem", {
      name: "Remove model",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await modelAction(page, "Remove model", "Whisper Tiny");
  let dialog = page.getByRole("dialog", { name: "Remove Whisper Tiny?" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Model storage", { exact: true })).toContainText("5 MB");
  await modelAction(page, "Remove model", "Whisper Tiny");
  dialog = page.getByRole("dialog", { name: "Remove Whisper Tiny?" });
  await page.evaluate(() => {
    window.dictationTest.status("recording");
  });
  await expect(dialog.getByRole("button", { name: "Remove model", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.failSave = true;
  });
  await dialog.getByRole("button", { name: "Remove model", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Model removal failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Remove model", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Model storage", { exact: true })).toContainText("3 MB");
  await expect(page.getByLabel("Model storage", { exact: true })).toContainText("1 downloaded");
  await expect(page.locator('[data-slot="model-row"]')).toHaveCount(1);
  await page.getByRole("button", { name: "All models", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Whisper Tiny", exact: true })
      .getByRole("button", { name: /^More actions/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download & use", exact: true })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.modelPath))
    .toBe("/model");
});

async function recordShortcut(page: Page) {
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record shortcut",
    exact: true,
  });
  await expect(dialog.getByText("Press a key combination", { exact: true })).toBeVisible();
  return dialog;
}

test("Mac recorder keeps layout letters and rejects ambiguous Option characters", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { value: "MacIntel" }),
  );
  await page.goto("/#/settings");
  const dialog = await recordShortcut(page);
  const area = dialog.getByRole("group", { name: "Shortcut capture" });
  for (const [key, code] of [
    ["z", "KeyY"],
    ["y", "KeyZ"],
  ]) {
    await area.dispatchEvent("keydown", { key, code, ctrlKey: true });
    await expect(dialog.getByText(`Ctrl+${key.toUpperCase()}`, { exact: true })).toBeVisible();
    await area.dispatchEvent("keyup", { key, code });
    await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeEnabled();
  }
  await area.dispatchEvent("keydown", { key: "Ω", code: "KeyZ", altKey: true });
  await expect(dialog.getByRole("alert")).toHaveText(
    "Enter this shortcut manually using the base letter, or record Space or F1–F12.",
  );
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeDisabled();
});

test("shortcut capture waits for key release, then saves alongside other settings edits", async ({
  page,
}) => {
  await page.goto("/#/settings?section=history");
  await page.getByRole("switch", { name: /Keep recordings/ }).check();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  const dialog = await recordShortcut(page);
  const area = dialog.getByRole("group", { name: "Shortcut capture" });
  await expect(area).toBeFocused();
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("p");
  await expect(dialog.getByText("Ctrl+Alt+P", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeDisabled();
  await page.keyboard.up("p");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record shortcut", exact: true })).toBeFocused();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
  await page.evaluate(() => window.dictationTest.history());
  await settle(page);
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  await expect(page.getByRole("switch", { name: /Keep recordings/ })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("");
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureEnded)).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings))
    .toMatchObject({ shortcut: "Ctrl+Alt+P", saveAudio: true });
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(0);
});

test("recorder accepts the existing Space shortcut and function keys without starting dictation", async ({
  page,
}) => {
  await page.goto("/#/settings");
  let dialog = await recordShortcut(page);
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+Space");
  await expect(dialog.getByText("Ctrl+Alt+Space", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.phase))
    .toBe("idle");
  dialog = await recordShortcut(page);
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Shift+F12");
  await expect(dialog.getByText("Ctrl+Shift+F12", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Shift+F12");
});

test("recorder rejects unsupported keys and modifiers, ignores repeat, and leaves Tab accessible", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const dialog = await recordShortcut(page);
  const area = dialog.getByRole("group", { name: "Shortcut capture" });
  await area.press("a");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Include at least one modifier: Ctrl, Alt, or Shift.",
  );
  await area.press("Control+1");
  await expect(dialog.getByRole("alert")).toHaveText("Use Space, A–Z, or F1–F12.");
  await area.press("Meta+a");
  await expect(dialog.getByRole("alert")).toHaveText(
    "Use Ctrl, Alt, or Shift. Command, Windows, and AltGr are not supported.",
  );
  await area.dispatchEvent("keydown", {
    key: "Process",
    code: "KeyA",
    ctrlKey: true,
    isComposing: true,
  });
  await expect(dialog.getByRole("alert")).toHaveText(
    "Finish composing text, then press a shortcut.",
  );
  await area.dispatchEvent("keyup", { key: "Process", code: "KeyA" });
  await area.evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "x",
      code: "KeyX",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "getModifierState", {
      value: (name: string) => name === "AltGraph",
    });
    element.dispatchEvent(event);
  });
  await expect(dialog.getByRole("alert")).toHaveText(
    "Use Ctrl, Alt, or Shift. Command, Windows, and AltGr are not supported.",
  );
  await area.dispatchEvent("keyup", { key: "x", code: "KeyX" });
  await area.press("Control+Alt+p");
  await area.dispatchEvent("keydown", {
    key: "b",
    code: "KeyB",
    ctrlKey: true,
    repeat: true,
  });
  await expect(dialog.getByText("Ctrl+Alt+P", { exact: true })).toBeVisible();
  await area.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(dialog).toHaveCount(0);
});

test("Cancel, Escape and focus loss restore the saved shortcut and discard the candidate", async ({
  page,
}) => {
  await page.goto("/#/settings");
  for (const action of ["cancel", "escape", "blur"]) {
    const dialog = await recordShortcut(page);
    await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+p");
    if (action === "cancel")
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    else if (action === "escape")
      await dialog.getByRole("group", { name: "Shortcut capture" }).press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+Space");
    await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("");
  }
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureEnded)).toBe(3);
});

test("late capture replies and backend timeout cannot leave the shortcut suspended", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.evaluate(() => {
    window.dictationTest.deferCapture = true;
  });
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click();
  let dialog = page.getByRole("dialog", {
    name: "Record shortcut",
    exact: true,
  });
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.resolveCapture)).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.resolveCapture!();
    window.dictationTest.deferCapture = false;
  });
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("");
  dialog = await recordShortcut(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    const token = state.captureToken;
    state.captureToken = "";
    state.callbacks["shortcut:capture-ended"](token);
  });
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Shortcut capture timed out" }),
  ).toBeVisible();
});

test("recorder reports start and restoration failures, and save conflicts keep the draft", async ({
  page,
}) => {
  await page.goto("/#/settings");
  await page.evaluate(() => {
    window.dictationTest.failCapture = true;
  });
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click();
  let dialog = page.getByRole("dialog", {
    name: "Record shortcut",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toHaveText("Could not start shortcut capture");
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failCapture = false;
    window.dictationTest.failRestore = true;
    window.dictationTest.occupiedShortcut = "Ctrl+Alt+P";
  });
  dialog = await recordShortcut(page);
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+p");
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not restore the saved shortcut" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "your saved shortcut is unchanged" }),
  ).toBeVisible();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+Space");
  await page.evaluate(() => {
    window.dictationTest.failRestore = false;
    window.dictationTest.occupiedShortcut = "";
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+P");
});

test("shortcut recorder is disabled during active work and works in first-run setup", async ({
  page,
}) => {
  await page.goto("/#/settings");
  for (const phase of [
    "recording",
    "transcribing",
    "downloading",
    "mic-test",
    "diagnostic-recording",
    "diagnostic-transcribing",
  ]) {
    await page.evaluate((phase) => window.dictationTest.status(phase), phase);
    await expect(page.getByRole("button", { name: "Record shortcut", exact: true })).toBeDisabled();
  }
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("idle");
    state.snapshot.settings.setupComplete = false;
    state.snapshot.microphoneTested = true;
    state.callbacks["setup:changed"]();
  });
  await navigateMain(page, "Dictate");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const dialog = await recordShortcut(page);
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Shift+F8");
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Shift+F8");
  await page.getByRole("button", { name: "Apply shortcut", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Shift+F8");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.phase))
    .toBe("idle");
});

test("prompt drafts survive refresh and failed save; model testing uses saved config", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 680 });
  await page.goto("/#/prompts?section=models");
  await page.getByRole("switch", { name: "Enable text processing" }).check();
  await page.getByLabel("Model identifier").fill("my-local-model");
  await showServerAddress(page);
  await page.getByLabel("Local server URL").fill("http://127.0.0.1:1234/v1");
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Add prompt" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Technical ticket");
  await page
    .getByLabel("Instructions")
    .fill("Format the transcript as a bug report. Keep names unchanged.");
  await page.getByRole("combobox", { name: "Saved prompt", exact: true }).click();
  await expect(page.getByRole("option", { name: "Technical ticket", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator('[data-slot="select-content"]')).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: testInfo.outputPath("saved-prompts-select.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Saved prompt", exact: true })).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Saved prompt", exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: "Cleanup", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Cleanup");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Saved prompt", exact: true }).click();
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "Technical ticket", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Technical ticket");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const automatic = page.getByRole("switch", { name: "Run after dictation", exact: true });
  await automatic.check();
  await expect(automatic).toBeChecked();
  await automatic.uncheck();
  await expect(
    page.getByText(
      "Turn on to use this prompt after dictation. Profiles and chains can override the default.",
      { exact: true },
    ),
  ).toBeVisible();
  await automatic.check();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await expect(page.getByRole("button", { name: "Test model", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await saveDraft(page);
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
    window.dictationTest.history();
  });
  await page.getByLabel("Name", { exact: true }).fill("Technical ticket updated");
  await settle(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Technical ticket updated");
  await saveDraft(page);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Prompts save failed" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await expect(page.getByLabel("Model identifier")).toHaveValue("my-local-model");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await saveDraft(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Changes save automatically" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.length))
    .toBe(3);
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Model responded successfully." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("prompts.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await promptAction(page, "Delete prompt");
  await page
    .getByRole("dialog", { name: "Delete this prompt?", exact: true })
    .getByRole("button", { name: "Delete prompt", exact: true })
    .click();
  await expect(automatic).not.toBeChecked();
  await expect(
    page.getByText(
      "Turn on to use this prompt after dictation. Profiles and chains can override the default.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByRole("switch", { name: "Enable text processing" }).uncheck();
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.enabled))
    .toBe(false);
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await expect(automatic).toBeDisabled();
});

async function openPromptEditor(page: Page) {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "custom-model";
    state.snapshot.history = [
      {
        id: "prompt",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "Original speech.",
        finalTranscript: "Saved correction.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history");
  await page.getByRole("link", { name: /Saved correction/ }).click();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Editable text", exact: true })
    .fill("Unsaved draft for summary.");
  await page.getByRole("button", { name: "Run prompt or chain…", exact: true }).click();
}

test("prompt previews use the draft and change History only after apply and save", async ({
  page,
}, testInfo) => {
  await openPromptEditor(page);
  const prompt = page.getByRole("combobox", { name: "Prompt", exact: true });
  await prompt.click();
  await expect(page.getByRole("option", { name: "Summary", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Process transcript", exact: true })).toBeVisible();
  await expect(prompt).toBeFocused();
  await prompt.press("ArrowDown");
  await page.getByRole("option", { name: "Summary", exact: true }).click();
  await page.getByRole("button", { name: "Generate preview", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Unsaved draft for summary.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
    .toBe("summary");
  await expect(prompt).toBeDisabled();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Concise summary."));
  await expect(page.getByRole("region", { name: "Generated result", exact: true })).toContainText(
    "Concise summary.",
  );
  await expect(page.getByRole("region", { name: "Input text", exact: true })).toContainText(
    "Unsaved draft for summary.",
  );
  await expect(page.getByRole("region", { name: "Generated result", exact: true })).toContainText(
    "Summary",
  );
  await page.screenshot({
    path: testInfo.outputPath("preview.png"),
    animations: "disabled",
  });
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Saved correction.");
  await page.getByRole("button", { name: "Replace draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    "Concise summary.",
  );
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Concise summary.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript))
    .toBe("Original speech.");
});

test("Markdown formats transcriptions and outputs while copy, export and editing keep the source", async ({
  page,
}, testInfo) => {
  const source = [
    "# Meeting notes",
    "",
    "A **bold** decision with *emphasis* and ~~old wording~~.",
    "",
    "- First item",
    "- Second item",
    "  - Nested item",
    "",
    "1. Start here",
    "2. Finish here",
    "",
    "- [x] Complete",
    "- [ ] Pending",
    "",
    "> A useful quote",
    "",
    "| Task | Owner |",
    "| --- | --- |",
    "| Review | Benji |",
    "",
    "Use `npm run build`.",
    "",
    "```ts",
    'const message = "Hello";',
    "```",
    "",
    "[Documentation](https://example.com/docs)",
    "",
    "[Unsafe](javascript:alert(1))",
    "",
    "<script>window.markdownExecuted = true</script>",
    "",
    "![Remote image](https://example.com/private-image.png)",
  ].join("\n");
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("private-image.png")) imageRequests.push(request.url());
  });
  await page.addInitScript((source) => {
    const state = window.dictationTest;
    state.snapshot.history = [
      {
        id: "markdown",
        createdAt: "2026-10-07",
        durationMs: 1000,
        rawTranscript: "First line\nSecond line\n\nAnother paragraph.",
        finalTranscript: source,
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    state.outputs = [
      {
        id: "markdown-output",
        sessionId: "markdown",
        createdAt: "2026-10-07",
        prompt: { id: "summary", name: "Summary", instruction: "Summarize" },
        model: "local-model",
        endpoint: "http://127.0.0.1:1234/v1",
        input: source,
        text: source,
      },
    ];
  }, source);
  await page.goto("/#/history/markdown");
  const result = page.getByRole("region", { name: "Result", exact: true });
  await expect(result.getByRole("heading", { name: "Meeting notes", level: 1 })).toBeVisible();
  await expect(result.locator("strong")).toHaveText("bold");
  await expect(result.locator("em")).toHaveText("emphasis");
  await expect(result.locator("del")).toHaveText("old wording");
  await expect(result.locator("ul ul li")).toHaveText("Nested item");
  await expect(result.locator("ol > li")).toHaveCount(2);
  await expect(result.getByRole("checkbox").first()).toBeChecked();
  await expect(result.getByRole("checkbox").first()).toBeDisabled();
  await expect(result.locator("blockquote")).toContainText("A useful quote");
  await expect(result.getByRole("cell", { name: "Benji" })).toBeVisible();
  await expect(result.locator("pre code")).toHaveText('const message = "Hello";\n');
  await expect(result.locator("pre")).toHaveCSS("white-space", "pre");
  await expect(result.getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "href",
    "https://example.com/docs",
  );
  await expect(result.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(result.locator("script, img")).toHaveCount(0);
  await expect(result.getByText("Remote image", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "markdownExecuted"))).toBeUndefined();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe(source);
  await detailAction(page, "Export");
  await page
    .getByRole("dialog", { name: "Export transcripts", exact: true })
    .getByRole("button", { name: "Export", exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.exportedText)).toBe(source);
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Editable text" })).toHaveValue(source);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  const original = page.getByRole("region", { name: "Original transcription", exact: true });
  await expect(original.locator(".markdown-content > p").first()).toHaveText(
    "First line\nSecond line",
    { useInnerText: true },
  );
  await expect(original.locator(".markdown-content > p").first()).toHaveCSS(
    "white-space",
    "pre-wrap",
  );
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  const output = page.getByRole("article", { name: "Summary output", exact: true });
  await expect(output.getByRole("img")).toHaveCount(0);
  await expect(output.getByText("Remote image", { exact: true })).toHaveCount(0);
  await expect(output.getByRole("heading", { name: "Meeting notes", level: 1 })).toBeVisible();
  await expect(output.getByRole("cell", { name: "Benji" })).toBeVisible();
  await page.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe(source);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
      theme,
    );
    await page.screenshot({ path: testInfo.outputPath(`markdown-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(output.getByRole("heading", { name: "Meeting notes", level: 1 })).toBeVisible();
  const content = output.locator(".markdown-content").first();
  expect(await content.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
  expect(
    await content.evaluate((element) => element.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("markdown-narrow.png"), fullPage: true });
  expect(imageRequests).toEqual([]);
});

test("Markdown previews render formatting and apply the original source to the draft", async ({
  page,
}) => {
  await openPromptEditor(page);
  const source = "## Summary\n\n- **First** point\n- Second point";
  await page.getByRole("button", { name: "Generate preview", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.processing)).toBe(true);
  await page.evaluate((source) => window.dictationTest.processing!.resolve(source), source);
  const preview = page.getByRole("region", { name: "Generated result", exact: true });
  await expect(preview.getByRole("heading", { name: "Summary", level: 2 })).toBeVisible();
  await expect(preview.getByRole("listitem")).toHaveCount(2);
  await expect(preview.locator("strong")).toHaveText("First");
  await page.getByRole("button", { name: "Replace draft", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    source,
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Result", exact: true }).getByRole("heading", {
      name: "Summary",
      level: 2,
    }),
  ).toBeVisible();
});

test("failed and cancelled generation retain the draft and suppress late results", async ({
  page,
}) => {
  await openPromptEditor(page);
  await page.evaluate(() => {
    window.dictationTest.failProcessing = true;
  });
  await page.getByRole("button", { name: "Generate preview", exact: true }).click();
  await expect(page.getByText("Model unavailable", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failProcessing = false;
  });
  await page.getByRole("button", { name: "Generate preview", exact: true }).click();
  await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length))
    .toBe(1);
  await page.evaluate(() => window.dictationTest.processing!.resolve("Late unwanted replacement."));
  await expect(page.getByText("Processing cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace draft", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to transcript", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    "Unsaved draft for summary.",
  );
  await page.getByRole("button", { name: "Run prompt or chain…", exact: true }).click();
  await page.getByRole("button", { name: "Generate preview", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    "Unsaved draft for summary.",
  );
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length))
    .toBe(2);
  await page.evaluate(() => window.dictationTest.processing!.resolve("Another late reply."));
  await expect(page.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    "Unsaved draft for summary.",
  );
});

for (const route of ["vocabulary", "settings"]) {
  test(`${route} waits for the initial snapshot before allowing edits`, async ({ page }) => {
    await page.addInitScript(() => {
      const state = window.dictationTest;
      state.deferSnapshots = true;
      state.snapshot.vocabulary = [
        {
          id: "existing",
          canonical: "PostgreSQL",
          aliases: ["postgres"],
          enabled: true,
        },
      ];
      state.snapshot.settings.language = "de";
    });
    await page.goto(`/#/${route}${route === "settings" ? "?section=history" : ""}`);
    const control =
      route === "vocabulary"
        ? page.getByRole("button", { name: "Add term", exact: true })
        : page.getByRole("switch", { name: /^Keep recordings/ });
    await expect(control).toBeDisabled();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.pendingSnapshots.length))
      .toBeGreaterThan(0);
    await page.evaluate(() => {
      const state = window.dictationTest;
      state.deferSnapshots = false;
      state.pendingSnapshots.splice(0).forEach((resolve) => resolve());
    });
    await expect(control).toBeEnabled();
    if (route === "vocabulary") {
      await expect(page.getByLabel("Preferred spelling").first()).toHaveValue("PostgreSQL");
      await control.click();
      await page.getByLabel("Preferred spelling").nth(1).fill("Benji");
      await saveDraft(page);
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.dictationTest.snapshot.vocabulary.map((v) => v.canonical).join(","),
          ),
        )
        .toBe("PostgreSQL,Benji");
    } else {
      await control.check();
      await expect
        .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.saveAudio))
        .toBe(true);
      await expect
        .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
        .toBe("de");
      await expect
        .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.setupComplete))
        .toBe(true);
    }
  });

  test(`${route} stays protected after a failed initial snapshot and can retry`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.dictationTest.failSnapshot = true;
    });
    await page.goto(`/#/${route}${route === "settings" ? "?section=history" : ""}`);
    const control =
      route === "vocabulary"
        ? page.getByRole("button", { name: "Add term", exact: true })
        : page.getByRole("switch", { name: /^Keep recordings/ });
    await expect(
      page.getByRole("alert").filter({ hasText: /^Snapshot unavailable$/ }),
    ).toBeVisible();
    await expect(control).toBeDisabled();
    await page.evaluate(() => {
      window.dictationTest.failSnapshot = false;
    });
    await page.getByRole("button", { name: "Retry loading", exact: true }).click();
    await expect(control).toBeEnabled();
    await expect(page.getByRole("button", { name: "Retry loading", exact: true })).toHaveCount(0);
  });
}

test("an active damaged model can be repaired without enabling removal", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.settings.modelPath = "/broken";
    state.snapshot.models = [
      {
        id: "tiny",
        name: "Whisper Tiny",
        description: "",
        size: 100,
        diskBytes: 100,
        path: "/broken",
        installed: false,
        removable: true,
      },
    ];
  });
  await page.goto("/#/models");
  await expect(
    (await modelMenu(page, "Whisper Tiny")).getByRole("menuitem", {
      name: "Remove model",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Repair & use", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs))
    .toEqual(["tiny"]);
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.history();
  });
  await expectActiveModel(currentSpeechModel(page));
  await expect(
    (await modelMenu(page, "Whisper Tiny")).getByRole("menuitem", {
      name: "Remove model",
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("an outdated backend keeps the interface visible and recovers after restart", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.dictationTest.legacySnapshot = true;
  });
  await page.goto("/#/prompts?section=models");
  await expect(page.getByRole("alert").filter({ hasText: "different versions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompts & chains", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Enable text processing" })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.legacySnapshot = false;
  });
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Enable text processing" })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.legacySnapshot = true;
    window.dictationTest.history();
  });
  await expect(page.getByRole("alert").filter({ hasText: "different versions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompts & chains", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("local models can be selected without changing saved preferences until Save", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.textModels = ["gemma", "llama:8b"];
  });
  await page.goto("/#/prompts?section=models");
  await expect(
    page.getByText("2 models found. Test your selection.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("My cleanup");
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "Model", exact: true });
  await picker.click();
  await page.getByRole("option", { name: "llama:8b", exact: true }).click();
  await expect(picker).toContainText("llama:8b");
  await expect(page.getByLabel("Model identifier")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.model))
    .toBe("");
  await page.getByRole("switch", { name: "Enable text processing" }).check();
  await expect(page.getByRole("button", { name: "Test model", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My cleanup");
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.model))
    .toBe("llama:8b");
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Model responded successfully." }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("model-picker.png"),
    fullPage: true,
  });
  await picker.click();
  await page.getByRole("option", { name: "Enter model ID manually", exact: true }).click();
  await expect(page.getByLabel("Model identifier")).toHaveValue("llama:8b");
});

test("server presets discover LM Studio and auto-save valid choices", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.textModels = ["ollama-model"];
    window.dictationTest.snapshot.textProcessing.model = "ollama-model";
  });
  await page.goto("/#/prompts?section=models");
  const server = page.getByRole("combobox", { name: "Server", exact: true });
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(server).toContainText("Ollama");
  await expect(model).toContainText("ollama-model");
  await showServerAddress(page);
  await page.getByLabel("Local server URL").fill("http://10.5.0.2:1234/api/v1/models");
  await expect(server).toContainText("Custom");
  await page.evaluate(() => {
    window.dictationTest.textModels = ["lm-studio-model"];
  });
  await server.click();
  await page.getByRole("option", { name: "LM Studio", exact: true }).click();
  await expect(page.getByLabel("Local server URL")).toHaveValue("http://127.0.0.1:1234/v1");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.modelListRequests.at(-1)?.endpoint))
    .toBe("http://127.0.0.1:1234/v1");
  await expect(page.getByText(/This model is not listed/)).toBeVisible();
  await expect(page.getByLabel("Model identifier")).toHaveValue("ollama-model");
  await model.click();
  await page.getByRole("option", { name: "lm-studio-model", exact: true }).click();
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.endpoint))
    .toBe("http://127.0.0.1:1234/v1");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.model))
    .toBe("lm-studio-model");
  await page.screenshot({
    path: testInfo.outputPath("server-picker.png"),
    fullPage: true,
  });
  await server.click();
  await page.getByRole("option", { name: "Ollama", exact: true }).click();
  await expect(page.getByLabel("Local server URL")).toHaveValue("http://127.0.0.1:11434/v1");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(server).toContainText("LM Studio");
  await expect(page.getByLabel("Local server URL")).toHaveValue("http://127.0.0.1:1234/v1");
  await server.click();
  await page.getByRole("option", { name: "Custom", exact: true }).click();
  await expect(server).toContainText("Custom");
  await page.getByLabel("Local server URL").fill("http://localhost:7777/v1");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.modelListRequests.at(-1)?.endpoint))
    .toBe("http://localhost:7777/v1");
  await server.click();
  await page.getByRole("option", { name: "llama-server", exact: true }).click();
  await expect(page.getByLabel("Local server URL")).toHaveValue("http://127.0.0.1:8080/v1");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.modelListRequests.at(-1)?.endpoint))
    .toBe("http://127.0.0.1:8080/v1");
  await saveDraft(page);
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.endpoint)).toBe(
    "http://127.0.0.1:8080/v1",
  );
});

test("discovery keeps manual IDs across failures, empty lists, missing models and retries", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.model = "old-model";
    state.modelListError = "Could not reach server. Start it and refresh models.";
  });
  await page.goto("/#/prompts?section=models");
  await expect(
    page.getByRole("alert").filter({ hasText: "Start it and refresh models" }),
  ).toBeVisible();
  await expect(page.getByLabel("Model identifier")).toHaveValue("old-model");
  await page.getByLabel("Model identifier").fill("custom-model");
  await page.evaluate(() => {
    window.dictationTest.modelListError = "";
  });
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await expect(page.getByText(/No models listed/)).toBeVisible();
  await expect(page.getByLabel("Model identifier")).toHaveValue("custom-model");
  await page.evaluate(() => {
    window.dictationTest.textModels = ["available-model"];
  });
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await expect(page.getByText(/This model is not listed/)).toBeVisible();
  await expect(page.getByLabel("Model identifier")).toHaveValue("custom-model");
  await page.evaluate(() => {
    window.dictationTest.modelListError = "Server stopped. Start it and refresh models.";
  });
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Server stopped" })).toBeVisible();
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await expect(page.getByRole("option", { name: "available-model", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Model identifier")).toHaveValue("custom-model");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.model))
    .toBe("old-model");
});

test("endpoint changes and navigation cancel discovery and ignore late model lists", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.deferModelList = true;
  });
  await page.goto("/#/prompts?section=models");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.pendingModelLists.length))
    .toBe(1);
  await page.getByRole("combobox", { name: "Server", exact: true }).click();
  await page.getByRole("option", { name: "LM Studio", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.pendingModelLists.length))
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.cancelledProcessing.includes(
          window.dictationTest.pendingModelLists[0].id,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.dictationTest.pendingModelLists[1].resolve(["current-server-model"]);
    window.dictationTest.pendingModelLists[0].resolve(["stale-server-model"]);
  });
  await expect(
    page.getByText("1 model found. Test your selection.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await expect(page.getByRole("option", { name: "stale-server-model", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("option", { name: "current-server-model", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Model", exact: true })).toContainText(
    "current-server-model",
  );
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.pendingModelLists.length))
    .toBe(3);
  await navigateMain(page, "History");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.cancelledProcessing.includes(
          window.dictationTest.pendingModelLists[2].id,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    window.dictationTest.pendingModelLists[2].resolve(["late-after-navigation"]);
  });
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.model))
    .toBe("current-server-model");
});

test("older backends show discovery restart guidance without hiding Prompts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "ListTextModels");
  });
  await page.goto("/#/prompts?section=models");
  await expect(page.getByRole("alert").filter({ hasText: "restart wails3 dev" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompts & chains", exact: true })).toBeVisible();
  await page.getByLabel("Model identifier").fill("manual-model");
  expect(errors).toEqual([]);
});

test("render crashes show copyable recovery and retry preserves saved data", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.settings.language = "de";
    state.snapshot.settings.cleanText = true;
    state.snapshot.history = [
      {
        id: "kept",
        createdAt: "2026-10-07T10:00:00Z",
        durationMs: 2000,
        rawTranscript: "PRIVATE_HISTORY_CONTENT",
        finalTranscript: "Saved correction",
        speechModel: "base",
        language: "de",
        audioPath: "",
      },
    ];
    state.snapshot.vocabulary = [
      {
        id: "term",
        canonical: "PRIVATE_VOCABULARY",
        aliases: [],
        enabled: true,
      },
    ];
    Reflect.set(state, "recoveryModelPath", state.snapshot.settings.modelPath);
    Reflect.set(state.snapshot.settings, "modelPath", { invalid: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /couldn.t display the interface/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry interface", exact: true })).toBeFocused();
  await page.getByText("Technical details", { exact: true }).click();
  const details = page.getByLabel("Diagnostic details");
  await expect(details).toHaveValue(/Interface rendering/);
  await expect(details).toHaveValue(/split/);
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Diagnostics copied.");
  const report = await page.evaluate(() => window.dictationTest.clipboard);
  expect(report).toContain("HomePage");
  expect(report).not.toContain("PRIVATE_HISTORY_CONTENT");
  expect(report).not.toContain("PRIVATE_VOCABULARY");
  await page.screenshot({
    path: testInfo.outputPath("interface-recovery.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.modelPath = Reflect.get(
      window.dictationTest,
      "recoveryModelPath",
    );
    // The mock creates its default profile on first snapshot. Repair the
    // derived invalid path too, while leaving saved preferences/text intact.
    for (const profile of window.dictationTest.snapshot.dictationProfiles ?? []) {
      if (typeof profile.modelPath !== "string")
        profile.modelPath = window.dictationTest.snapshot.settings.modelPath;
    }
  });
  await page.getByRole("button", { name: "Retry interface", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dictation recorder", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "History", exact: true })
    .click();
  await expect(page.getByRole("link").filter({ hasText: "Saved correction" })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Spoken language", exact: true })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("German");
  await expect(page.getByRole("switch", { name: /^Light cleanup/ })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript))
    .toBe("PRIVATE_HISTORY_CONTENT");
});

test("persistent crashes stay recoverable and window reload keeps persisted preferences", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    const saved = sessionStorage.getItem("saved-recovery-fixture");
    if (saved) state.snapshot = JSON.parse(saved);
    else {
      state.snapshot.settings.language = "de";
      state.snapshot.settings.saveAudio = true;
      state.snapshot.history = [
        {
          id: "kept",
          createdAt: "2026-10-07T10:00:00Z",
          durationMs: 1000,
          rawTranscript: "Persisted history",
          finalTranscript: "Persisted history",
          speechModel: "base",
          language: "de",
          audioPath: "",
        },
      ];
      sessionStorage.setItem("saved-recovery-fixture", JSON.stringify(state.snapshot));
      localStorage.setItem("desktop-theme", "dark");
      localStorage.setItem("yap-sidebar-collapsed", "true");
      Reflect.set(state.snapshot.settings, "modelPath", { invalid: true });
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /couldn.t display the interface/ })).toBeVisible();
  await page.getByRole("button", { name: "Retry interface", exact: true }).click();
  await expect(page.getByRole("heading", { name: /couldn.t display the interface/ })).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Reload window", exact: true }).click(),
  ]);
  await expect(page.getByRole("region", { name: "Dictation recorder", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "History", exact: true })
    .click();
  await expect(page.getByRole("link").filter({ hasText: "Persisted history" })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Spoken language", exact: true })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("German");
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  await expect(page.getByRole("switch", { name: /^Keep recordings/ })).toBeChecked();
});

test("provider failures recover outside app context and clipboard failure supports manual copying", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.failClipboard = true;
    window.matchMedia = () => {
      throw new Error("Theme provider failed");
    };
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /couldn.t display the interface/ })).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.getByLabel("Diagnostic details")).toHaveValue(/Theme provider failed/);
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not copy" })).toBeVisible();
  const details = page.getByLabel("Diagnostic details");
  await expect(details).toBeFocused();
  expect(
    await details.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart),
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.dictationTest.failClipboard = false;
  });
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Diagnostics copied.");
  await expect(page.getByRole("alert").filter({ hasText: "Could not copy" })).toHaveCount(0);
});

test("startup recovery provides diagnostics and retry without overwriting saved configuration", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.failSnapshot = true;
    state.snapshot.settings.language = "de";
    state.snapshot.textProcessing.model = "saved-model";
    state.snapshot.textProcessing.enabled = true;
  });
  await page.goto("/#/prompts?section=models");
  await expect(page.getByRole("region", { name: "Connection recovery" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Enable text processing" })).toBeDisabled();
  await page.getByText("Technical details", { exact: true }).click();
  await page.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.clipboard))
    .toContain("Backend connection");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.clipboard))
    .toContain("Snapshot unavailable");
  await page.evaluate(() => {
    window.dictationTest.failSnapshot = false;
  });
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByRole("region", { name: "Connection recovery" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Enable text processing" })).toBeChecked();
  await expect(page.getByLabel("Model identifier")).toHaveValue("saved-model");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
    .toBe("de");
});

async function setupBackupPreview(page: Page) {
  await page.addInitScript(() => {
    window.dictationTest.backupPreview = {
      id: "preview-token",
      filename: "yap-mac.yap-backup.zip",
      createdAt: "2026-10-08T12:30:00Z",
      preferences: {
        language: "de",
        interaction: "toggle",
        autoPaste: false,
        autoCopy: true,
        saveAudio: true,
        cleanText: true,
      },
      summary: {
        sessions: 10,
        duplicateSessions: 2,
        outputs: 3,
        duplicateOutputs: 1,
        prompts: 1,
        skippedPrompts: 2,
        vocabulary: 4,
        skippedVocabulary: 1,
        recordings: 2,
        missingRecordings: 0,
      },
    };
  });
}

test("backups export optional audio and require a preview before a merge restore", async ({
  page,
}, testInfo) => {
  await setupBackupPreview(page);
  await page.goto("/#/settings?section=history");
  const panel = page.getByRole("region", {
    name: "Backup & restore",
    exact: true,
  });
  await panel.getByRole("button", { name: "Export backup", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "12 dictations, 3 outputs, and 0 recordings",
  );
  await panel.getByRole("checkbox", { name: "Include retained recordings", exact: true }).check();
  await panel.getByRole("button", { name: "Export backup", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("1 unavailable recordings omitted");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.backupExports))
    .toEqual([false, true]);
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Restore backup?",
    exact: true,
  });
  await expect(dialog).toContainText("10 to add · 2 kept / skipped");
  await expect(dialog).toContainText(
    "Microphone, shortcuts, models, startup, local server, and History retention stay unchanged",
  );
  await expect(
    dialog.getByRole("checkbox", {
      name: "Restore portable preferences",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.dictationTest.backupRestores)).toEqual([]);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: testInfo.outputPath("backup-preview.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 520, height: 720 });
  await page.screenshot({
    path: testInfo.outputPath("backup-preview-narrow.png"),
    animations: "disabled",
  });
  const bounds = await dialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.discardedBackups))
    .toEqual(["preview-token"]);
  await expect(activeDialog(page)).toHaveCount(0);
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await dialog.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Restored 10 dictations, 3 outputs, 1 prompts, and 4 terms",
  );
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.backupRestores))
    .toEqual([{ id: "preview-token", preferences: false }]);
  await expect(page.getByLabel("Spoken language", { exact: true })).toContainText(
    "Detect automatically",
  );
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await dialog
    .getByRole("checkbox", {
      name: "Restore portable preferences",
      exact: true,
    })
    .check();
  await dialog.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(page.getByLabel("Spoken language", { exact: true })).toContainText("German");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await navigateMain(page, "History");
  await expect(page.getByRole("link", { name: /Restored transcription/ }).first()).toBeVisible();
});

test("backup errors, busy state, unsaved settings and native cancellation preserve data", async ({
  page,
}) => {
  await setupBackupPreview(page);
  await page.goto("/#/settings?section=history");
  const panel = page.getByRole("region", {
    name: "Backup & restore",
    exact: true,
  });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByRole("switch", { name: /^Keep recordings/ }).check();
  await expect(page.getByText("Changes not saved", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Restore backup", exact: true })).toBeDisabled();
  await expect(
    panel.getByText("Finish saving settings before using backups.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Restore backup", exact: true })).toBeEnabled();
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(panel.getByRole("button", { name: "Export backup", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.failBackup = true;
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Unsupported or damaged backup");
  await page.evaluate(() => {
    window.dictationTest.failBackup = false;
    window.dictationTest.backupPreview = null;
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Restore backup?", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.dictationTest.backupRestores)).toEqual([]);
});

test("failed restores keep the preview for retry and navigation discards late previews", async ({
  page,
}) => {
  await setupBackupPreview(page);
  await page.goto("/#/settings?section=history");
  const panel = page.getByRole("region", {
    name: "Backup & restore",
    exact: true,
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Restore backup?",
    exact: true,
  });
  await page.evaluate(() => {
    window.dictationTest.failBackup = true;
  });
  await dialog.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Restore failed; no changes were saved");
  await expect(dialog.getByRole("button", { name: "Restore backup", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.failBackup = false;
  });
  await dialog.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.deferBackup = true;
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.resolveBackup)).toBe(true);
  await navigateMain(page, "History");
  await page.evaluate(() => {
    window.dictationTest.resolveBackup!();
  });
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.discardedBackups))
    .toEqual(["preview-token"]);
});

test("an outdated backup backend provides restart guidance without hiding Settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "PreviewBackup");
  });
  await page.goto("/#/settings?section=history");
  const panel = page.getByRole("region", {
    name: "Backup & restore",
    exact: true,
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("restart wails3 dev");
  await expect(page.getByRole("tablist", { name: "Settings sections", exact: true })).toBeVisible();
});

test("backup cancellation remains available after navigating back to Settings", async ({
  page,
}) => {
  await setupBackupPreview(page);
  await page.goto("/#/settings?section=history");
  const panel = page.getByRole("region", {
    name: "Backup & restore",
    exact: true,
  });
  await page.evaluate(() => {
    window.dictationTest.deferBackup = true;
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.resolveBackup)).toBe(true);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("backup");
    state.snapshot.status.message = "Checking backup…";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await navigateMain(page, "History");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Checking backup…");
  await expect(panel.getByRole("button", { name: "Export backup", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Cancel operation", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.phase))
    .toBe("idle");
  await expect(panel.getByRole("button", { name: "Restore backup", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.resolveBackup!();
  });
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.discardedBackups))
    .toEqual(["preview-token"]);
  await expect(activeDialog(page)).toHaveCount(0);
});

async function dropAudioFiles(page: Page, paths: string[]) {
  await page.evaluate((paths) => {
    const transfer = new DataTransfer();
    for (const path of paths) transfer.items.add(new File(["audio"], path.split(/[/\\]/).pop()!));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
    window.dictationTest.callbacks["wails:file-drop"](100, 100, paths);
  }, paths);
}

test("audio drag and drop ignores native broadcasts from another window", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.callbacks["wails:file-drop"](100, 100, ["C:\\Audio\\meeting.wav"]);
  });
  await settle(page);
  expect(await page.evaluate(() => window.dictationTest.droppedAudio)).toEqual([]);
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await expect(page.locator('[data-slot="toast"][data-type="error"]')).toHaveCount(0);
});

test("audio drag and drop shows feedback and imports across navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["audio"], "meeting.wav", { type: "audio/wav" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, cancelable: true }));
    document.getElementById("main-content")!.dispatchEvent(
      new DragEvent("dragenter", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    document
      .getElementById("main-content")!
      .dispatchEvent(new DragEvent("dragleave", { dataTransfer: transfer, bubbles: true }));
  });
  const overlay = page.getByRole("status").filter({ hasText: "Drop audio files to import" });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Up to 25 minutes · 256 MiB");
  await page.screenshot({
    path: testInfo.outputPath("audio-drop-overlay.png"),
    animations: "disabled",
  });
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["audio"], "meeting.wav"));
    const event = new DragEvent("drop", {
      dataTransfer: transfer,
      cancelable: true,
    });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error("File drop would navigate away");
    window.dictationTest.callbacks["wails:file-drop"](100, 100, ["C:\\Audio\\meeting.wav"]);
  });
  await expect(overlay).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.droppedAudio))
    .toEqual([["C:\\Audio\\meeting.wav"]]);
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await navigateMain(page, "History");
  await page.getByRole("button", { name: "Cancel current operation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await dropAudioFiles(page, ["C:\\Audio\\interview.mp3"]);
  await expect.poll(() => page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(2);
  expect(await page.evaluate(() => window.dictationTest.audioImports)).toBe(0);
  await navigateMain(page, "History");
  await expect(
    page.getByRole("status").filter({ hasText: "Transcribing imported audio…" }),
  ).toBeVisible();
});

test("audio drag and drop ignores repeated native notifications but accepts the same file in a new drag", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await dropAudioFiles(page, ["C:\\Audio\\meeting.wav"]);
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  // The import RPC has returned and the frontend has refreshed; transcription is still running.
  await settle(page);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["audio"], "meeting.wav"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
    window.dictationTest.callbacks["wails:file-drop"](100, 100, ["C:\\Audio\\meeting.wav"]);
  });
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[data-slot="toast"][data-type="error"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.dictationTest.droppedAudio)).toEqual([
    ["C:\\Audio\\meeting.wav"],
  ]);
  // A new drag queues the same file while the previous import is still active.
  await dropAudioFiles(page, ["C:\\Audio\\meeting.wav"]);
  await expect.poll(() => page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(2);
  await page.evaluate(() => {
    window.dictationTest.status("idle");
  });
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await dropAudioFiles(page, ["C:\\Audio\\meeting.wav"]);
  await expect.poll(() => page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("audio drag and drop rejects invalid files and recovers for retry", async ({ page }) => {
  await page.goto("/#/history");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await dropAudioFiles(page, ["C:\\one.wav", "C:\\two.mp3"]);
  await expect(page.getByRole("alert")).toContainText("drop one audio file at a time");
  await dropAudioFiles(page, ["C:\\notes.txt"]);
  await expect(page.getByRole("alert")).toContainText("choose WAV, MP3");
  await page.evaluate(() => {
    window.dictationTest.failAudioImport = true;
  });
  await dropAudioFiles(page, ["C:\\long.wav"]);
  await expect(page.getByRole("alert")).toContainText("25 minutes");
  expect(await page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(0);
  const errorToast = page.locator('[data-slot="toast"]').filter({ hasText: "25 minutes" });
  await expect(errorToast).toHaveCount(1);
  await page.keyboard.press("F6");
  await errorToast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(errorToast).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.failAudioImport = false;
  });
  await dropAudioFiles(page, ["C:\\retry.flac"]);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.droppedAudio))
    .toEqual([["C:\\retry.flac"]]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("audio drag and drop queues while busy, respects unavailable models and clears drag feedback", async ({
  page,
}) => {
  await page.goto("/#/history");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "ordinary text");
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
  });
  await expect(page.getByText("Drop audio files to import", { exact: true })).toBeHidden();
  await page.evaluate(() => window.dictationTest.status("recording"));
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["audio"], "meeting.wav"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
  });
  const overlay = page.getByRole("status").filter({ hasText: "Drop audio files to import" });
  await expect(overlay).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(overlay).toBeHidden();
  await dropAudioFiles(page, ["C:\\meeting.wav"]);
  await expect.poll(() => page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(1);
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.snapshot.ready = false;
    window.dictationTest.history();
  });
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeDisabled();
  await dropAudioFiles(page, ["C:\\meeting.wav"]);
  await expect(page.getByRole("alert")).toContainText("Choose a speech model");
  expect(await page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(1);
});

test("audio drag and drop reports an outdated backend", async ({ page }) => {
  await page.goto("/#/history");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "ImportDroppedAudio");
  });
  await dropAudioFiles(page, ["C:\\meeting.wav"]);
  await expect(page.getByRole("alert").filter({ hasText: "different versions" })).toBeVisible();
});

test("audio import is cancellable across navigation and results open from History", async ({
  page,
}) => {
  await page.goto("/#/history");
  await page.getByRole("button", { name: "Import audio", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.audioImports)).toBe(1);
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Transcribing imported audio…" }),
  ).toBeVisible();
  await navigateMain(page, "Dictate");
  await expect(page.getByRole("button", { name: "Transcribing…", exact: true })).toBeDisabled();
  await navigateMain(page, "History");
  await page.getByRole("button", { name: "Cancel current operation", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.phase))
    .toBe("idle");
  await expect(page.getByText("No dictations yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import audio", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.history.push({
      id: "imported",
      createdAt: new Date().toISOString(),
      durationMs: 1000,
      rawTranscript: "Imported words.",
      finalTranscript: "Imported words.",
      speechModel: "base",
      language: "auto",
      audioPath: "",
    });
    state.status("done");
    state.history();
  });
  await page.getByRole("link", { name: /Imported words/ }).click();
  await expect(page.getByRole("heading", { name: "Transcription", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Transcription", exact: true })
      .getByText("Imported words.", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.dictationTest.clipboard)).toBe("");
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await page.getByRole("button", { name: "Import audio", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("error");
    state.snapshot.status.message = "WAV file is truncated or damaged";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(page.getByRole("alert")).toContainText("WAV file is truncated or damaged");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
});

test("audio import handles file-picker cancellation, unavailable models, invalid files and outdated backends", async ({
  page,
}) => {
  await page.goto("/#/history");
  const button = page.getByRole("button", {
    name: "Import audio",
    exact: true,
  });
  await expect(button).toHaveAttribute("title", /WAV, MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, WMA/);
  await expect(button).toHaveAttribute("title", /up to 25 minutes/);
  await page.evaluate(() => {
    window.dictationTest.cancelAudioDialog = true;
  });
  await button.click();
  await expect(button).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(0);
  await page.evaluate(() => {
    window.dictationTest.snapshot.ready = false;
    window.dictationTest.history();
  });
  await expect(button).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.snapshot.ready = true;
    window.dictationTest.failAudioImport = true;
    window.dictationTest.history();
  });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Choose an uncompressed mono or stereo WAV");
  await page.evaluate(() => {
    Reflect.deleteProperty(Reflect.get(window, "mockBackend").main.App, "ImportAudio");
  });
  await button.click();
  await expect(page.getByRole("alert").filter({ hasText: "different versions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
});

test("audio import shows missing decoder guidance and allows retry", async ({ page }) => {
  await page.goto("/#/history");
  const button = page.getByRole("button", {
    name: "Import audio",
    exact: true,
  });
  await button.click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("error");
    state.snapshot.status.message =
      "This audio format requires local FFmpeg. Install FFmpeg, add it to PATH, and reopen Yap. WAV import works without FFmpeg";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(page.getByRole("alert")).toContainText("Install FFmpeg");
  await expect(page.getByRole("alert")).toContainText("WAV import works without FFmpeg");
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.audioImports)).toBe(2);
  await expect(button).toBeEnabled();
});

test("history preference is shared between Home and Settings", async ({ page }) => {
  await page.goto("/");
  await openRecordingOptions(page);
  await page.getByRole("switch", { name: "Save to history" }).click();
  await expect(page.getByRole("switch", { name: "Save to history" })).not.toBeChecked();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "History & data" }).click();
  await expect(page.getByRole("switch", { name: "Save dictations to history" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Keep recordings" })).toBeDisabled();
  await page.getByRole("switch", { name: "Save dictations to history" }).click();
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await expect(page.getByRole("switch", { name: "Save to history" })).toBeChecked();
});

test("temporary latest result supports copy, explicit save, and dismiss", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const snapshot = window.dictationTest.snapshot;
    snapshot.settings.saveHistory = false;
    snapshot.latestResult = {
      text: "Temporary text",
      session: {
        id: "temporary",
        createdAt: new Date().toISOString(),
        durationMs: 1000,
        rawTranscript: "Temporary text",
        finalTranscript: "Temporary text",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    };
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Temporary latest result" });
  await expect(panel).toContainText("Temporary");
  await page.screenshot({
    path: testInfo.outputPath("temporary-latest-result.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe(
    "Temporary text",
  );
  await panel.getByRole("button", { name: "Save to History", exact: true }).click();
  await expect(panel).not.toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(1);
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.saveHistory)).toBe(false);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.latestResult = {
      text: "Discard me",
      session: { ...state.snapshot.history[0], id: "discard" },
    };
    state.history();
  });
  await expect(panel).toContainText("Discard me");
  await panel.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(panel).not.toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(1);
});

test("page drafts flush on navigation and remain saved when returning", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P");
  await navigateMain(page, "Prompts & chains");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+P");
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByLabel("Model identifier").fill("unsaved-local-model");
  await navigateMain(page, "Vocabulary");
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  await page.getByLabel("Preferred spelling", { exact: true }).fill("PostgreSQL");
  await navigateMain(page, "History");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
  await navigateMain(page, "Prompts & chains");
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await expect(page.getByLabel("Model identifier")).toHaveValue("unsaved-local-model");
  await saveDraft(page);
  await navigateMain(page, "Vocabulary");
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveValue("PostgreSQL");
  await saveDraft(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
});

test("delivery warnings persist and recover through the current Home result after clipboard retry", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.snapshot.latestResult = {
      text: "Recovered original text.",
      session: {
        id: "recovery",
        createdAt: new Date().toISOString(),
        durationMs: 1000,
        rawTranscript: "Recovered original text.",
        finalTranscript: "Recovered original text.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    };
    Object.assign(state.snapshot.status, {
      phase: "done",
      completionWarning: true,
      message: "Paste failed; transcript is available",
      transcript: "Recovered original text.",
    });
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    state.failClipboard = true;
  });
  const warning = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Transcript ready — action needed" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("button", { name: "Copy transcript" })).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Temporary latest result", exact: true });
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Couldn’t complete this action");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(5200);
  await expect(warning).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failClipboard = false;
    window.dictationTest.snapshot.status.transcript = "A later result";
  });
  await navigateMain(page, "Dictate");
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.clipboard))
    .toBe("Recovered original text.");
  await expect(panel.getByRole("status")).toContainText("Copied to clipboard");
});

test("dictation profiles create edit switch and delete", async ({ page }, testInfo) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  const editor = profileEditor(page);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(editor.getByLabel("Profile name")).toBeFocused();
  await editor.getByLabel("Profile name").fill("Email");
  await editor.getByRole("combobox", { name: "Spoken language", exact: true }).click();
  await page.getByRole("option", { name: "German", exact: true }).click();
  await editor.getByRole("switch", { name: "Light cleanup" }).check();
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New profile", exact: true })).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
    .toBe("auto");
  await page.getByRole("button", { name: "Edit Email", exact: true }).click();
  await editor.getByLabel("Profile name").fill("Work email");
  await editor.getByRole("button", { name: "Back to profiles", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Work email", exact: true })).toBeFocused();
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await selector.click();
  await page.getByRole("option", { name: "Work email", exact: true }).click();
  await expect(selector).toContainText("Work email");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        language: window.dictationTest.snapshot.settings.language,
        cleanText: window.dictationTest.snapshot.settings.cleanText,
        shortcut: window.dictationTest.snapshot.settings.shortcut,
      })),
    )
    .toEqual({ language: "de", cleanText: true, shortcut: "Ctrl+Alt+Space" });
  await page.setViewportSize({ width: 760, height: 560 });
  await expect(selector).toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("profile-selector-narrow.png") });
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(selector).toBeDisabled();
  await page.evaluate(() => window.dictationTest.status("idle"));
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  const dialog = activeDialog(page);
  await page.getByRole("button", { name: "Delete Work email", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Work email", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete Work email", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Default", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Work email", exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
    .toBe("de");
});

test("profile failures retain drafts and selection and Escape attempts a save", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  const dialog = profileEditor(page);
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await dialog.getByLabel("Profile name").fill("Quick notes");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not save profile");
  await expect(dialog.getByLabel("Profile name")).toHaveValue("Quick notes");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await navigateMain(page, "Dictate");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await selector.click();
  await page.getByRole("option", { name: "Quick notes", exact: true }).click();
  await expect(selector).toContainText("Default");
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Profile model unavailable" }),
  ).toBeVisible();
});

test("inline profile editor keeps dropdown Escape local and saves before Settings closes", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const editor = profileEditor(page);
  await settings.getByRole("button", { name: "New profile", exact: true }).click();
  const language = editor.getByRole("combobox", { name: "Spoken language", exact: true });
  await language.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(language).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "New profile", exact: true })).toBeFocused();

  await settings.getByRole("button", { name: "New profile", exact: true }).click();
  await editor.getByLabel("Profile name").fill("Meeting notes");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.snapshot.dictationProfiles?.filter((p) => p.name === "Meeting notes"),
      ),
    )
    .toEqual([expect.objectContaining({ name: "Meeting notes" })]);

  await openRecordingOptions(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await settings.getByRole("button", { name: "Edit Meeting notes", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await editor.getByLabel("Profile name").fill("Unsaved meeting notes");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toBeVisible();
  await expect(editor.getByRole("alert")).toContainText("Could not save profile");
  await expect(editor.getByLabel("Profile name")).toHaveValue("Unsaved meeting notes");
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(editor.getByLabel("Profile name")).toHaveValue("Meeting notes");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toHaveCount(0);
});

for (const [lang, width, height, font] of [
  ["en", 878, 807, 100],
  ["de", 878, 807, 100],
  ["en", 480, 600, 200],
  ["de", 480, 600, 200],
] as const) {
  test(`inline profile editor fits settings ${lang} ${width}x${height} ${font}%`, async ({
    page,
  }, testInfo) => {
    const copy = lang === "de" ? de : en;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await homeModelScenario(page);
    await page.evaluate((language) => localStorage.setItem("desktop-language", language), lang);
    await page.goto("/#/settings?section=profiles");
    await page.reload();
    await page.evaluate((size) => (document.documentElement.style.fontSize = `${size}%`), font);
    const settings = page.getByRole("dialog", { name: copy["common.settings"], exact: true });
    await settings
      .getByRole("button", { name: copy["dictationProfiles.newProfile"], exact: true })
      .click();
    const editor = settings.getByRole("region", {
      name: copy["dictationProfiles.newDictationProfile"],
      exact: true,
    });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(editor.getByLabel(copy["dictationProfiles.profileName"])).toBeFocused();
    await expect(settings.locator('[data-slot="profile-card"]:visible')).toHaveCount(0);
    const controls = editor.locator('input:not([aria-hidden="true"]), button, [role="switch"]');
    for (const control of await controls.all()) {
      await control.focus();
      await expect(control).toBeInViewport();
      const geometry = await control.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const pane = node.closest('[data-slot="settings-scroll-pane"]')!.getBoundingClientRect();
        return { left: box.left, right: box.right, paneLeft: pane.left, paneRight: pane.right };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.paneLeft);
      expect(geometry.right).toBeLessThanOrEqual(geometry.paneRight);
    }
    const pane = settings.locator('[data-slot="settings-scroll-pane"]');
    expect(await pane.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await pane.evaluate((node) => node.scrollTo({ top: 0 }));
    await page.screenshot({ path: testInfo.outputPath("inline-profile-editor.png") });
  });
}

test("profile switching rebases untouched settings while keeping the autosaved shortcut", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.dictationProfiles = [
      {
        id: "email",
        name: "Email",
        modelPath: "/base",
        language: "de",
        cleanText: true,
        autoPromptId: "",
      },
    ];
  });
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P");
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await page.getByRole("combobox", { name: "Dictation profile", exact: true }).click();
  await page.getByRole("option", { name: "Email", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Dictation profile", exact: true }),
  ).toContainText("Email");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
  await expect(page.getByRole("combobox", { name: "Spoken language", exact: true })).toContainText(
    "German",
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        model: window.dictationTest.snapshot.settings.modelPath,
        language: window.dictationTest.snapshot.settings.language,
        shortcut: window.dictationTest.snapshot.settings.shortcut,
      })),
    )
    .toEqual({ model: "/base", language: "de", shortcut: "Ctrl+Alt+P" });
});

test("Default is selected from saved settings and unrelated preferences do not mark it modified", async ({
  page,
}) => {
  await homeModelScenario(page);
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await expect(selector).toContainText("Default");
  await expect(selector.getByRole("img", { name: "Modified profile" })).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.settings.microphoneId = "usb";
    state.snapshot.settings.shortcut = "Ctrl+Alt+P";
    state.snapshot.settings.saveHistory = false;
    state.history();
  });
  await expect(selector).toContainText("Default");
  await expect(selector.getByRole("img", { name: "Modified profile" })).toHaveCount(0);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await expect(page.getByRole("button", { name: "Make Default active", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Delete Default", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Default", exact: true }).click();
  await expect(profileEditor(page).getByLabel("Profile name")).toBeDisabled();
  await expect(
    profileEditor(page).getByRole("combobox", { name: "Speech model", exact: true }),
  ).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`modified profile actions preserve the name and restore Default in ${theme}`, async ({
    page,
  }, testInfo) => {
    await homeModelScenario(page);
    await page.evaluate((theme) => localStorage.setItem("desktop-theme", theme), theme);
    await page.reload();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Spoken language", exact: true }).click();
    await page.getByRole("option", { name: "German", exact: true }).click();
    await navigateMain(page, "Dictate");
    await page.setViewportSize({ width: 760, height: 560 });
    await openRecordingOptions(page);
    const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
    await expect(selector).toContainText("Default");
    await expect(selector).not.toContainText("(modified)");
    const marker = page.getByRole("button", { name: "Modified", exact: true });
    await expect(marker).toBeInViewport();
    await marker.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Restore saved choices" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Recording options/ })).toBeFocused();
    await openRecordingOptions(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`modified-profile-${theme}.png`) });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.dictationTest.snapshot.dictationProfiles?.find(
              (p) => p.id === window.dictationTest.snapshot.defaultProfileId,
            )?.language,
        ),
      )
      .toBe("auto");
    await selector.click();
    await page.getByRole("option", { name: "Default", exact: true }).click();
    await expect(marker).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
      .toBe("auto");
  });
}

test("a named profile retains its name and modified marker across navigation and Settings can restore it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.dictationProfiles = [
      {
        id: "email",
        name: "Email",
        modelPath: "/base",
        language: "de",
        cleanText: true,
        autoPromptId: "",
      },
    ];
  });
  await homeModelScenario(page);
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await selector.click();
  await page.getByRole("option", { name: "Email", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.cleanText = false;
    window.dictationTest.history();
  });
  await expect(selector).toContainText("Email");
  await expect(page.getByRole("button", { name: "Modified", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.mouse.move(1, 1);
  await settle(page);
  await page.getByRole("img", { name: "Modified profile" }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Modified");
  await page.getByRole("button", { name: "Make Email active", exact: true }).click();
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await expect(selector).toContainText("Email");
  await expect(page.getByRole("button", { name: "Modified", exact: true })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`setting indicators explain saved and unsaved cleanup changes in ${theme}`, async ({
    page,
  }, testInfo) => {
    await homeModelScenario(page);
    await page.evaluate((theme) => localStorage.setItem("desktop-theme", theme), theme);
    await page.reload();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const cleanup = page.getByRole("switch", { name: /^Light cleanup/ });
    const marker = page.getByRole("img", {
      name: "Light cleanup changed from Default",
      exact: true,
    });
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await expect(marker).toHaveCount(0);
    await page.evaluate(() => {
      window.dictationTest.failSave = true;
    });
    await page.getByRole("tabpanel").getByText("Light cleanup", { exact: true }).click();
    await expect(cleanup).toBeChecked();
    await expect(marker).toBeVisible();
    await expect(page.getByText("Changes not saved", { exact: true })).toBeVisible();
    await marker.hover();
    await expect(tooltip).toContainText("Changed from Default");
    await expect(tooltip).toContainText("Profile: Off");
    await expect(tooltip).toContainText("Current: On");
    await expect(tooltip).toContainText("Not saved yet.");
    expect(await page.evaluate(() => window.dictationTest.snapshot.settings.cleanText)).toBe(false);
    await marker.click();
    await expect(cleanup).toBeChecked();
    await page.mouse.move(1, 1);
    await marker.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(marker).toBeFocused();
    await expect(tooltip).toContainText("Profile: Off");
    await page.keyboard.press("Escape");
    await navigateMain(page, "Vocabulary");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(cleanup).toBeChecked();
    await expect(marker).toBeVisible();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(marker).toHaveCount(0);
    await page.evaluate(() => {
      window.dictationTest.failSave = false;
    });
    await cleanup.check();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText))
      .toBe(true);
    await page.setViewportSize({ width: 760, height: 560 });
    await marker.hover();
    await expect(tooltip).toContainText("Profile: Off");
    await expect(tooltip).toContainText("Current: On");
    await expect(tooltip).not.toContainText("Not saved");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`cleanup-setting-indicator-${theme}.png`),
      animations: "disabled",
    });
    await page.getByRole("tab", { name: "Profiles", exact: true }).click();
    await page.getByRole("button", { name: "Make Default active", exact: true }).click();
    await page.getByRole("tab", { name: "Dictation", exact: true }).click();
    await expect(marker).toHaveCount(0);
    await expect(cleanup).not.toBeChecked();
  });
}

test("setting indicators mark only differing profile fields and use readable language and model names", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P");
  await expect(page.getByRole("img", { name: /changed from Default/ })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Spoken language", exact: true }).click();
  await page.getByRole("option", { name: "German", exact: true }).click();
  const language = page.getByRole("img", {
    name: "Spoken language changed from Default",
    exact: true,
  });
  await language.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Profile: Detect automatically",
  );
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText("Current: German");
  await expect(page.getByRole("img", { name: "Light cleanup changed from Default" })).toHaveCount(
    0,
  );
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await showCustomModelFiles(page);
  await page.getByLabel("Speech model file", { exact: true }).fill("/base");
  const model = page.getByRole("img", { name: "Speech model changed from Default", exact: true });
  await model.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Profile: Whisper Tiny",
  );
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Current: Whisper Base",
  );
  await page.getByLabel("Speech model file", { exact: true }).fill("/tiny");
  await expect(model).toHaveCount(0);
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await page.getByRole("combobox", { name: "Spoken language", exact: true }).click();
  await page.getByRole("option", { name: "Detect automatically", exact: true }).click();
  await expect(language).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.dictationProfiles!.push({
      id: "email",
      name: "Email",
      modelPath: "/base",
      language: "de",
      cleanText: true,
      autoPromptId: "",
    });
    state.history();
  });
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Make Email active", exact: true }).click();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await expect(page.getByRole("switch", { name: /^Light cleanup/ })).toBeChecked();
  await expect(page.getByRole("img", { name: /changed from/ })).toHaveCount(0);
  await page.getByRole("switch", { name: /^Light cleanup/ }).uncheck();
  await expect(page.getByRole("img", { name: "Light cleanup changed from Email" })).toBeVisible();
});

test("automatic prompt indicator explains the selected prompt and follows save discard and profile restore", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
    window.dictationTest.snapshot.textProcessing.autoPromptId = "cleanup";
  });
  await homeModelScenario(page);
  await navigateMain(page, "Prompts & chains");
  const automatic = page.getByRole("switch", { name: "Run after dictation", exact: true });
  const marker = page.getByRole("img", {
    name: "Run after dictation changed from Default",
    exact: true,
  });
  const tooltip = page.locator('[data-slot="tooltip-content"]');
  await expect(automatic).toBeChecked();
  await expect(marker).toHaveCount(0);
  await automatic.uncheck();
  await marker.hover();
  await expect(tooltip).toContainText("Profile: Cleanup");
  await expect(tooltip).toContainText("Current: No automatic processing");
  await expect(tooltip).toContainText("Not saved yet.");
  await marker.click();
  await expect(automatic).not.toBeChecked();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(automatic).toBeChecked();
  await expect(marker).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Saved prompts", exact: true })
    .getByRole("button", { name: "Summary", exact: true })
    .click();
  // Viewing another prompt does not change the automatic choice.
  await expect(automatic).not.toBeChecked();
  await expect(marker).toHaveCount(0);
  await automatic.check();
  await marker.hover();
  await expect(tooltip).toContainText("Profile: Cleanup");
  await expect(tooltip).toContainText("Current: Summary");
  await saveDraft(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Changes save automatically" }),
  ).toBeVisible();
  await marker.hover();
  await expect(tooltip).toContainText("Current: Summary");
  await expect(tooltip).not.toContainText("Not saved");
  await page.setViewportSize({ width: 760, height: 560 });
  await expect(marker).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Make Default active", exact: true }).click();
  await navigateMain(page, "Prompts & chains");
  await expect(marker).toHaveCount(0);
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId)).toBe(
    "cleanup",
  );
});

test("prompt chains can be saved with explicit sources and selected for automatic processing", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.snapshot.textProcessing.prompts.push({
      id: "email",
      name: "Email",
      instruction: "Write an email.",
    });
  });
  await page.goto("/#/prompts?section=chains");
  await page.getByRole("button", { name: "Add chain", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chain name", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Chain name", exact: true }).fill("Meeting follow-up");
  await expect(page.getByRole("combobox", { name: "Step 1 input", exact: true })).toContainText(
    "Original transcription",
  );
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByRole("menuitem", { name: "Summary", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Step 2 input", exact: true })).toContainText(
    "Step 1: Cleanup",
  );
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByRole("menuitem", { name: "Email", exact: true }).click();
  await page.getByRole("combobox", { name: "Step 3 input", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Original transcription", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: "Saved transcript", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Step 2: Summary", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Step 1: Cleanup", exact: true }).click();
  await page.getByRole("button", { name: "Step 1 actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Remove step 1", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Move step 1 down", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("This is already the first step.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Later steps use this result. Keep it before them.", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: "Run chain after dictation", exact: true }).check();
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains?.[0].name))
    .toBe("Meeting follow-up");
  const saved = await page.evaluate(() =>
    structuredClone(window.dictationTest.snapshot.textProcessing),
  );
  expect(saved.chains![0].steps[2].input).toBe(`step:${saved.chains![0].steps[0].id}`);
  expect(saved.autoPromptId).toBe(saved.chains![0].id);
  await page.screenshot({ path: testInfo.outputPath("prompt-chain-editor.png"), fullPage: true });
  await page.setViewportSize({ width: 760, height: 560 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect(
    page.locator('header[aria-label="Prompts & chains"]').getByRole("status"),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("prompt-chain-editor-narrow.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await navigateMain(page, "History");
  await navigateMain(page, "Prompts & chains");
  await page.getByRole("tab", { name: "Chains", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Chain name", exact: true })).toHaveValue(
    "Meeting follow-up",
  );
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await promptAction(page, "Delete prompt");
  const dialog = page.getByRole("dialog", { name: "Delete this prompt?", exact: true });
  await expect(dialog).toContainText("Meeting follow-up");
  await expect(dialog.getByRole("button", { name: "Delete prompt", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Chains", exact: true }).click();
  await page.getByRole("button", { name: "Delete chain", exact: true }).click();
  await activeDialog(page).getByRole("button", { name: "Delete chain", exact: true }).click();
  await saveDraft(page);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
    .toBe("");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains))
    .toEqual([]);
});

test("manual prompt chains retain intermediate results and show their input sources", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.snapshot.textProcessing.prompts.push({
      id: "email",
      name: "Email",
      instruction: "Write an email.",
    });
    state.snapshot.textProcessing.chains = [
      {
        id: "follow-up",
        name: "Follow-up",
        steps: [
          { id: "a", promptId: "cleanup", input: "original" },
          { id: "b", promptId: "summary", input: "step:a" },
          { id: "c", promptId: "email", input: "step:a" },
        ],
      },
    ];
    state.snapshot.history = [
      {
        id: "chain",
        createdAt: "2026-10-15T12:00:00Z",
        durationMs: 1000,
        rawTranscript: "Raw speech.",
        finalTranscript: "Edited transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history/chain");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "New output", exact: true }).click();
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  const chainOption = page.getByRole("option", { name: "Follow-up", exact: true });
  await expect(chainOption.locator("svg.lucide-workflow")).toHaveCount(1);
  await expect(chainOption).toHaveAttribute("aria-description", "Prompt chain");
  await chainOption.click();
  const outputPicker = page.getByRole("combobox", { name: "Output prompt", exact: true });
  await expect(outputPicker.locator("svg.lucide-workflow")).toHaveCount(1);
  await expect(outputPicker).not.toContainText("(chain)");
  await generateWith(page, "Run chain");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Raw speech.");
  await expect(page.getByText("Step 1 of 3 · Cleanup", { exact: true })).toBeVisible();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Cleaned speech."));
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
    .toBe("summary");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Cleaned speech.");
  await expect(page.getByRole("article", { name: "Cleanup output", exact: true })).toContainText(
    "Step 1 of 3",
  );
  await page.evaluate(() => window.dictationTest.processing!.resolve("A short summary."));
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
    .toBe("email");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Cleaned speech.");
  await page.evaluate(() =>
    window.dictationTest.processing!.resolve("Dear team, here is the follow-up."),
  );
  await expect(
    page.getByText("Chain complete. All step results saved.", { exact: true }),
  ).toBeVisible();
  const email = page.getByRole("article", { name: "Email output", exact: true });
  await expect(email).toContainText("Input: Step 1: Cleanup");
  await selectSavedOutput(page, 1);
  await expect(page.getByRole("article", { name: "Summary output", exact: true })).toContainText(
    "A short summary.",
  );
  await selectSavedOutput(page, 2);
  await expect(page.getByRole("article", { name: "Cleanup output", exact: true })).toContainText(
    "Cleaned speech.",
  );
  expect(await page.evaluate(() => window.dictationTest.clipboard)).toBe("");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    "Edited transcript.",
  );
  await page.screenshot({ path: testInfo.outputPath("prompt-chain-results.png"), fullPage: true });
});

for (const chain of [false, true]) {
  test(`opening the transcript editor keeps ${chain ? "a chain" : "an output"} generation running`, async ({
    page,
  }) => {
    await page.addInitScript((chain) => {
      const state = window.dictationTest;
      state.snapshot.textProcessing.enabled = true;
      state.snapshot.textProcessing.model = "local-model";
      if (chain)
        state.snapshot.textProcessing.chains = [
          {
            id: "review-chain",
            name: "Review chain",
            steps: [
              { id: "a", promptId: "cleanup", input: "original" },
              { id: "b", promptId: "summary", input: "step:a" },
            ],
          },
        ];
      state.snapshot.history = [
        {
          id: "editor-generation",
          createdAt: "2026-11-06T12:00:00Z",
          durationMs: 1000,
          rawTranscript: "Original recording.",
          finalTranscript: "Saved transcript.",
          speechModel: "base",
          language: "en",
          audioPath: "",
        },
      ];
    }, chain);
    await page.goto("/#/history/editor-generation");
    await page.getByRole("tab", { name: "Outputs", exact: true }).click();
    if (chain) {
      await page.getByRole("button", { name: "New output", exact: true }).click();
      await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
      await page.getByRole("option", { name: "Review chain", exact: true }).click();
    }
    await generateWith(page, chain ? "Run chain" : "Generate output");
    await expect.poll(() => page.evaluate(() => !!window.dictationTest.processing)).toBe(true);
    await page.getByRole("button", { name: "Minimize activity pane", exact: true }).click();
    await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
    const editor = page.getByRole("region", { name: "Edit transcript", exact: true });
    await expect(editor).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: "Dictation contents", exact: true }),
    ).toBeHidden();
    await page.evaluate(() => window.dictationTest.processing!.resolve("Cleaned recording."));
    if (chain) {
      await expect
        .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
        .toBe("summary");
      await page.evaluate(() => window.dictationTest.processing!.resolve("A completed summary."));
    }
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.outputs.length))
      .toBe(chain ? 2 : 1);
    expect(await page.evaluate(() => window.dictationTest.cancelledProcessing)).toEqual([]);
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("combobox", { name: /Saved output/ })).toBeVisible();
    await expect(
      page.getByRole("article", { name: chain ? "Summary output" : "Cleanup output", exact: true }),
    ).toContainText(chain ? "A completed summary." : "Cleaned recording.");
  });
}

test("copy confirmation ignores a reply for a different transcript tab", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "delayed-copy",
        createdAt: "2026-11-06T12:00:00Z",
        durationMs: 1000,
        rawTranscript: "Original recording.",
        finalTranscript: "Edited transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    Reflect.get(window, "mockBackend").main.App.CopyText = (text: string) =>
      new Promise<void>((resolve) => {
        Reflect.set(window, "finishDelayedCopy", () => {
          window.dictationTest.clipboard = text;
          resolve();
        });
      });
  });
  await page.goto("/#/history/delayed-copy");
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  const originalCopy = page.getByRole("button", { name: "Copy original", exact: true });
  await expect(originalCopy).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, "finishDelayedCopy")());
  await expect(originalCopy).toBeEnabled();
  expect(await originalCopy.textContent()).toBe("Copy");
  expect(await page.evaluate(() => window.dictationTest.clipboard)).toBe("Edited transcript.");
  await originalCopy.click();
  await page.evaluate(() => Reflect.get(window, "finishDelayedCopy")());
  await expect(originalCopy).toHaveText("Copied");
  expect(await page.evaluate(() => window.dictationTest.clipboard)).toBe("Original recording.");
});

test("cancelled manual prompt chains leave completed results available", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.snapshot.textProcessing.chains = [
      {
        id: "notes",
        name: "Notes",
        steps: [
          { id: "a", promptId: "cleanup", input: "original" },
          { id: "b", promptId: "summary", input: "step:a" },
        ],
      },
    ];
    state.snapshot.history = [
      {
        id: "chain",
        createdAt: "2026-10-15T12:00:00Z",
        durationMs: 1000,
        rawTranscript: "Raw speech.",
        finalTranscript: "Edited transcript.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history/chain");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "New output", exact: true }).click();
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  await page.getByRole("option", { name: "Notes", exact: true }).click();
  await generateWith(page, "Run chain");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Raw speech.");
  await page.evaluate(() => window.dictationTest.processing!.resolve("Cleaned speech."));
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.prompt))
    .toBe("summary");
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Late summary."));
  await expect(page.getByRole("alert").filter({ hasText: "Processing cancelled" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Cleanup output", exact: true })).toContainText(
    "Cleaned speech.",
  );
  await expect(page.getByRole("article", { name: "Summary output", exact: true })).toHaveCount(0);
});

test("dictation profiles can select saved prompt chains", async ({ page }) => {
  await homeModelScenario(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.enabled = true;
    state.snapshot.textProcessing.model = "local-model";
    state.snapshot.textProcessing.chains = [
      {
        id: "notes",
        name: "Meeting notes",
        steps: [{ id: "a", promptId: "summary", input: "transcript" }],
      },
    ];
    state.callbacks["setup:changed"]();
  });
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  const dialog = profileEditor(page);
  await dialog.getByLabel("Profile name").fill("Meeting");
  await dialog.getByRole("combobox", { name: "After dictation", exact: true }).click();
  const chainOption = page.getByRole("option", { name: "Meeting notes", exact: true });
  await expect(chainOption.locator("svg.lucide-workflow")).toHaveCount(1);
  await chainOption.click();
  const afterDictation = dialog.getByRole("combobox", { name: "After dictation", exact: true });
  await expect(afterDictation.locator("svg.lucide-workflow")).toHaveCount(1);
  await expect(afterDictation).not.toContainText("(chain)");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.dictationTest.snapshot.dictationProfiles?.find(
            (profile) => profile.name === "Meeting",
          )?.autoPromptId,
      ),
    )
    .toBe("notes");
  await navigateMain(page, "Dictate");
  await openRecordingOptions(page);
  await page.getByRole("combobox", { name: "Dictation profile", exact: true }).click();
  await page.getByRole("option", { name: "Meeting", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
    .toBe("notes");
});

test("temporary prompt chains expose completed results after an interrupted run", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    const session = {
      id: "temporary-chain",
      createdAt: "2026-10-15T12:00:00Z",
      durationMs: 1000,
      rawTranscript: "Original speech.",
      finalTranscript: "Original speech.",
      speechModel: "base",
      language: "en",
      audioPath: "",
    };
    state.snapshot.settings.saveHistory = false;
    state.snapshot.latestResult = {
      session,
      text: session.finalTranscript,
      outputs: [
        {
          id: "cleaned",
          sessionId: session.id,
          createdAt: session.createdAt,
          prompt: state.snapshot.textProcessing.prompts[0],
          input: session.rawTranscript,
          text: "Cleaned result.",
          model: "local-model",
          endpoint: state.snapshot.textProcessing.endpoint,
          chain: {
            runId: "run",
            chainId: "notes",
            name: "Notes",
            stepId: "a",
            step: 1,
            total: 2,
            input: "original",
            sourceOutputId: "",
          },
        },
      ],
    };
  });
  await page.goto("/#/");
  const temporary = page.getByRole("region", { name: "Temporary latest result", exact: true });
  await temporary.getByRole("tab", { name: /^Outputs/ }).click();
  await expect(temporary).toContainText("Step 1: Cleanup");
  await expect(temporary).toContainText("Cleaned result.");
  await temporary.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.clipboard))
    .toBe("Cleaned result.");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history)).toEqual([]);
});

test("profile cards add, keep, and remove automatic apps as badges", async ({ page }, testInfo) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  const apps = page.getByRole("group", { name: "Apps for Default", exact: true });
  await apps.getByRole("combobox", { name: "Add app to Default", exact: true }).click();
  await page.getByRole("option", { name: "Outlook", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.appProfileRules))
    .toEqual([
      { applicationId: "windows:outlook.exe", applicationName: "Outlook", profileId: "default" },
    ]);
  await expect(apps.getByText("Outlook", { exact: true })).toBeVisible();
  await navigateMain(page, "Dictate");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  await expect(apps.getByText("Outlook", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 760, height: 760 });
  await apps.scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath("profile-apps.png") });
  await apps.getByRole("button", { name: "Remove Outlook from Default", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.appProfileRules))
    .toEqual([]);
  await expect(apps.getByText("Outlook", { exact: true })).toHaveCount(0);
});

test("adding an app to another profile moves its badge and the picker names its owner", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    const base = { modelPath: "/tiny", language: "auto", cleanText: false, autoPromptId: "" };
    state.snapshot.dictationProfiles = [
      { ...base, id: "default", name: "Default" },
      { ...base, id: "email", name: "Email" },
      { ...base, id: "casual", name: "Casual" },
      { ...base, id: "technical", name: "Technical" },
    ];
    state.snapshot.defaultProfileId = "default";
    state.snapshot.activeProfileId = "default";
    state.snapshot.appProfileRules = [
      { applicationId: "windows:outlook.exe", applicationName: "Outlook", profileId: "email" },
      { applicationId: "windows:slack.exe", applicationName: "Slack", profileId: "casual" },
    ];
    Reflect.get(window, "mockBackend").main.App.GetProfileApplications = async () => [
      { id: "windows:outlook.exe", name: "Outlook" },
      { id: "windows:slack.exe", name: "Slack" },
      { id: "windows:code.exe", name: "Visual Studio Code" },
    ];
  });
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Profiles", exact: true }).click();
  const email = page.getByRole("group", { name: "Apps for Email", exact: true });
  const technical = page.getByRole("group", { name: "Apps for Technical", exact: true });
  await expect(email.getByText("Outlook", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Apps for Casual", exact: true }).getByText("Slack"),
  ).toBeVisible();

  const add = technical.getByRole("combobox", { name: "Add app to Technical", exact: true });
  await add.click();
  await expect(page.getByRole("option", { name: /^Outlook/ })).toContainText("Email");
  await expect(page.getByRole("option", { name: /^Slack/ })).toContainText("Casual");
  await page.getByRole("option", { name: "Visual Studio Code", exact: true }).click();
  await expect(technical.getByText("Visual Studio Code", { exact: true })).toBeVisible();
  await add.click();
  await page.getByRole("option", { name: /^Outlook/ }).click();
  await expect(technical.getByText("Outlook", { exact: true })).toBeVisible();
  await expect(email.getByText("Outlook", { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.dictationTest.snapshot.appProfileRules?.map((rule) => rule.profileId),
      ),
    )
    .toEqual(["technical", "casual", "technical"]);

  const panel = page
    .getByRole("heading", { name: "Dictation profiles", exact: true })
    .locator("..");
  for (const width of [1140, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      width === 1140,
    );
    await page.mouse.move(0, 0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`profile-apps-${width}.png`) });
  }
});

test("shortcuts are grouped in one section and the cycle shortcut saves automatically", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const shortcuts = page.getByRole("heading", { name: "Shortcuts", exact: true }).locator("..");
  await expect(shortcuts.getByLabel("Global shortcut", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("Recording mode", { exact: true })).toBeVisible();
  const cycle = shortcuts.getByLabel("Cycle profiles shortcut", { exact: true });
  await cycle.fill("Ctrl+Alt+P");
  await expect(page.getByText("Saves when you leave the field", { exact: true })).toBeVisible();
  await cycle.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.profileShortcut))
    .toBe("Ctrl+Alt+P");
  await cycle.fill("");
  await cycle.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.profileShortcut))
    .toBe("");
});

test("cycle shortcut keeps its draft after failure and reports shortcut conflicts", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const cycle = page.getByLabel("Cycle profiles shortcut", { exact: true });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await cycle.fill("Ctrl+Alt+P");
  await cycle.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not save profile automation" }),
  ).toBeVisible();
  await expect(cycle).toHaveValue("Ctrl+Alt+P");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await cycle.fill("Ctrl+Alt+Space");
  await cycle.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: /must use different shortcuts/i }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.snapshot.profileShortcut ?? "")).toBe("");
  await cycle.fill("Ctrl+Alt+P");
  await cycle.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.profileShortcut))
    .toBe("Ctrl+Alt+P");
});

test("recording shows its automatic profile while manual selection stays unchanged", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.dictationProfiles = [
      ...(window.dictationTest.snapshot.dictationProfiles ?? []),
      {
        id: "email-auto",
        name: "Email",
        modelPath: "/base",
        language: "en",
        cleanText: true,
        autoPromptId: "",
      },
    ];
  });
  await homeModelScenario(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status = {
      ...state.snapshot.status,
      phase: "recording",
      profileId: "email-auto",
      startedAt: Date.now(),
    };
    state.callbacks["dictation:status"](state.snapshot.status);
  });
  await openRecordingOptions(page);
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await expect(selector).toContainText("Email");
  await expect(selector).toBeDisabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.phase = "done";
    state.callbacks["dictation:status"](state.snapshot.status);
  });
  await expect(selector).toContainText("Default");
});

for (const theme of ["light", "dark"]) {
  test(`chain editor shows a compact readable sequence in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("desktop-theme", theme);
      const config = window.dictationTest.snapshot.textProcessing;
      config.enabled = true;
      config.model = "local-model";
      config.prompts.push(
        { id: "social", name: "Social post", instruction: "Write a social post." },
        { id: "email", name: "Email", instruction: "Write an email." },
      );
      config.chains = [
        {
          id: "follow-up",
          name: "Meeting follow-up",
          steps: [
            { id: "clean", promptId: "cleanup", input: "original" },
            { id: "sum", promptId: "summary", input: "step:clean" },
            { id: "social", promptId: "social", input: "step:sum" },
            { id: "mail", promptId: "email", input: "step:clean" },
          ],
        },
      ];
    }, theme);
    await page.setViewportSize({ width: 1208, height: 1000 });
    await page.goto("/#/prompts?section=chains");
    const editor = page.getByRole("region", { name: "Prompt chains", exact: true });
    await expect(editor.getByRole("listitem")).toHaveCount(4);
    const chainSelector = await editor
      .getByRole("combobox", { name: "Saved chain", exact: true })
      .boundingBox();
    const chainName = await editor
      .getByRole("textbox", { name: "Chain name", exact: true })
      .boundingBox();
    expect(Math.abs(chainSelector!.y - chainName!.y)).toBeLessThan(1);
    await expect(editor.getByText("Final output", { exact: true })).toHaveCount(1);
    await expect(editor.getByText("Later steps use this result.", { exact: false })).toHaveCount(0);
    await expect(
      editor
        .getByRole("combobox", { name: "Saved chain", exact: true })
        .locator("svg.lucide-workflow"),
    ).toHaveCount(1);
    const row = editor.getByRole("listitem").first();
    expect((await row.boundingBox())!.height).toBeLessThan(120);
    await editor.screenshot({ path: testInfo.outputPath(`chain-editor-${theme}.png`) });
    await page.setViewportSize({ width: 760, height: 600 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect(editor.getByRole("combobox", { name: "Step 4 input", exact: true })).toContainText(
      "Step 1: Cleanup",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`chain-editor-${theme}-narrow.png`),
      fullPage: true,
    });
    await page
      .getByRole("textbox", { name: "Chain name", exact: true })
      .fill("Long chain name ".repeat(5).slice(0, 80));
    await editor.getByRole("combobox", { name: "Step 4 input", exact: true }).click();
    await expect(page.getByRole("option", { name: "Step 4: Email", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Saved transcript", exact: true })).toContainText(
      "Includes saved corrections",
    );
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const longPromptName = "Detailed follow-up ".repeat(5).slice(0, 80);
    await page.evaluate((name) => {
      window.dictationTest.snapshot.textProcessing.prompts.push({
        id: "long",
        name,
        instruction: "Write detailed notes.",
      });
      window.dictationTest.callbacks["setup:changed"]();
    }, longPromptName);
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    const longPrompt = page.getByRole("menuitem", { name: longPromptName, exact: true });
    await expect(longPrompt).toBeVisible();
    const longPromptBounds = (await longPrompt.boundingBox())!;
    expect(longPromptBounds.x).toBeGreaterThanOrEqual(0);
    expect(longPromptBounds.x + longPromptBounds.width).toBeLessThanOrEqual(760);
    await longPrompt.click();
    await expect(page.getByRole("combobox", { name: "Step 5 prompt", exact: true })).toContainText(
      longPromptName,
    );
    await expect(page.getByRole("combobox", { name: "Step 5 input", exact: true })).toContainText(
      "Step 4: Email",
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  });
}

test("chain step picker fits the available space and scrolls to every prompt", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("yap-sidebar-collapsed", "true");
    const config = window.dictationTest.snapshot.textProcessing;
    config.prompts = Array.from({ length: 30 }, (_, index) => ({
      id: `prompt-${index + 1}`,
      name: `Prompt ${index + 1}`,
      instruction: "Process the transcript.",
    }));
    config.chains = [
      {
        id: "scrollable-chain",
        name: "Scrollable chain",
        steps: [{ id: "first", promptId: "prompt-1", input: "original" }],
      },
    ];
  });
  await page.goto("/#/prompts?section=chains");
  const addStep = page.getByRole("button", { name: "Add step", exact: true });
  const menu = page.getByRole("menu");
  const lastPrompt = menu.getByRole("menuitem", { name: "Prompt 30", exact: true });

  for (const [width, height, font] of [
    [1086, 630, 100],
    [760, 400, 100],
    [760, 560, 200],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((font) => {
      document.documentElement.style.fontSize = `${font}%`;
    }, font);
    await addStep.click();
    await expect(menu).toBeVisible();
    await expect
      .poll(() =>
        menu.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.top >= 0 && bounds.bottom <= innerHeight;
        }),
      )
      .toBe(true);
    expect(await menu.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await menu.hover();
    await page.mouse.wheel(0, 2000);
    await expect(lastPrompt).toBeInViewport({ ratio: 1 });
    await expect.poll(() => menu.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");

    await addStep.press("Enter");
    await page.keyboard.press("End");
    await expect(lastPrompt).toBeFocused();
    await expect(lastPrompt).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    const newStep = page.getByRole("combobox", { name: /^Step \d+ prompt$/ }).last();
    await expect(newStep).toContainText("Prompt 30");
    await expect(newStep).toBeFocused();
  }
});

test("chain editor adds prompts with the keyboard and preserves references when managing steps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1086, height: 722 });
  await page.addInitScript(() => {
    const config = window.dictationTest.snapshot.textProcessing;
    config.enabled = true;
    config.model = "local-model";
    config.prompts.push({ id: "email", name: "Email", instruction: "Write an email." });
  });
  await page.goto("/#/prompts?section=chains");
  await page.getByRole("button", { name: "Add chain", exact: true }).click();
  await page.getByRole("textbox", { name: "Chain name", exact: true }).fill("Work notes");
  const addStep = page.getByRole("button", { name: "Add step", exact: true });
  await addStep.focus();
  await page.keyboard.press("Enter");
  const summary = page.getByRole("menuitem", { name: "Summary", exact: true });
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Step 2 prompt", exact: true })).toContainText(
    "Summary",
  );
  await expect(page.getByRole("combobox", { name: "Step 2 prompt", exact: true })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Step 2 input", exact: true })).toContainText(
    "Step 1: Cleanup",
  );
  await addStep.click();
  await page.getByRole("menuitem", { name: "Email", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Step 3 prompt", exact: true })).toBeFocused();
  for (const index of [1, 2, 3]) {
    const prompt = await page
      .getByRole("combobox", { name: `Step ${index} prompt`, exact: true })
      .boundingBox();
    const input = await page
      .getByRole("combobox", { name: `Step ${index} input`, exact: true })
      .boundingBox();
    expect(input!.x).toBeGreaterThan(prompt!.x);
    expect(
      Math.abs(prompt!.y + prompt!.height / 2 - input!.y - input!.height / 2),
    ).toBeLessThanOrEqual(1);
  }
  await page.getByRole("combobox", { name: "Step 3 input", exact: true }).click();
  await page.getByRole("option", { name: "Original transcription", exact: true }).click();
  await page.getByRole("button", { name: "Step 3 actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move step 3 up", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Step 2 prompt", exact: true })).toContainText(
    "Email",
  );
  await expect(page.getByRole("combobox", { name: "Step 3 prompt", exact: true })).toContainText(
    "Summary",
  );
  await expect(page.getByRole("combobox", { name: "Step 3 input", exact: true })).toContainText(
    "Step 1: Cleanup",
  );
  await page.getByRole("button", { name: "Step 2 actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove step 2", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Prompt chains", exact: true }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByRole("combobox", { name: "Step 2 prompt", exact: true })).toContainText(
    "Summary",
  );
  await saveDraft(page);
  const chain = await page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains![0]);
  expect(chain.steps.map((step) => step.promptId)).toEqual(["cleanup", "summary"]);
  expect(chain.steps[1].input).toBe(`step:${chain.steps[0].id}`);
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(addStep).toBeDisabled();
  await expect(page.getByRole("button", { name: "Step 1 actions", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Step 1 input", exact: true })).toBeDisabled();
});

test("auto-save vocabulary keeps submitted aliases without a loop and skips empty new rows", async ({
  page,
}) => {
  await page.goto("/#/vocabulary");
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    const original = app.SaveVocabulary;
    Reflect.set(window, "autoSaveCalls", []);
    app.SaveVocabulary = (entries: VocabularyEntry[]) => {
      Reflect.get(window, "autoSaveCalls").push(entries);
      return original(entries);
    };
  });
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  await page.getByLabel("Preferred spelling", { exact: true }).fill(" Yap ");
  await page.getByLabel("Aliases (comma-separated)").fill("a,b");
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary))
    .toEqual([{ id: expect.any(String), canonical: "Yap", aliases: ["a", "b"], enabled: true }]);
  await expect(
    page.getByRole("status").filter({ hasText: "Changes save automatically" }),
  ).toBeVisible();
  await expect(page.getByLabel("Aliases (comma-separated)").first()).toHaveValue("a,b");
  await expect(page.getByLabel("Preferred spelling", { exact: true }).first()).toHaveValue(" Yap ");
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => Reflect.get(window, "autoSaveCalls").length)).toBe(1);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  await expect(page.getByRole("button", { name: "Save vocabulary" })).toHaveCount(0);
});

test("auto-save pauses invalid vocabulary and prompts, then resumes after correction", async ({
  page,
}) => {
  await page.goto("/#/vocabulary");
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  await page.getByLabel("Aliases (comma-separated)").fill("alias");
  await expect(page.getByRole("alert")).toContainText("1–80 characters");
  await expect(page.getByRole("status").filter({ hasText: "Not saved yet:" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.dictationTest.snapshot.vocabulary)).toEqual([]);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.getByLabel("Preferred spelling", { exact: true }).fill("Yap");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length))
    .toBe(1);
  await navigateMain(page, "Prompts & chains");
  await page.getByLabel("Instructions", { exact: true }).fill("");
  await expect(page.getByRole("status").filter({ hasText: "Not saved yet:" })).toContainText(
    "Cleanup needs instructions",
  );
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
  ).toBe("Clean up text.");
  await page.getByLabel("Instructions", { exact: true }).fill("Correct the draft.");
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
    )
    .toBe("Correct the draft.");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

test("auto-save prompt and chain deletion Undo restores the previous draft and automatic selection", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const config = window.dictationTest.snapshot.textProcessing;
    config.enabled = true;
    config.model = "model";
    config.autoPromptId = "cleanup";
    config.chains = [
      {
        id: "chain",
        name: "Summary chain",
        steps: [{ id: "step", promptId: "summary", input: "original" }],
      },
    ];
  });
  await page.goto("/#/prompts");
  await promptAction(page, "Delete prompt");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete prompt", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.map((p) => p.id)),
    )
    .toEqual(["summary"]);
  await page.keyboard.press("F6");
  await page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Prompt deleted" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
    .toBe("cleanup");
  await page.getByRole("tab", { name: "Chains", exact: true }).click();
  await page.getByRole("button", { name: "Delete chain", exact: true }).click();
  await activeDialog(page).getByRole("button", { name: "Delete chain", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains?.length))
    .toBe(0);
  await page.keyboard.press("F6");
  await page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Chain deleted" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains?.length))
    .toBe(1);
});

for (const kind of ["prompt", "chain"] as const) {
  test(`auto-save ${kind} deletion Undo preserves later edits and automatic selection`, async ({
    page,
  }) => {
    await page.addInitScript((kind) => {
      const config = window.dictationTest.snapshot.textProcessing;
      config.enabled = true;
      config.model = "model";
      config.autoPromptId = kind === "prompt" ? "cleanup" : "chain";
      config.chains =
        kind === "chain"
          ? [
              {
                id: "chain",
                name: "Summary chain",
                steps: [{ id: "step", promptId: "summary", input: "original" }],
              },
            ]
          : [];
    }, kind);
    await page.goto("/#/prompts");
    if (kind === "prompt") await promptAction(page, "Delete prompt");
    else {
      await page.getByRole("tab", { name: "Chains", exact: true }).click();
      await page.getByRole("button", { name: "Delete chain", exact: true }).click();
    }
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: kind === "prompt" ? "Delete prompt" : "Delete chain",
        exact: true,
      })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
      .toBe("");
    await page.getByRole("tab", { name: "Prompts", exact: true }).click();
    await page.getByLabel("Instructions", { exact: true }).fill("Keep edits made after deletion.");
    await page.getByRole("switch", { name: "Run after dictation", exact: true }).check();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
      .toBe(kind === "prompt" ? "summary" : "cleanup");
    await page.keyboard.press("F6");
    await page
      .locator('[data-slot="toast"]')
      .filter({ hasText: kind === "prompt" ? "Prompt deleted" : "Chain deleted" })
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate((kind) => {
          const config = window.dictationTest.snapshot.textProcessing;
          return {
            restored:
              kind === "prompt"
                ? config.prompts.some((prompt) => prompt.id === "cleanup")
                : config.chains?.some((chain) => chain.id === "chain"),
            instruction: config.prompts.find(
              (prompt) => prompt.id === (kind === "prompt" ? "summary" : "cleanup"),
            )?.instruction,
            autoPromptId: config.autoPromptId,
          };
        }, kind),
      )
      .toEqual({
        restored: true,
        instruction: "Keep edits made after deletion.",
        autoPromptId: kind === "prompt" ? "summary" : "cleanup",
      });
  });
}

test("auto-save serializes requests and preserves edits made while a save is pending", async ({
  page,
}) => {
  await page.goto("/#/prompts");
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    const original = app.SaveTextProcessing;
    Reflect.set(window, "autoSaveCalls", []);
    app.SaveTextProcessing = (config: TextProcessing) =>
      new Promise((resolve) => {
        Reflect.get(window, "autoSaveCalls").push(config);
        Reflect.set(window, "finishAutoSave", () => resolve(original(config)));
      });
  });
  const input = page.getByLabel("Instructions", { exact: true });
  await input.fill("First version");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "autoSaveCalls").length)).toBe(1);
  await input.fill("Second version");
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => Reflect.get(window, "autoSaveCalls").length)).toBe(1);
  await page.evaluate(() => Reflect.get(window, "finishAutoSave")());
  await expect(input).toHaveValue("Second version");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "autoSaveCalls").length)).toBe(2);
  await page.evaluate(() => Reflect.get(window, "finishAutoSave")());
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
    )
    .toBe("Second version");
  await expect(
    page.getByRole("status").filter({ hasText: "Changes save automatically" }),
  ).toBeVisible();
});

test("auto-save profile creates once on its first valid save and Done flushes subsequent edits", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  const dialog = profileEditor(page);
  await expect(dialog.getByRole("button", { name: "Save profile" })).toHaveCount(0);
  await dialog.getByLabel("Profile name").fill("Email");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.dictationTest.snapshot.dictationProfiles?.filter((p) => p.name === "Email").length,
      ),
    )
    .toBe(1);
  await expect(dialog).toBeVisible();
  const id = await page.evaluate(
    () => window.dictationTest.snapshot.dictationProfiles?.find((p) => p.name === "Email")?.id,
  );
  await dialog.getByLabel("Profile name").fill("Work email");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.dictationTest.snapshot.dictationProfiles?.filter((p) => p.name !== "Default"),
    ),
  ).toEqual([expect.objectContaining({ id, name: "Work email" })]);
});

test("auto-save transcript stays open, never saves empty text, and Done flushes immediately", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [
      {
        id: "auto",
        createdAt: "2026-10-23T12:00:00Z",
        durationMs: 1000,
        rawTranscript: "Original",
        finalTranscript: "Original",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
  });
  await page.goto("/#/history/auto");
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Edit transcript", exact: true });
  const input = dialog.getByRole("textbox", { name: "Editable text" });
  await input.fill("First correction");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("First correction");
  await expect(dialog).toBeVisible();
  await input.fill("");
  await expect(dialog.getByRole("status").filter({ hasText: "Not saved yet:" })).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    "First correction",
  );
  await input.fill("Close correction");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    "Close correction",
  );
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe(
    "Original",
  );
});

test("auto-save revision history restores prompt content and blocks chains with missing prompts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const config = window.dictationTest.snapshot.textProcessing;
    config.enabled = true;
    config.model = "local-model";
    config.autoPromptId = "other";
    config.chains = [
      {
        id: "chain",
        name: "Chain",
        steps: [{ id: "step", promptId: "summary", input: "original" }],
      },
      {
        id: "other",
        name: "Other chain",
        steps: [{ id: "other-step", promptId: "summary", input: "original" }],
      },
    ];
    const app = Reflect.get(window, "mockBackend").main.App;
    app.GetRevisions = async (kind: string) => [
      {
        id: 1,
        createdAt: "2026-10-22T12:00:00Z",
        updatedAt: "2026-10-22T12:00:00Z",
        value: JSON.stringify(
          kind === "prompt"
            ? { id: "cleanup", name: "Earlier cleanup", instruction: "Earlier instructions" }
            : {
                id: "chain",
                name: "Earlier chain",
                steps: [{ id: "step", promptId: "deleted", input: "original" }],
              },
        ),
      },
    ];
  });
  await page.goto("/#/prompts");
  await page.getByRole("button", { name: "More prompt actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Prompt version history" });
  await expect(history.getByRole("region", { name: "Version preview" })).toContainText(
    "Earlier instructions",
  );
  await history.getByRole("button", { name: "Restore version", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Earlier cleanup");
  await expect
    .poll(() =>
      page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].instruction),
    )
    .toBe("Earlier instructions");
  await page.getByRole("tab", { name: "Chains", exact: true }).click();
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const chainHistory = page.getByRole("dialog", { name: "Chain version history" });
  await expect(chainHistory.getByRole("alert")).toContainText("prompt that no longer exists");
  await expect(chainHistory.getByRole("button", { name: "Restore version" })).toBeDisabled();
  await chainHistory.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").main.App;
    app.GetRevisions = async () => [
      {
        id: 1,
        createdAt: "2026-10-22T12:00:00Z",
        updatedAt: "2026-10-22T12:00:00Z",
        value: JSON.stringify({
          id: "chain",
          name: "Earlier chain",
          steps: [{ id: "step", promptId: "summary", input: "original" }],
        }),
      },
    ];
  });
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  await chainHistory.getByRole("button", { name: "Restore version", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains?.[0].name))
    .toBe("Earlier chain");
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId)).toBe(
    "other",
  );
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.chains?.length),
  ).toBe(2);
});

test("auto-save history restores the vocabulary list and transcript, marks current versions, and retries loading", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.vocabulary = [
      { id: "current", canonical: "Current term", aliases: [], enabled: true },
    ];
    state.snapshot.history = [
      {
        id: "history",
        createdAt: "2026-10-23T12:00:00Z",
        durationMs: 1000,
        rawTranscript: "Original speech",
        finalTranscript: "Current correction",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    const app = Reflect.get(window, "mockBackend").main.App;
    Reflect.set(window, "failRevisionLoad", true);
    app.GetRevisions = async (kind: string) => {
      if (Reflect.get(window, "failRevisionLoad")) throw new Error("History load failed");
      return [
        {
          id: 2,
          createdAt: "2026-10-23T12:00:00Z",
          updatedAt: "2026-10-23T12:00:00Z",
          value:
            kind === "vocabulary"
              ? JSON.stringify(state.snapshot.vocabulary)
              : "Current correction",
        },
        {
          id: 1,
          createdAt: "2026-10-22T12:00:00Z",
          updatedAt: "2026-10-22T12:00:00Z",
          value:
            kind === "vocabulary"
              ? JSON.stringify([
                  {
                    id: "previous",
                    canonical: "Earlier term",
                    aliases: ["earlier"],
                    enabled: true,
                  },
                ])
              : "Earlier correction",
        },
      ];
    };
  });
  await page.goto("/#/vocabulary");
  await page.getByRole("button", { name: "Version history", exact: true }).click();
  const vocabularyHistory = page.getByRole("dialog", { name: "Vocabulary version history" });
  await expect(vocabularyHistory.getByRole("alert")).toHaveText("History load failed");
  await page.evaluate(() => Reflect.set(window, "failRevisionLoad", false));
  await vocabularyHistory.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    vocabularyHistory.getByRole("button", { name: "Restore version", exact: true }),
  ).toBeDisabled();
  await expect(vocabularyHistory.getByText("Current", { exact: true })).toBeVisible();
  await vocabularyHistory
    .getByRole("navigation", { name: "Versions", exact: true })
    .getByRole("button")
    .last()
    .click();
  await page.setViewportSize({ width: 360, height: 720 });
  expect(
    await vocabularyHistory.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("vocabulary-revision-history.png"),
    animations: "disabled",
  });
  await vocabularyHistory.getByRole("button", { name: "Restore version", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].canonical))
    .toBe("Earlier term");
  await page.goto("/#/history/history");
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const editor = page.getByRole("region", { name: "Edit transcript", exact: true });
  await editor.getByRole("button", { name: "Editing tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Transcript version history", exact: true });
  await history
    .getByRole("navigation", { name: "Versions", exact: true })
    .getByRole("button")
    .last()
    .click();
  await expect(history.locator("del")).toContainText("Current");
  await expect(history.locator("ins")).toContainText("Earlier");
  await history.getByRole("button", { name: "Restore version", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Editable text" })).toHaveValue(
    "Earlier correction",
  );
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Earlier correction");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe(
    "Original speech",
  );
});

test("desktop integration: Home retries a conflict once and keeps pending controls stable", async ({
  page,
}) => {
  await homeModelScenario(page);
  const originalShortcut = await page.evaluate(
    () => window.dictationTest.snapshot.settings.shortcut,
  );
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.shortcutError =
      "Synthetic hotkey conflict: combination already registered";
    state.status("idle");
    const control = { calls: 0, release: () => {} };
    Reflect.set(window, "desktopRetry", control);
    Reflect.get(window, "mockBackend").main.App.RetryShortcut = async () => {
      control.calls++;
      await new Promise<void>((resolve) => {
        control.release = resolve;
      });
      state.snapshot.status.shortcutError = "";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    };
  });
  const recovery = page.getByRole("region", { name: "Shortcut recovery" });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Retry shortcut", exact: true }).click();
  const pending = recovery.getByRole("button", { name: "Retrying…", exact: true });
  await expect(pending).toBeDisabled();
  await pending.dispatchEvent("click");
  expect(await page.evaluate(() => Reflect.get(window, "desktopRetry").calls)).toBe(1);
  await page.evaluate(() => Reflect.get(window, "desktopRetry").release());
  await expect(recovery).toHaveCount(0);
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    originalShortcut,
  );
});

for (const dark of [false, true]) {
  test(`desktop integration: actionable conflict and permission recovery ${dark ? "dark" : "light"}`, async ({
    page,
  }, info) => {
    await homeModelScenario(page);
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
      const state = window.dictationTest;
      state.snapshot.status.shortcutError =
        "Synthetic hotkey conflict: combination already registered";
      state.status("idle");
    }, dark);
    const recovery = page.getByRole("region", { name: "Shortcut recovery" });
    await expect(recovery).toBeVisible();
    await recovery.scrollIntoViewIfNeeded();
    await expect(recovery.getByText("Synthetic hotkey conflict", { exact: false })).toBeHidden();
    await recovery.getByText("Technical details", { exact: true }).click();
    await expect(recovery.getByText("Synthetic hotkey conflict", { exact: false })).toBeVisible();
    await recovery.getByText("Technical details", { exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`desktop-conflict-${dark ? "dark" : "light"}.png`),
    });
    await recovery.getByRole("link", { name: "Change shortcut", exact: true }).click();
    await expect(page.getByLabel("Global shortcut", { exact: true })).toBeFocused();
    await expect(page).toHaveURL(/section=dictation&focus=shortcut/);
    await navigateMain(page, "Dictate");
    await page.evaluate(() => {
      const state = window.dictationTest;
      state.snapshot.status.shortcutError = "Accessibility access required";
      state.status("idle");
    });
    await expect(recovery).toContainText("Allow Yap in your system’s accessibility settings");
    await page.setViewportSize({ width: 760, height: 560 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await recovery.getByRole("button", { name: "Retry shortcut", exact: true }).focus();
    await expect(
      recovery.getByRole("button", { name: "Retry shortcut", exact: true }),
    ).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
    await expect.poll(() => recovery.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await recovery.getByRole("alert").evaluate((el) => el.clientWidth)).toBeGreaterThan(150);
    await recovery.screenshot({
      path: info.outputPath(`desktop-recovery-panel-${dark ? "dark" : "light"}-200.png`),
    });
    await page.screenshot({
      path: info.outputPath(`desktop-permission-${dark ? "dark" : "light"}-200.png`),
      fullPage: true,
    });
  });
}

test("desktop integration: tray routes are validated and focus shortcut settings repeatedly", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.evaluate(() => {
    window.dictationTest.status("text-processing");
    window.dictationTest.callbacks["desktop:navigate"](
      "/settings?section=dictation&focus=shortcut",
    );
  });
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeDisabled();
  await page.evaluate(() => window.dictationTest.status("idle"));
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeFocused();
  await navigateMain(page, "Dictate");
  for (const route of [
    "/history",
    "/settings",
    "/settings?section=dictation&focus=shortcut",
    "/settings?section=dictation&focus=shortcut",
    "/",
  ]) {
    await page.evaluate(
      (route) => window.dictationTest.callbacks["desktop:navigate"](route),
      route,
    );
    await expect(page).toHaveURL(new RegExp(`#${route.replaceAll("?", "\\?")}$`));
    if (route.includes("focus=shortcut")) {
      await expect(page.getByLabel("Global shortcut", { exact: true })).toBeFocused();
      const history = page.getByRole("button", { name: "Close", exact: true });
      await history.focus();
      await page.evaluate(() => window.dictationTest.status("text-processing"));
      await expect(page.getByLabel("Global shortcut", { exact: true })).toBeDisabled();
      await page.evaluate(() => window.dictationTest.status("idle"));
      await expect(page.getByLabel("Global shortcut", { exact: true })).toBeEnabled();
      await expect(history).toBeFocused();
    }
  }
  await page.evaluate(() =>
    window.dictationTest.callbacks["desktop:navigate"]("https://example.com"),
  );
  await expect(page).toHaveURL(/#\/$/);
});

test("desktop integration: completion offers one current result action without showing transcript text", async ({
  page,
}, info) => {
  await homeModelScenario(page);
  await navigateMain(page, "History");
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.snapshot.status.phase = "done";
    state.snapshot.status.message = "Paste requested; copied to clipboard";
    state.snapshot.status.transcript = "Synthetic private transcript stays out of notifications";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Transcription finished" });
  await expect(toast).toContainText("Paste requested");
  await expect(toast).not.toContainText("Synthetic private transcript");
  await page.screenshot({ path: info.outputPath("desktop-completion.png") });
  await toast.getByRole("button", { name: "View result", exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(toast).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  await expect(toast).toHaveCount(0);
});

test("desktop integration: recovery notification stays actionable and expires on the next recording", async ({
  page,
}, info) => {
  await homeModelScenario(page);
  await navigateMain(page, "History");
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.snapshot.status.phase = "done";
    state.snapshot.status.completionWarning = true;
    state.snapshot.status.message = "Clipboard failed; transcript available in Home";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  const toast = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Transcript ready — action needed" });
  const action = toast.getByRole("button", {
    name: "View result",
    exact: true,
    includeHidden: true,
  });
  await expect(action).toBeVisible();
  await action.focus();
  // Outlive the ordinary five-second completion notice.
  await page.waitForTimeout(5500);
  await expect(toast).toBeVisible();
  await page.screenshot({ path: info.outputPath("desktop-recovery.png") });
  await page.evaluate(() => window.dictationTest.status("recording"));
  await expect(toast).toHaveCount(0);
});

test("desktop integration: profile-only conflict opens the cycling shortcut", async ({ page }) => {
  await homeModelScenario(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.profileShortcutError = "Synthetic profile shortcut conflict";
    state.status("idle");
  });
  const recovery = page.getByRole("region", { name: "Shortcut recovery" });
  await expect(recovery).toContainText("Profile shortcut unavailable");
  await page.keyboard.press("Escape");
  await recovery.getByRole("link", { name: "Change shortcut", exact: true }).click();
  await expect(page.getByLabel("Cycle profiles shortcut", { exact: true })).toBeFocused();
});

test("desktop integration: synthetic conflict-to-result walkthrough", async ({ page }, info) => {
  await homeModelScenario(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    document.documentElement.classList.add("dark");
    state.snapshot.status.shortcutError = "Synthetic shortcut conflict";
    state.status("idle");
  });
  const recovery = page.getByRole("region", { name: "Shortcut recovery" });
  await recovery.scrollIntoViewIfNeeded();
  // Pauses make the captured interaction readable.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await recovery.getByRole("link", { name: "Change shortcut", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeFocused();
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.status.shortcutError = "";
    state.status("idle");
  });
  await navigateMain(page, "History");
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
    state.snapshot.history = [
      {
        id: "desktop-demo",
        createdAt: "2026-10-31T10:00:00Z",
        durationMs: 6000,
        rawTranscript: "Synthetic demo: share the meeting notes tomorrow.",
        finalTranscript: "Synthetic demo: share the meeting notes tomorrow.",
        speechModel: "tiny",
        language: "en",
        audioPath: "",
      },
    ];
    state.snapshot.status.phase = "done";
    state.snapshot.status.completionWarning = true;
    state.snapshot.status.message = "Clipboard failed; transcript available in Home";
    state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
  });
  const toast = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Transcript ready — action needed" });
  const view = toast.getByRole("button", { name: "View result", exact: true, includeHidden: true });
  await expect(view).toBeVisible();
  await page.waitForTimeout(900);
  await view.click();
  const latest = page.getByRole("region", { name: "Latest saved result" });
  await expect(latest).toContainText("Synthetic demo:");
  await latest.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await page.screenshot({ path: info.outputPath("desktop-recovered-result.png") });
});

test("UI polish settings search opens a category, focuses the setting and restores the calling page", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await homeSurfaceScenario(page);
  const trigger = page.getByRole("link", { name: "Settings", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const search = settings.getByRole("textbox", { name: "Search settings", exact: true });
  await expect(search).toBeFocused();
  const settingsTitle = settings.locator('[data-slot="dialog-title"]');
  const titleTop = (await settingsTitle.boundingBox())!.y;
  await expect(settings.locator('[data-slot="settings-save-state"]')).toBeInViewport();
  await expect
    .poll(() => settings.evaluate((node) => node.scrollHeight <= node.clientHeight))
    .toBe(true);
  await search.fill("hotkey");
  await expect(settings.getByRole("tab", { selected: true })).toHaveCount(0);
  await settings.getByRole("button", { name: /^Global shortcut/ }).click();
  await expect(page).toHaveURL(/section=dictation.*focus=/);
  const shortcut = settings.getByLabel("Global shortcut", { exact: true });
  await expect(shortcut).toBeFocused();
  await expect(settings.getByRole("tab", { name: "Dictation", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await shortcut.fill("Ctrl+Alt+J");
  await shortcut.press("Tab");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+J");
  await search.fill("retention");
  await settings.getByRole("button", { name: /^History retention/ }).click();
  await expect(
    settings.getByRole("combobox", { name: "History retention", exact: true }),
  ).toBeFocused();
  for (const [query, title, category] of [
    ["backup", /^Backup & restore/, "history"],
    ["FFmpeg", /^Audio support \(FFmpeg\)/, "advanced"],
    ["diagnostics", /^Dictation diagnostics/, "advanced"],
    ["startup", /^Launch at login/, "general"],
    ["runtime", /^Whisper executable/, "advanced"],
    ["updates", /^App updates/, "general"],
    ["stats", /^Performance statistics/, "advanced"],
  ] as const) {
    await search.fill(query);
    await settings.getByRole("button", { name: title }).first().click();
    await expect(page).toHaveURL(new RegExp(`section=${category}.*focus=`));
    await expect(search).toHaveValue("");
    await expect.poll(() => settings.evaluate((node) => node.scrollTop)).toBe(0);
    expect(Math.abs((await settingsTitle.boundingBox())!.y - titleTop)).toBeLessThan(1);
    await expect(settings.locator('[data-slot="settings-save-state"]')).toBeInViewport();
  }
  await search.fill("setting-that-does-not-exist");
  await expect(settings.getByText("No settings found", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(/#\/$/);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
});

test("UI polish settings keeps category navigation and controls reachable at enlarged text", async ({
  page,
}) => {
  await settingsClarityScenario(page);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const pane = settings.locator('[data-slot="settings-scroll-pane"]');
  for (const width of [760, 480]) {
    await page.setViewportSize({ width, height: 600 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    const categories = settings.getByRole("combobox", { name: "Settings sections", exact: true });
    const search = settings.getByRole("textbox", { name: "Search settings", exact: true });
    await search.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(categories).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    for (const label of ["Dictation", "Profiles", "General", "History & data", "Advanced"]) {
      await categories.click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await expect(categories).toContainText(label);
    }
    // Outer overflow checks alone allowed the sidebar to crush this pane to 16px.
    expect(await pane.evaluate((node) => node.clientWidth)).toBeGreaterThan(320);
    expect(await pane.evaluate((node) => node.clientHeight)).toBeGreaterThan(280);
    const refresh = settings.getByRole("button", { name: "Refresh diagnostics", exact: true });
    await refresh.focus();
    await expect(refresh).toBeInViewport();
    const geometry = await refresh.evaluate((button) => {
      const box = button.getBoundingClientRect();
      const content = button.closest('[data-slot="settings-scroll-pane"]')!.getBoundingClientRect();
      const heading = button.closest("section")!.querySelector("h2")!.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        contentLeft: content.left,
        contentRight: content.right,
        headingTop: heading.top,
        headingBottom: heading.bottom,
        contentTop: content.top,
        contentBottom: content.bottom,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.contentLeft);
    expect(geometry.right).toBeLessThanOrEqual(geometry.contentRight);
    expect(geometry.headingTop).toBeGreaterThanOrEqual(geometry.contentTop);
    expect(geometry.headingBottom).toBeLessThanOrEqual(geometry.contentBottom);
    const setup = settings.getByRole("button", { name: "Run setup", exact: true });
    await setup.focus();
    await expect(setup).toBeInViewport();
    expect(await pane.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test("UI polish Escape flushes focused settings and failed drafts survive closing", async ({
  page,
}) => {
  await homeSurfaceScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Settings", exact: true });
  const shortcut = modal.getByLabel("Global shortcut", { exact: true });
  await shortcut.fill("Ctrl+Alt+J");
  await shortcut.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+J");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.evaluate(() => (window.dictationTest.failSave = true));
  await shortcut.fill("Ctrl+Alt+K");
  await shortcut.press("Escape");
  await expect(modal).toHaveCount(0);
  const failureNotice = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Settings not saved" });
  await expect(failureNotice).toBeVisible();
  await expect(
    page.locator('[data-slot="app-save-notice-host"] [data-slot="toast"]'),
  ).toBeVisible();
  const afterCloseNotice = await failureNotice.boundingBox();
  const afterCloseRecorder = await page.locator('[data-slot="home-recorder"]').boundingBox();
  expect(afterCloseRecorder!.y).toBeGreaterThanOrEqual(
    afterCloseNotice!.y + afterCloseNotice!.height - 1,
  );
  await failureNotice.getByRole("button", { name: "Error details", exact: true }).click();
  const errorReader = page.getByRole("dialog", { name: "Error details", exact: true });
  await expect(
    errorReader.getByRole("region", { name: "Full error details", exact: true }),
  ).toHaveText("Settings save failed");
  await errorReader.getByRole("button", { name: "Back", exact: true }).click();
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    "Ctrl+Alt+J",
  );
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(shortcut).toHaveValue("Ctrl+Alt+K");
  await expect(modal.getByRole("status").filter({ hasText: "Changes not saved" })).toBeVisible();
  await page.evaluate(() => (window.dictationTest.failSave = false));
  await modal.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+K");
});

test("UI polish recording options start closed, preserve settings and return keyboard focus", async ({
  page,
}) => {
  await homeSurfaceScenario(page);
  await page.reload();
  const recorder = page.getByRole("region", { name: "Dictation recorder", exact: true });
  const trigger = recorder.getByRole("button", { name: "Recording options", exact: true });
  const options = page.getByRole("region", { name: "Recording options", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(options).toBeHidden();
  await expect(recorder.getByRole("combobox")).toHaveCount(0);
  await expect(
    recorder.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeEnabled();
  await trigger.press("Enter");
  await expect(
    options.getByRole("combobox", { name: "Dictation profile", exact: true }),
  ).toBeVisible();
  await expect(options.getByRole("combobox", { name: "Speech model", exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.snapshot.models[0].name = "NVIDIA Parakeet TDT v3 — long model name";
    window.dictationTest.history();
  });
  await page.setViewportSize({ width: 360, height: 720 });
  await expect(options.getByText("Profile", { exact: true })).toBeVisible();
  const model = options.getByRole("combobox", { name: "Speech model", exact: true });
  await expect(model).toContainText("NVIDIA Parakeet TDT v3 — long model name");
  await expect
    .poll(() =>
      model.evaluate((node) => {
        const value = node.querySelector('[data-slot="select-value"]')!;
        const outer = node.getBoundingClientRect(),
          inner = value.getBoundingClientRect();
        return inner.top >= outer.top && inner.bottom <= outer.bottom;
      }),
    )
    .toBe(true);
  await page.setViewportSize({ width: 1086, height: 722 });
  const history = options.getByRole("switch", { name: "Save to history", exact: true });
  await history.uncheck();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.saveHistory))
    .toBe(false);
  await history.press("Escape");
  await expect(options).toBeHidden();
  await expect(trigger).toBeFocused();
  const historyOff = recorder.getByRole("status", { name: "Not saving to history", exact: true });
  await expect(historyOff).toBeVisible();
  await expect(historyOff).toHaveText("History off");
  const controls = await trigger.boundingBox(),
    indicator = await historyOff.boundingBox();
  expect(
    Math.abs(controls!.y + controls!.height / 2 - indicator!.y - indicator!.height / 2),
  ).toBeLessThanOrEqual(1);
  await trigger.press("Enter");
  await expect(history).not.toBeChecked();
  await recorder.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(recorder.getByRole("button", { name: "Stop recording", exact: true })).toBeEnabled();
  await openRecordingOptions(page);
  await expect(options.getByRole("combobox", { name: "Speech model", exact: true })).toBeDisabled();
  await expect(
    options.getByRole("combobox", { name: "Dictation profile", exact: true }),
  ).toBeDisabled();
  await expect(history).toBeEnabled();
  await history.check();
  await expect(historyOff).toBeVisible();
});

test("UI polish long transcript comparison preserves literal source, fits the draft and saves the end", async ({
  page,
}, info) => {
  const raw = Array.from(
    { length: 90 },
    (_, i) =>
      `Section ${i + 1}: Keep **literal markers** and every line break. Review the project notes with the team, preserve the original meaning, and record the next practical step.`,
  ).join("\n\n");
  const edited = raw.replace("literal markers", "corrected markers");
  await page.addInitScript(
    ({ raw, edited }) => {
      window.dictationTest.snapshot.history = [
        {
          id: "polish-long",
          createdAt: "2026-11-04T10:00:00Z",
          durationMs: 600000,
          rawTranscript: raw,
          finalTranscript: edited,
          speechModel: "Whisper Small",
          language: "en",
          audioPath: "",
        },
      ];
    },
    { raw, edited },
  );
  await page.setViewportSize({ width: 1086, height: 722 });
  await page.goto("/#/history/polish-long");
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  const editor = page.getByRole("region", { name: "Edit transcript", exact: true });
  const draft = editor.getByRole("textbox", { name: "Editable text", exact: true });
  await editor.getByRole("button", { name: "Compare with original", exact: true }).click();
  const original = editor.locator('[data-slot="editor-original"]');
  expect(await original.textContent()).toBe(raw);
  await expect
    .poll(() => draft.evaluate((node) => node.scrollHeight <= node.clientHeight))
    .toBe(true);
  const layout = await editor.evaluate((node) => {
    const draft = node.querySelector<HTMLTextAreaElement>("#transcript-editor")!;
    const original = node.querySelector<HTMLElement>('[data-slot="editor-original"]')!;
    const a = getComputedStyle(draft),
      b = getComputedStyle(original);
    return {
      draftFont: a.fontSize,
      originalFont: b.fontSize,
      draftLine: a.lineHeight,
      originalLine: b.lineHeight,
      topDelta: Math.abs(
        draft.getBoundingClientRect().top +
          parseFloat(a.borderTopWidth) +
          parseFloat(a.paddingTop) -
          original.getBoundingClientRect().top,
      ),
      widthDelta: Math.abs(
        draft.clientWidth -
          parseFloat(a.paddingLeft) -
          parseFloat(a.paddingRight) -
          original.clientWidth,
      ),
    };
  });
  expect(layout.draftFont).toBe(layout.originalFont);
  expect(layout.draftLine).toBe(layout.originalLine);
  expect(layout.topDelta).toBeLessThan(2);
  expect(layout.widthDelta).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath("long-editor-compare.png") });
  await page.setViewportSize({ width: 760, height: 560 });
  await expect
    .poll(() => draft.evaluate((node) => node.scrollHeight <= node.clientHeight))
    .toBe(true);
  await draft.press("Control+End");
  await page.keyboard.type(" Final correction.");
  const done = editor.getByRole("button", { name: "Done", exact: true });
  await expect(done).toBeInViewport();
  await done.click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe(edited + " Final correction.");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe(
    raw,
  );
  await expect(page.getByRole("button", { name: "Edit transcript", exact: true })).toBeFocused();
});

for (const [language, width, height] of [
  ["en", 360, 640],
  ["de", 480, 760],
] as const) {
  test(`focused pass keeps Original editing and change navigation contained ${language}`, async ({
    page,
  }) => {
    const copy = language === "de" ? de : en;
    await page.addInitScript(
      (language) => localStorage.setItem("desktop-language", language),
      language,
    );
    await sessionTitleScenario(page);
    await page.setViewportSize({ width, height });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.getByRole("tab", { name: copy["historyEntryPage.changes"], exact: true }).click();
    const next = page.getByRole("button", { name: copy["uiPolish.nextChange"], exact: true });
    await next.focus();
    await expect(next).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await next.press("Enter");
    await expect(page.locator("[data-diff-change]").first()).toBeFocused();
    await page.getByRole("tab", { name: copy["historyEntryPage.original"], exact: true }).click();
    const edit = page.getByRole("button", {
      name: copy["uiPolish.editSavedTranscript"],
      exact: true,
    });
    await edit.focus();
    await expect(edit).toBeInViewport();
    const box = (await edit.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await edit.press("Enter");
    await expect(
      page.getByRole("textbox", { name: copy["transcriptEditor.editableText"], exact: true }),
    ).toHaveValue("Original saved transcript.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe(
      "um, original recording",
    );
  });
}

test("UI polish changes navigate separate edits in long text without modifying either version", async ({
  page,
}) => {
  const raw =
    "Start incorrect.\n\n" +
    Array.from(
      { length: 70 },
      (_, i) => `Unchanged section ${i + 1} contains the same neutral words and remains readable.`,
    ).join("\n\n") +
    "\n\nEnd mistaken.";
  const edited = raw.replace("incorrect", "correct").replace("mistaken", "fixed");
  await page.addInitScript(
    ({ raw, edited }) => {
      window.dictationTest.snapshot.history = [
        {
          id: "polish-diff",
          createdAt: "2026-11-04T10:00:00Z",
          durationMs: 600000,
          rawTranscript: raw,
          finalTranscript: edited,
          speechModel: "Whisper Small",
          language: "en",
          audioPath: "",
        },
      ];
    },
    { raw, edited },
  );
  await page.goto("/#/history/polish-diff");
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  const pane = page.getByRole("tabpanel", { name: "Changes", exact: true });
  const changes = pane.locator("[data-diff-change]");
  await expect(changes).toHaveCount(2);
  await expect(pane.getByRole("status")).toHaveText("2 changes");
  await pane.getByRole("button", { name: "Next change", exact: true }).press("Enter");
  await expect(changes.nth(0)).toBeFocused();
  await expect(pane.getByRole("status")).toHaveText("Change 1 of 2");
  await pane.getByRole("button", { name: "Previous change", exact: true }).focus();
  await expect(changes.nth(0)).not.toBeFocused();
  await expect(changes.nth(0)).toHaveAttribute("aria-current", "true");
  await pane.getByRole("button", { name: "Next change", exact: true }).press("Enter");
  await expect(changes.nth(1)).toBeFocused();
  await expect(changes.nth(1)).toBeInViewport();
  await expect(pane.getByRole("button", { name: "Previous change", exact: true })).toBeInViewport();
  await pane.getByRole("button", { name: "Previous change", exact: true }).press("Enter");
  await expect(changes.nth(0)).toBeFocused();
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe(
    raw,
  );
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    edited,
  );
});

async function transcriptExportScenario(page: Page) {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.history = [
      {
        id: "export-one",
        title: "Planning notes",
        createdAt: "2026-11-06T10:00:00Z",
        durationMs: 1200,
        rawTranscript: "Original recognition",
        finalTranscript: "Saved **transcript**.",
        speechModel: "base",
        language: "en",
        audioPath: "",
      },
    ];
    state.outputs = Array.from({ length: 3 }, (_, index) => ({
      id: `export-output-${index}`,
      sessionId: "export-one",
      createdAt: `2026-11-06T11:0${index}:00Z`,
      prompt: { id: "summary", name: "Summary", instruction: "Summarize" },
      model: "local-model",
      endpoint: "http://127.0.0.1:1234/v1",
      input: "Saved **transcript**.",
      text: `Saved output ${index}`,
      ...(index === 2
        ? {
            chain: {
              runId: "chain-run",
              chainId: "chain",
              name: "Meeting notes",
              stepId: "first",
              step: 1,
              total: 2,
              input: "transcript",
              sourceOutputId: "",
            },
          }
        : {}),
    }));
  });
  await page.goto("/#/history/export-one");
}

test("transcript exports default to Markdown and let users choose separate output files and folders", async ({
  page,
}) => {
  await transcriptExportScenario(page);
  await detailAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export transcripts", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Format", exact: true })).toContainText(
    "Markdown (.md)",
  );
  await expect(dialog.getByRole("combobox", { name: "Save as", exact: true })).toContainText(
    "Single file",
  );
  await expect(dialog.getByRole("checkbox", { name: /^Saved transcript/ })).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /^Include generated outputs/ }),
  ).not.toBeChecked();
  await expect(dialog.getByRole("status")).toHaveText("1 transcript · 0 outputs · 1 file");
  await dialog.getByRole("checkbox", { name: /^Include generated outputs/ }).check();
  await expect(dialog.getByRole("combobox", { name: "Save as", exact: true })).toContainText(
    "ZIP archive",
  );
  await expect(dialog.getByRole("status")).toHaveText("1 transcript · 3 outputs · 4 files");
  const choices = dialog
    .getByRole("group", { name: "Generated outputs", exact: true })
    .getByRole("checkbox", { name: /^Summary/ });
  await expect(choices).toHaveCount(3);
  await expect(choices.nth(2)).toBeChecked();
  await choices.nth(1).uncheck();
  await expect(dialog.getByRole("status")).toHaveText("1 transcript · 2 outputs · 3 files");
  await dialog.getByRole("combobox", { name: "Format", exact: true }).click();
  await page.getByRole("option", { name: "Plain text (.txt)", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Save as", exact: true }).click();
  await page.getByRole("option", { name: "Folder", exact: true }).click();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const request = await page.evaluate(() => Reflect.get(window, "transcriptExportRequests").at(-1));
  expect(request).toEqual({
    sessionIds: ["export-one"],
    format: "text",
    destination: "folder",
    includeTranscript: true,
    includeOutputs: true,
    outputIds: ["export-output-0", "export-output-2"],
  });
  await expect(page.getByRole("button", { name: "Dictation actions", exact: true })).toBeFocused();
});

test("transcript exports require content and return to a direct file when only one file is selected", async ({
  page,
}) => {
  await transcriptExportScenario(page);
  await detailAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export transcripts", exact: true });
  const exportButton = dialog.getByRole("button", { name: "Export", exact: true });
  await dialog.getByRole("checkbox", { name: /^Saved transcript/ }).uncheck();
  await expect(exportButton).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /^Include generated outputs/ }).check();
  await dialog.getByRole("checkbox", { name: "Select all saved outputs", exact: true }).uncheck();
  await expect(exportButton).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: /^Summary/ })
    .first()
    .check();
  await expect(exportButton).toBeEnabled();
  await expect(dialog.getByRole("combobox", { name: "Save as", exact: true })).toContainText(
    "Single file",
  );
  await expect(dialog.getByRole("status")).toHaveText("0 transcripts · 1 output · 1 file");
  await exportButton.click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "transcriptExportRequests").at(-1)),
  ).toMatchObject({
    destination: "file",
    includeTranscript: false,
    includeOutputs: true,
    outputIds: ["export-output-0"],
  });
});

test("transcript exports select all search matches across loaded batches and freeze the selected transcript IDs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window.dictationTest;
    state.snapshot.history = Array.from({ length: 55 }, (_, index) => ({
      id: `bulk-export-${index}`,
      title: index === 54 ? "Unrelated note" : `Project note ${index}`,
      createdAt: "2026-11-06T10:00:00Z",
      durationMs: 1000,
      rawTranscript: "Original",
      finalTranscript: `Saved ${index}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
  });
  await page.goto("/#/history?q=project");
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(50);
  await page.getByRole("checkbox", { name: "Select loaded", exact: true }).check();
  await page
    .getByRole("button", { name: "Select all 54 matching transcripts for export", exact: true })
    .click();
  await expect(page.getByText("54 selected for export", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete selected", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).uncheck();
  await expect(page.getByText("53 selected for export", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select loaded", exact: true })).toHaveAttribute(
    "aria-checked",
    "mixed",
  );
  await page
    .getByRole("checkbox", { name: "Select dictation 50", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole("checkbox", { name: /^Select dictation / })).toHaveCount(54);
  await expect(page.getByRole("checkbox", { name: "Select loaded", exact: true })).toHaveAttribute(
    "aria-checked",
    "mixed",
  );
  await expect(page.getByText("53 selected for export", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export selected", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export transcripts", exact: true });
  await expect(dialog.getByRole("status")).toHaveText("53 transcripts · 0 outputs · 53 files");
  await expect(dialog.getByRole("combobox", { name: "Save as", exact: true })).toContainText(
    "ZIP archive",
  );
  await expect(dialog.getByRole("checkbox", { name: /^Include generated outputs/ })).toBeDisabled();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.history.push({ ...state.snapshot.history[0], id: "late-arrival" });
    state.history();
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const request = await page.evaluate(() => Reflect.get(window, "transcriptExportRequests").at(-1));
  expect(request.sessionIds).toHaveLength(53);
  expect(request.sessionIds).not.toContain("bulk-export-0");
  expect(request.sessionIds).not.toContain("bulk-export-54");
  expect(request.sessionIds).not.toContain("late-arrival");
  expect(request.destination).toBe("zip");
  await page.getByLabel("Search transcripts", { exact: true }).fill("unrelated");
  await expect(page.getByRole("button", { name: "Export selected", exact: true })).toHaveCount(0);
});

test("transcript exports offer a direct export action for exactly the selected output", async ({
  page,
}) => {
  await transcriptExportScenario(page);
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  const region = page.getByRole("region", { name: "Generated outputs", exact: true });
  await region.getByRole("button", { name: "Output actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export this output…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export output", exact: true });
  await expect(dialog.getByRole("status")).toHaveText("0 transcripts · 1 output · 1 file");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByText("Meeting notes · 1/2", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "transcriptExportRequests").at(-1)),
  ).toMatchObject({
    destination: "file",
    includeTranscript: false,
    includeOutputs: true,
    outputIds: ["export-output-2"],
  });
  await expect(region.getByRole("button", { name: "Output actions", exact: true })).toBeFocused();
});

test("transcript exports recover from preview and write failures and preserve choices after native cancellation", async ({
  page,
}) => {
  await transcriptExportScenario(page);
  await page.evaluate(() => Reflect.set(window, "failExportPreview", true));
  await detailAction(page, "Export");
  const dialog = page.getByRole("dialog", { name: "Export transcripts", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Export preview failed");
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await page.evaluate(() => Reflect.set(window, "failExportPreview", false));
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /^Include generated outputs/ }).check();
  await dialog
    .getByRole("checkbox", { name: /^Summary/ })
    .first()
    .uncheck();
  await page.evaluate(() => Reflect.set(window, "cancelExport", true));
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("status")).toHaveText("1 transcript · 2 outputs · 3 files");
  await expect(dialog.getByRole("checkbox", { name: /^Summary/ }).first()).not.toBeChecked();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "files exported" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.set(window, "cancelExport", false);
    window.dictationTest.failSave = true;
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Export failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "3 files exported" }),
  ).toBeVisible();
});

for (const language of ["en", "de"] as const) {
  test(`transcript exports keep long output names and controls reachable at enlarged text ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 560 });
    await transcriptExportScenario(page);
    await page.evaluate((language) => {
      localStorage.setItem("desktop-language", language);
    }, language);
    await page.reload();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
      window.dictationTest.outputs[0].prompt.name = "VeryLongOutputName".repeat(30);
      window.dictationTest.history();
    });
    await page
      .getByRole("button", {
        name: language === "en" ? "Dictation actions" : de["uiPolish.dictationActions"],
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", {
        name: language === "en" ? "Export" : de["historyEntryPage.export"],
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: language === "en" ? "Export transcripts" : "Transkripte exportieren",
      exact: true,
    });
    await dialog
      .getByRole("checkbox", {
        name:
          language === "en" ? /^Include generated outputs/ : /^Generierte Ausgaben einschließen/,
      })
      .check();
    const exportButton = dialog.getByRole("button", {
      name: language === "en" ? "Export" : de["historyEntryPage.export"],
      exact: true,
    });
    await exportButton.focus();
    await expect(exportButton).toBeInViewport();
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: language === "en" ? "Dictation actions" : de["uiPolish.dictationActions"],
        exact: true,
      }),
    ).toBeFocused();
  });
}

test("UI polish setup support links clear the sticky footer at normal and enlarged text", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const s = window.dictationTest.snapshot;
    s.settings.setupComplete = false;
    s.settings.modelPath = "/tiny";
    s.ready = true;
    s.models = [
      {
        id: "tiny",
        name: "Whisper Tiny",
        description: "Small download",
        size: 77691713,
        diskBytes: 77691713,
        path: "/tiny",
        installed: true,
        removable: true,
      },
      {
        id: "base",
        name: "Whisper Base",
        description: "Everyday",
        size: 147951465,
        diskBytes: 0,
        path: "/base",
        installed: false,
        removable: false,
      },
      {
        id: "small",
        name: "Whisper Small",
        description: "Balanced",
        size: 487601967,
        diskBytes: 0,
        path: "/small",
        installed: false,
        removable: false,
      },
    ];
  });
  await page.goto("/");
  const support = page.getByRole("link", { name: "Bring your own model", exact: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  for (const [width, height, font] of [
    [1086, 722, 100],
    [760, 560, 100],
    [760, 560, 200],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((font) => {
      document.documentElement.style.fontSize = `${font}%`;
    }, font);
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
    );
    await expect
      .poll(async () => {
        const link = await support.boundingBox();
        const footer = await page.locator("footer").boundingBox();
        return !!link && !!footer && link.y + link.height <= footer.y - 8;
      })
      .toBe(true);
    await expect(next).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
  await page.screenshot({ path: info.outputPath("setup-footer-clearance.png") });
});
