import { expect, test, type Page } from "@playwright/test";
import type { HomeResult, Settings, Snapshot } from "../src/lib/backend";

declare global {
  interface Window {
    statsTest: { snapshot: Snapshot; result: HomeResult; emit: () => void };
  }
}

async function scenario(page: Page, enabled = false, legacy = false) {
  await page.addInitScript(
    ({ enabled, legacy }) => {
      const session = {
        id: "stats-example",
        createdAt: "2026-10-30T12:00:00Z",
        durationMs: 18000,
        rawTranscript: "Synthetic transcript for performance testing.",
        finalTranscript: "Synthetic transcript for performance testing.",
        speechModel: "tiny.bin",
        language: "auto",
        audioPath: "",
        stats: legacy ? undefined : { transcriptionMs: 1500, engine: "whisper" },
      };
      const output = {
        id: "stats-output",
        sessionId: session.id,
        createdAt: session.createdAt,
        prompt: { id: "summary", name: "Summary", instruction: "Summarize" },
        model: "local-model",
        endpoint: "http://127.0.0.1:11434/v1",
        input: session.rawTranscript,
        text: "Synthetic summary.",
        stats: legacy
          ? undefined
          : {
              durationMs: 2500,
              responseMs: 2000,
              attempts: 2,
              model: "actual-local-model",
              inputTokens: 100,
              outputTokens: 50,
              totalTokens: 150,
              cachedInputTokens: 0,
              reasoningTokens: 10,
              generationTokensPerSecond: 42.5,
              finishReason: "stop",
            },
      };
      const snapshot: Snapshot = {
        settings: {
          microphoneId: "",
          whisperPath: "/synthetic",
          modelPath: "/tiny.bin",
          language: "auto",
          shortcut: "Ctrl+F12",
          interaction: "toggle",
          autoCopy: true,
          autoPaste: true,
          saveHistory: true,
          saveAudio: false,
          launchAtLogin: false,
          startInTray: false,
          cleanText: false,
          setupComplete: true,
          historyRetentionDays: 0,
          statsForNerds: JSON.parse(localStorage.getItem("stats-enabled") ?? String(enabled)),
        },
        status: {
          phase: "done",
          message: "Saved to History",
          startedAt: 0,
          transcript: "",
          progress: 0,
          shortcutError: "",
          indicatorError: "",
          trayError: "",
          startupError: "",
          historyError: "",
        },
        history: [session],
        models: [
          {
            id: "tiny",
            name: "Whisper Tiny",
            path: "/tiny.bin",
            description: "Synthetic",
            installed: true,
            size: 100,
            diskBytes: 100,
            removable: true,
          },
        ],
        textProcessing: {
          enabled: true,
          model: output.model,
          endpoint: output.endpoint,
          autoPromptId: "",
          prompts: [output.prompt],
          chains: [],
        },
        ready: true,
        dataDir: "",
        floatingIndicator: true,
        launchAtLoginAvailable: false,
        startInTrayAvailable: false,
        vocabulary: [],
        microphoneTested: false,
        shortcutTested: false,
        diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
      };
      const callbacks: Record<string, (...args: unknown[]) => void> = {};
      const result: HomeResult = {
        session,
        outputs: [output],
        text: output.text,
        outputId: output.id,
        revision: "one",
        saved: true,
        imported: false,
        outcomes: {
          transcription: "complete",
          history: "saved",
          processing: "complete",
          clipboard: "skipped",
          paste: "skipped",
        },
      };
      window.statsTest = { snapshot, result, emit: () => callbacks["dictation:history"]?.() };
      const methods = {
        GetSnapshot: async () => structuredClone(snapshot),
        GetHomeResult: async () => structuredClone(result),
        GetSession: async () => structuredClone(session),
        GetSessionOutputs: async () => structuredClone(result.outputs),
        GetHistory: async () => ({ entries: [session], total: 1, page: 0, pageSize: 50 }),
        GetMicrophones: async () => [],
        GetDiagnosticChecks: async () => [],
        GetAudioSupport: async () => ({
          installed: true,
          managed: false,
          path: "",
          canDownload: false,
          size: 0,
          message: "",
        }),
        SaveSettings: async (settings: Settings) => {
          snapshot.settings = structuredClone(settings);
          localStorage.setItem("stats-enabled", String(settings.statsForNerds));
        },
        SetIndicatorTheme: async () => {},
        CheckForUpdates: async () => ({
          currentVersion: "0.7.0",
          latestVersion: "",
          available: false,
          supported: false,
          configured: false,
          checkedAt: "",
          downloadURL: "",
          notes: "",
          error: "",
          message: "",
        }),
      };
      Reflect.set(window, "mockBackend", { main: { App: methods } });
      Reflect.set(window, "mockEvents", {
        subscribe: (name: string, callback: (...args: unknown[]) => void) => {
          callbacks[name] = callback;
        },
      });
    },
    { enabled, legacy },
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toBeVisible();
}

test("Stats for Nerds defaults hidden and the advanced toggle persists and hides results", async ({
  page,
}) => {
  await scenario(page);
  const statsButton = page.getByRole("button", { name: "Stats for Nerds", exact: true });
  const dialog = page.getByRole("dialog", { name: "Stats for Nerds", exact: true });
  await expect(statsButton).toHaveCount(0);
  await page.goto("/#/settings?section=advanced");
  const toggle = page.getByRole("switch", { name: "Stats for Nerds", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect
    .poll(() => page.evaluate(() => window.statsTest.snapshot.settings.statsForNerds))
    .toBe(true);
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.goto("/#/");
  await expect(dialog).toHaveCount(0);
  await statsButton.focus();
  await statsButton.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("12× real time", { exact: true })).toBeVisible();
  await expect(dialog.getByText("25 tokens/s", { exact: true })).toBeVisible();
  await expect(dialog.getByText("42.5 tokens/s", { exact: true })).toBeVisible();
  await expect(dialog.getByText("actual-local-model", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/LLM time includes retries/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(statsButton).toBeFocused();
  await statsButton.click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(statsButton).toBeFocused();
  await page.goto("/#/settings?section=advanced");
  await toggle.uncheck();
  await expect
    .poll(() => page.evaluate(() => window.statsTest.snapshot.settings.statsForNerds))
    .toBe(false);
  await page.goto("/#/");
  await expect(statsButton).toHaveCount(0);
});

test("History and individual outputs show stats and distinguish missing metadata from zero", async ({
  page,
}) => {
  await scenario(page, true);
  await page.goto("/#/history/stats-example");
  const dialog = page.getByRole("dialog", { name: "Stats for Nerds", exact: true });
  const statsButton = page.getByRole("button", { name: "Stats for Nerds", exact: true });
  await statsButton.click();
  await expect(dialog.getByText("1.5 s", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(statsButton).toBeFocused();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  const article = page.getByRole("article", { name: "Summary output" });
  await article.getByRole("button", { name: "Stats for Nerds", exact: true }).click();
  await expect(dialog.getByText("25 tokens/s", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Speech model", { exact: true })).toHaveCount(0);
  const cached = dialog
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: "Cached input tokens" }) });
  await expect(cached.locator("dd")).toHaveText("0");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto("/#/");
  await page.evaluate(() => {
    window.statsTest.result.outputs[0].stats = {
      durationMs: 1000,
      responseMs: 1000,
      attempts: 1,
      model: "minimal-server",
      outputTokens: null,
    };
    window.statsTest.emit();
  });
  await statsButton.click();
  const response = dialog
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: "Response rate" }) });
  await expect(response.locator("dd")).toHaveText("Unavailable");
  await expect(dialog.getByText("Generation speed", { exact: true })).toHaveCount(0);
});

test("legacy stats open in a dialog that fits narrow windows", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await scenario(page, true, true);
  await page.getByRole("button", { name: "Stats for Nerds", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Stats for Nerds", exact: true });
  await expect(dialog.getByText(/Timing was not recorded for this dictation/)).toBeVisible();
  await expect(
    dialog.getByText("Stats were not recorded for this output.", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/NaN|Infinity/)).toHaveCount(0);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(667);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("stats-dialog-narrow.png"),
    animations: "disabled",
  });
});
