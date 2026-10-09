import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/lib/backend";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
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
      ready: true,
      dataDir: "",
      floatingIndicator: true,
      launchAtLoginAvailable: true,
      startInTrayAvailable: true,
      vocabulary: [],
      microphoneTested: false,
      shortcutTested: false,
      diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
    };
    const support = {
      installed: false,
      managed: false,
      path: "",
      canDownload: true,
      size: 76972461,
      message: "FFmpeg is not installed",
    };
    Object.assign(window, {
      audioSupportTest: {
        decline: false,
        complete() {
          Object.assign(support, {
            installed: true,
            managed: true,
            path: "C:\\Yap\\runtime\\ffmpeg\\bin\\ffmpeg.exe",
            message: "Installed by Yap",
          });
          Object.assign(snapshot.status, {
            phase: "idle",
            message: "Audio support installed. Ready to import.",
            progress: 0,
          });
          callbacks["dictation:status"](structuredClone(snapshot.status));
        },
      },
      runtime: {
        EventsOnMultiple(topic: string, handler: (...args: unknown[]) => void) {
          callbacks[topic] = handler;
          return () => {
            delete callbacks[topic];
          };
        },
      },
      go: {
        main: {
          App: {
            GetSnapshot: async () => structuredClone(snapshot),
            GetHistory: async () => ({ entries: [], total: 0, page: 0, pageSize: 50 }),
            GetMicrophones: async () => [],
            GetDiagnosticChecks: async () => [],
            GetAudioSupport: async () => structuredClone(support),
            InstallAudioSupport: async () => {
              if (Reflect.get(window, "audioSupportTest").decline) return;
              Object.assign(snapshot.status, {
                phase: "downloading",
                message: "Downloading audio support…",
                progress: 0.42,
              });
              callbacks["dictation:status"](structuredClone(snapshot.status));
            },
            ImportAudio: async () => {
              Object.assign(snapshot.status, {
                phase: "downloading",
                message: "Downloading audio support…",
                progress: 0.42,
              });
              callbacks["dictation:status"](structuredClone(snapshot.status));
            },
            Cancel: async () => {
              Object.assign(snapshot.status, {
                phase: "idle",
                message: "Audio import cancelled",
                progress: 0,
              });
              callbacks["dictation:status"](structuredClone(snapshot.status));
            },
          },
        },
      },
    });
  });
});

test("audio support download progress and cancel survive navigation", async ({
  page,
}, testInfo) => {
  await page.goto("/#/history");
  await page.getByRole("button", { name: "Import audio", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Downloading audio support… 42%" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("audio-support-progress.png") });
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
  const ring = page.getByRole("progressbar", { name: "Download progress" });
  await expect(ring).toHaveAttribute("data-slot", "circular-progress");
  await expect(ring).toHaveAttribute("aria-valuenow", "42");
  await expect(ring.locator("circle").last()).toHaveAttribute("stroke-dashoffset", "58");
  const buttonBounds = await page
    .getByRole("button", { name: "Start recording", exact: true })
    .boundingBox();
  const ringBounds = await ring.boundingBox();
  expect(ringBounds!.x).toBeLessThan(buttonBounds!.x);
  expect(ringBounds!.y).toBeLessThan(buttonBounds!.y);
  expect(ringBounds!.x + ringBounds!.width).toBeGreaterThan(buttonBounds!.x + buttonBounds!.width);
  expect(ringBounds!.y + ringBounds!.height).toBeGreaterThan(
    buttonBounds!.y + buttonBounds!.height,
  );
  await expect(
    page
      .getByRole("heading", { name: "Dictate", exact: true })
      .locator("..")
      .getByRole("progressbar"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel download", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("home-radial-progress.png") });
  await page.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(ring).toBeHidden();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Download progress" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Import audio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel download", exact: true })).toBeVisible();
});

test("FFmpeg settings show status, confirmation cancellation, progress, and installed path", async ({
  page,
}, testInfo) => {
  await page.goto("/#/settings?section=advanced");
  const panel = page.getByRole("region", { name: "Audio support (FFmpeg)", exact: true });
  await expect(panel.getByText("FFmpeg is not installed", { exact: true })).toBeVisible();
  const download = panel.getByRole("button", {
    name: "Download audio support · 73.4 MiB",
    exact: true,
  });
  await page.evaluate(() => {
    Reflect.get(window, "audioSupportTest").decline = true;
  });
  await download.click();
  await expect(download).toBeEnabled();
  await expect(panel.getByRole("progressbar")).toBeHidden();
  await page.evaluate(() => {
    Reflect.get(window, "audioSupportTest").decline = false;
  });
  await download.click();
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  await expect(download).toBeDisabled();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(download).toBeEnabled();
  await download.click();
  await page.evaluate(() => {
    Reflect.get(window, "audioSupportTest").complete();
  });
  await expect(panel.getByText("Installed by Yap", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("C:\\Yap\\runtime\\ffmpeg\\bin\\ffmpeg.exe", { exact: true }),
  ).toBeVisible();
  await expect(download).toBeHidden();
  await panel.getByRole("button", { name: "Refresh audio support", exact: true }).click();
  await expect(panel.getByText("Installed by Yap", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ffmpeg-settings.png"), fullPage: true });
});

test("FFmpeg settings handle old backends and preserve unsaved preferences", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByRole("checkbox", { name: /^Light cleanup/ }).check();
  await page.evaluate(() => {
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "GetAudioSupport");
  });
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  const panel = page.getByRole("region", { name: "Audio support (FFmpeg)", exact: true });
  await expect(panel.getByRole("alert")).toContainText("restart wails dev");
  await expect(panel.getByRole("button", { name: /Download audio support/ })).toBeHidden();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Light cleanup/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
});
