import { expect, test, type Page } from "@playwright/test";
import type { Snapshot } from "../src/lib/backend";

function silentWav() {
  const samples = 8000 * 12;
  const wav = new Uint8Array(44 + samples * 2);
  const header = new DataView(wav.buffer);
  const write = (text: string, offset: number) =>
    wav.set(
      Array.from(text, (letter) => letter.charCodeAt(0)),
      offset,
    );
  write("RIFF", 0);
  header.setUint32(4, wav.length - 8, true);
  write("WAVEfmt ", 8);
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, 8000, true);
  header.setUint32(28, 16000, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  write("data", 36);
  header.setUint32(40, samples * 2, true);
  return `data:audio/wav;base64,${btoa(Array.from(wav, (byte) => String.fromCharCode(byte)).join(""))}`;
}

declare global {
  interface Window {
    audioPlayerTest: {
      fail: boolean;
      corrupt: boolean;
      defer: boolean;
      resolve?: () => void;
      allowPlay: boolean;
      previousAudio?: HTMLAudioElement;
    };
  }
}

async function scenario(page: Page, theme = "dark", collapsed = true, long = false) {
  await page.addInitScript(
    ({ wav, theme, collapsed, long }) => {
      localStorage.setItem("desktop-theme", theme);
      localStorage.setItem("yap-sidebar-collapsed", String(collapsed));
      const session = {
        id: "recording",
        createdAt: "2026-10-30T12:00:00Z",
        durationMs: 12000,
        rawTranscript: "Synthetic recording · review the project notes and share the next steps.",
        finalTranscript: "Synthetic recording · review the project notes and share the next steps.",
        speechModel: "Whisper Small",
        language: "en",
        audioPath: "/synthetic-recording.wav",
      };
      if (long) {
        session.rawTranscript = session.finalTranscript = Array.from(
          { length: 45 },
          (_, index) =>
            `Synthetic paragraph ${index + 1}. Review the project notes and share the next steps.`,
        ).join("\n\n");
      }
      const snapshot: Snapshot = {
        settings: {
          microphoneId: "",
          whisperPath: "",
          modelPath: "",
          language: "auto",
          shortcut: "Ctrl+F12",
          interaction: "toggle",
          autoCopy: true,
          autoPaste: true,
          saveHistory: true,
          saveAudio: true,
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
          progress: 0,
          startedAt: 0,
          transcript: "",
          shortcutError: "",
          indicatorError: "",
          trayError: "",
          startupError: "",
          historyError: "",
        },
        history: [session],
        models: [],
        vocabulary: [],
        ready: true,
        dataDir: "",
        floatingIndicator: true,
        launchAtLoginAvailable: false,
        startInTrayAvailable: false,
        microphoneTested: false,
        shortcutTested: false,
        diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
        textProcessing: { enabled: false, endpoint: "", model: "", autoPromptId: "", prompts: [] },
      };
      window.audioPlayerTest = { fail: false, corrupt: false, defer: false, allowPlay: true };
      Reflect.set(window, "mockEvents", { subscribe: () => {} });
      Reflect.set(window, "mockBackend", {
        main: {
          App: {
            GetSnapshot: async () => structuredClone(snapshot),
            GetSession: async (id: string) => ({ ...session, id }),
            GetSessionOutputs: async () => [],
            GetHomeResult: async () => null,
            GetHistory: async () => ({ entries: [session], total: 1, page: 0, pageSize: 50 }),
            SetIndicatorTheme: async () => {},
            CheckForUpdates: async () => ({ available: false, error: "" }),
            GetAudio: async () => {
              const state = window.audioPlayerTest;
              if (state.defer)
                await new Promise<void>((resolve) => {
                  state.resolve = resolve;
                });
              if (state.fail) throw new Error("Synthetic recording unavailable");
              return state.corrupt ? "data:audio/wav;base64,AA==" : wav;
            },
          },
        },
      });
    },
    { wav: silentWav(), theme, collapsed, long },
  );
  await page.goto("/#/history/recording");
  await expect(page.getByRole("heading", { level: 1, name: /^Synthetic/ })).toBeVisible();
}

const player = (page: Page) => page.getByRole("region", { name: "Recording player" });
async function openPlayer(page: Page) {
  await page.getByRole("button", { name: "Play recording", exact: true }).click();
  await expect(player(page).getByRole("slider", { name: "Recording position" })).toBeEnabled();
  await expect
    .poll(() =>
      player(page)
        .locator("audio")
        .evaluate((audio) => (audio as HTMLAudioElement).duration),
    )
    .toBe(12);
}

test("real WAV playback supports play, pause, keyboard/pointer seeking and replay", async ({
  page,
}) => {
  await scenario(page);
  await openPlayer(page);
  const media = player(page).locator("audio");
  await expect(player(page).getByRole("button", { name: "Pause recording" })).toBeVisible();
  expect(await media.evaluate((audio) => (audio as HTMLAudioElement).controls)).toBe(false);
  await expect
    .poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).currentTime))
    .toBeGreaterThan(0);
  await player(page).getByRole("button", { name: "Pause recording" }).click();
  await expect.poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).paused)).toBe(true);
  const seek = player(page).getByRole("slider", { name: "Recording position" });
  await seek.focus();
  await seek.press("Home");
  await seek.press("ArrowRight");
  await expect
    .poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).currentTime))
    .toBe(1);
  await expect(seek).toHaveAttribute("aria-valuetext", "0:01 of 0:12");
  const track = player(page).locator('[data-slot="slider-control"]').first();
  const bounds = (await track.boundingBox())!;
  await track.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect
    .poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).currentTime))
    .toBe(6);
  await player(page).getByRole("button", { name: "Play recording", exact: true }).click();
  await seek.focus();
  await seek.press("End");
  await expect(
    player(page).getByRole("button", { name: "Play recording", exact: true }),
  ).toBeVisible();
  await player(page).getByRole("button", { name: "Play recording", exact: true }).click();
  await expect
    .poll(() =>
      media.evaluate(
        (audio) =>
          (audio as HTMLAudioElement).currentTime < 2 && !(audio as HTMLAudioElement).paused,
      ),
    )
    .toBe(true);
});

test("speed, volume and mute control the media element and preserve audible volume", async ({
  page,
}) => {
  await scenario(page);
  await openPlayer(page);
  const media = player(page).locator("audio");
  await player(page).getByRole("combobox", { name: "Playback speed" }).click();
  await page.getByRole("option", { name: "1.5×", exact: true }).click();
  await expect
    .poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).playbackRate))
    .toBe(1.5);
  const volume = player(page).getByRole("slider", { name: "Volume", exact: true });
  await volume.focus();
  await volume.press("End");
  await volume.press("ArrowLeft");
  await expect.poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).volume)).toBe(0.95);
  await player(page).getByRole("button", { name: "Mute recording" }).click();
  await expect.poll(() => media.evaluate((audio) => (audio as HTMLAudioElement).muted)).toBe(true);
  await player(page).getByRole("button", { name: "Unmute recording" }).click();
  await expect
    .poll(() =>
      media.evaluate(
        (audio) =>
          (audio as HTMLAudioElement).volume === 0.95 && !(audio as HTMLAudioElement).muted,
      ),
    )
    .toBe(true);
  await volume.focus();
  await volume.press("Home");
  await player(page).getByRole("button", { name: "Unmute recording" }).click();
  await expect
    .poll(() =>
      media.evaluate(
        (audio) =>
          (audio as HTMLAudioElement).volume === 0.95 && !(audio as HTMLAudioElement).muted,
      ),
    )
    .toBe(true);
});

test("leaving or changing the dictation stops playback and resets the next player", async ({
  page,
}) => {
  await scenario(page);
  await openPlayer(page);
  await page.evaluate(() => {
    window.audioPlayerTest.previousAudio = document.querySelector("audio")!;
  });
  await page.getByRole("link", { name: "Back to History" }).click();
  await expect(player(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.audioPlayerTest.previousAudio!.paused)).toBe(true);
  await page.goto("/#/history/another-recording");
  await expect(player(page)).toHaveCount(0);
  await openPlayer(page);
  await expect
    .poll(() =>
      player(page)
        .locator("audio")
        .evaluate((audio) => (audio as HTMLAudioElement).playbackRate),
    )
    .toBe(1);
});

test("bottom dock remains visible while scrolling and leaves the last paragraph readable", async ({
  page,
}) => {
  await scenario(page, "dark", true, true);
  await openPlayer(page);
  const bottomGap = () =>
    player(page).evaluate((element) => innerHeight - element.getBoundingClientRect().bottom);
  await expect.poll(bottomGap).toBeGreaterThanOrEqual(12);
  await expect.poll(bottomGap).toBeLessThanOrEqual(20);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await expect.poll(bottomGap).toBeLessThanOrEqual(20);
  await expect(player(page).getByRole("button", { name: "Pause recording" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = page
    .getByRole("tabpanel")
    .getByText("Synthetic paragraph 45. Review the project notes and share the next steps.", {
      exact: true,
    });
  await expect(last).toBeInViewport();
  const lastBounds = (await last.boundingBox())!;
  const playerBounds = (await player(page).boundingBox())!;
  expect(lastBounds.y + lastBounds.height).toBeLessThan(playerBounds.y);
});

test("closing player stops audio, restores focus and lets the recording reopen", async ({
  page,
}) => {
  await scenario(page, "dark", true, true);
  await openPlayer(page);
  await page.evaluate(() => {
    window.audioPlayerTest.previousAudio = document.querySelector("audio")!;
  });
  const close = player(page).getByRole("button", { name: "Close audio player", exact: true });
  await expect(close).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  await close.focus();
  await close.press("Enter");
  await expect(player(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.audioPlayerTest.previousAudio!.paused)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(500);
  await expect(page.getByRole("button", { name: "Play recording", exact: true })).toBeFocused();
  await openPlayer(page);
  await expect(player(page).getByRole("button", { name: "Pause recording" })).toBeVisible();
});

test("close stays reachable beside the minimized import queue", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await scenario(page);
  await openPlayer(page);
  await page.evaluate(() => {
    Reflect.get(window, "_wails").dispatchWailsEvent({
      name: "import:queue",
      data: [
        {
          id: "import",
          name: "Synthetic.wav",
          state: "done",
          message: "Finished",
          sessionId: "",
          transcript: "",
          error: "",
          progress: 1,
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Minimize import queue" }).click();
  await expect(page.getByRole("button", { name: "Open import queue" })).toBeVisible();
  await player(page)
    .getByRole("button", { name: "Close audio player", exact: true })
    .click({ timeout: 2000 });
  await expect(player(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open import queue" })).toBeVisible();
});

test("audio loading, backend failure and decode failure remain recoverable", async ({ page }) => {
  await scenario(page);
  await page.evaluate(() => {
    window.audioPlayerTest.defer = true;
  });
  const open = page.getByRole("button", { name: "Play recording", exact: true });
  await open.click();
  await expect(open).toBeDisabled();
  await expect(player(page)).toHaveCount(0);
  await page.evaluate(() => {
    window.audioPlayerTest.fail = true;
    window.audioPlayerTest.resolve!();
  });
  await expect(open).toBeEnabled();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Synthetic recording unavailable" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.assign(window.audioPlayerTest, { defer: false, fail: false, corrupt: true });
  });
  await open.click();
  await expect(player(page).getByRole("alert")).toContainText("recording couldn’t be played");
  await expect(player(page).getByRole("slider", { name: "Recording position" })).toBeDisabled();
  await player(page).getByRole("button", { name: "Retry playback" }).click();
  await expect(player(page).getByRole("alert")).toBeVisible();
});

test("blocked autoplay can be started manually without claiming playback began", async ({
  page,
}) => {
  await scenario(page);
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return window.audioPlayerTest.allowPlay
        ? original.call(this)
        : Promise.reject(new DOMException("Synthetic autoplay policy", "NotAllowedError"));
    };
  });
  await page.reload();
  await page.evaluate(() => {
    window.audioPlayerTest.allowPlay = false;
  });
  await openPlayer(page);
  await expect(player(page).getByRole("alert")).toContainText("Playback didn’t start");
  await expect(player(page).getByRole("button", { name: "Pause recording" })).toHaveCount(0);
  await page.evaluate(() => {
    window.audioPlayerTest.allowPlay = true;
  });
  await player(page).getByRole("button", { name: "Play recording", exact: true }).click();
  await expect(player(page).getByRole("button", { name: "Pause recording" })).toBeVisible();
  await expect(player(page).getByRole("alert")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  test(`audio player layout and interaction preview ${theme}`, async ({ page }, testInfo) => {
    await scenario(page, theme);
    await openPlayer(page);
    await player(page).getByRole("button", { name: "Pause recording" }).click();
    for (const [width, font] of [
      [1280, 100],
      [760, 100],
      [760, 200],
      [360, 100],
    ]) {
      await page.setViewportSize({ width, height: width === 760 ? 560 : 800 });
      await page.emulateMedia({ reducedMotion: font === 200 ? "reduce" : "no-preference" });
      await page.evaluate((font) => {
        document.documentElement.style.fontSize = `${font}%`;
      }, font);
      for (const control of [
        player(page).getByRole("button", { name: "Play recording", exact: true }),
        player(page).getByRole("combobox", { name: "Playback speed" }),
        player(page).getByRole("slider", { name: "Recording position" }),
        player(page).getByRole("slider", { name: "Volume", exact: true }),
        player(page).getByRole("button", { name: "Close audio player", exact: true }),
      ]) {
        await control.focus();
        await expect(control).toBeFocused();
        const bounds = await control.evaluate((element) => {
          const rect = (
            element.closest('[data-slot="slider-thumb"]') ?? element
          ).getBoundingClientRect();
          return {
            x: rect.x,
            right: rect.right,
            y: rect.y,
            bottom: rect.bottom,
            width: innerWidth,
            height: innerHeight,
          };
        });
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
      }
      expect(
        await player(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.getByRole("heading", { level: 1, name: /^Synthetic/ }).click();
      await page.screenshot({
        path: testInfo.outputPath(`audio-player-${theme}-${width}-${font}.png`),
        animations: "disabled",
      });
    }
  });
}

test("synthetic audio player interaction walkthrough", async ({ page }, testInfo) => {
  await scenario(page, "dark", true, true);
  await openPlayer(page);
  await page.waitForTimeout(900);
  await player(page).getByRole("button", { name: "Pause recording" }).click();
  const seek = player(page).getByRole("slider", { name: "Recording position" });
  await seek.focus();
  await seek.press("Home");
  for (let index = 0; index < 4; index++) await seek.press("ArrowRight");
  await page.waitForTimeout(600);
  await player(page).getByRole("combobox", { name: "Playback speed" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("option", { name: "1.5×", exact: true }).click();
  await player(page).getByRole("button", { name: "Mute recording" }).click();
  await page.waitForTimeout(500);
  await player(page).getByRole("button", { name: "Unmute recording" }).click();
  await player(page).getByRole("button", { name: "Play recording", exact: true }).click();
  await page.waitForTimeout(900);
  await player(page).getByRole("button", { name: "Pause recording" }).click();
  await page.getByRole("heading", { level: 1, name: /^Synthetic/ }).click();
  await page.screenshot({
    path: testInfo.outputPath("audio-player-desktop.png"),
    animations: "disabled",
  });
  await player(page).screenshot({
    path: testInfo.outputPath("audio-player-detail.png"),
    animations: "disabled",
  });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(700);
  await page.screenshot({
    path: testInfo.outputPath("audio-player-scrolled.png"),
    animations: "disabled",
  });
  await player(page).getByRole("button", { name: "Close audio player" }).click();
  await expect(player(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: testInfo.outputPath("audio-player-closed.png"),
    animations: "disabled",
  });
  await openPlayer(page);
  await player(page).getByRole("button", { name: "Pause recording" }).click();
  await page.setViewportSize({ width: 760, height: 560 });
  await page.waitForTimeout(900);
  await page.screenshot({
    path: testInfo.outputPath("audio-player-narrow.png"),
    animations: "disabled",
  });
});
