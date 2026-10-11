import { expect, test } from "@playwright/test";
import type { Snapshot, UpdateStatus } from "../src/lib/backend";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const snapshot: Snapshot = {
      textProcessing: {
        enabled: false,
        endpoint: "http://localhost:11434/v1",
        model: "",
        autoPromptId: "",
        prompts: [],
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
        saveAudio: false,
        launchAtLogin: false,
        startInTray: false,
        cleanText: false,
        setupComplete: true,
        historyRetentionDays: 0,
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
      dataDir: "",
      ready: true,
      floatingIndicator: false,
      launchAtLoginAvailable: true,
      startInTrayAvailable: true,
      vocabulary: [],
      microphoneTested: false,
      shortcutTested: false,
      diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
    };
    const update: UpdateStatus = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      available: true,
      supported: true,
      configured: true,
      checkedAt: "2026-10-10T08:00:00Z",
      downloadURL:
        "https://github.com/benjaminraffetseder/yap/releases/download/v0.2.0/yap-0.2.0-windows-amd64-setup.exe",
      notes: "Improved microphone selection.\nFixed shortcut handling.",
      error: "",
      message: "",
    };
    const state = {
      update,
      checks: [] as boolean[],
      downloads: 0,
      fail: false,
      pending: false,
      finish: () => {},
    };
    Object.assign(window, {
      updateTest: state,
      runtime: { EventsOnMultiple: () => () => {} },
      go: {
        main: {
          App: {
            GetSnapshot: async () => structuredClone(snapshot),
            GetMicrophones: async () => [],
            GetDiagnosticChecks: async () => [],
            GetAudioSupport: async () => ({
              installed: true,
              managed: true,
              path: "/ffmpeg",
              canDownload: true,
              size: 0,
              message: "Installed",
            }),
            CheckForUpdates: async (manual: boolean) => {
              state.checks.push(manual);
              if (state.pending)
                await new Promise<void>((resolve) => {
                  state.finish = resolve;
                });
              if (state.fail)
                return {
                  ...update,
                  error:
                    "Couldn’t check for updates. Check your internet connection and try again.",
                };
              return structuredClone(update);
            },
            OpenUpdateDownload: async () => {
              state.downloads++;
            },
          },
        },
      },
    });
  });
});

test("startup offers a download, dismissal keeps details available, and manual check bypasses startup", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const notice = page.getByRole("region", { name: "App update available" });
  await expect(notice).toContainText("Yap 0.2.0 is available.");
  await page.waitForFunction(() => Reflect.get(window, "updateTest").checks.length === 1);
  await notice.getByRole("button", { name: "Download update" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "updateTest").downloads)).toBe(1);
  await notice.getByRole("button", { name: "Later" }).click();
  await expect(notice).toBeHidden();
  await page.goto("/#/settings?section=general");
  const updates = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "App updates", exact: true }) });
  await expect(updates).toContainText("Installed version: 0.1.0");
  await expect(updates).toContainText("Improved microphone selection.");
  await expect(updates).toContainText("settings, history, and downloaded models will be kept");
  await updates.getByRole("button", { name: "Check for updates" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "updateTest").checks))
    .toEqual([false, true]);
  await updates.getByRole("button", { name: "Download update" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "updateTest").downloads)).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("update-settings.png"), fullPage: true });
});

test("an offline startup stays quiet and Settings can recover", async ({ page }) => {
  await page.addInitScript(() => {
    const state = Reflect.get(window, "updateTest");
    state.fail = true;
    state.update.available = false;
    state.update.checkedAt = "";
  });
  await page.goto("/");
  await page.waitForFunction(() => Reflect.get(window, "updateTest").checks.length === 1);
  await expect(page.getByRole("region", { name: "App update available" })).toBeHidden();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/#/settings?section=general");
  await expect(page.getByRole("alert")).toContainText("Couldn’t check for updates");
  await expect(page.getByText("You’re up to date.", { exact: true })).toBeHidden();
  await page.evaluate(() => {
    const state = Reflect.get(window, "updateTest");
    state.fail = false;
    state.update.checkedAt = "2026-10-10T09:00:00Z";
    state.update.latestVersion = "0.1.0";
  });
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("You’re up to date.", { exact: true })).toBeVisible();
});

test("manual checks show progress and prevent duplicate checks", async ({ page }) => {
  await page.goto("/#/settings?section=general");
  const check = page.getByRole("button", { name: "Check for updates" });
  await expect(check).toBeEnabled();
  await page.evaluate(() => {
    Reflect.get(window, "updateTest").pending = true;
  });
  await check.click();
  await expect(check).toBeDisabled();
  await expect(page.getByText("Checking for updates…", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(window, "updateTest").finish();
  });
  await expect(check).toBeEnabled();
});

test("unconfigured builds explain why updates are unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(Reflect.get(window, "updateTest").update, {
      configured: false,
      available: false,
    });
  });
  await page.goto("/#/settings?section=general");
  await expect(
    page.getByText("GitHub update checks aren’t configured for this build."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Download update" })).toBeHidden();
});

test("a missing public GitHub release is explained without claiming the app is up to date", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(Reflect.get(window, "updateTest").update, {
      available: false,
      latestVersion: "",
      downloadURL: "",
      notes: "",
      message: "No public GitHub release is available yet.",
    });
  });
  await page.goto("/#/settings?section=general");
  await expect(
    page.getByText("No public GitHub release is available yet.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("You’re up to date.", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Download update" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeEnabled();
});
