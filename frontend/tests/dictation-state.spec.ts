import { expect, test, type Page } from "@playwright/test";
import type {
  AppProfileRule,
  BackupPreview,
  BackupSummary,
  DiagnosticCheck,
  DictationProfile,
  GeneratedOutput,
  Settings,
  Snapshot,
  Status,
  TextProcessing,
  TextPrompt,
  VocabularyEntry,
} from "../src/lib/backend";

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
  await expect(button).toBeDisabled();
  await expect(button).toHaveCSS("opacity", "0.5");
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
    await page.getByRole("button", { name: "Test microphone", exact: true }).click();
    await page.getByRole("button", { name: "Stop test", exact: true }).click();
    await expect(page.getByText("Microphone test passed", { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="setup-mic-success"]')).toHaveCSS(
      "transform",
      reduced ? "none" : "matrix(1, 0, 0, 1, 0, 0)",
    );
    const halo = page.locator('[data-slot="setup-success-halo"]');
    await expect(halo).toHaveCount(reduced ? 0 : 1);
    await page.getByRole("button", { name: "Test microphone", exact: true }).click();
    await page.getByRole("button", { name: "Stop test", exact: true }).click();
    await expect(page.getByText("Microphone test passed", { exact: true })).toBeVisible();
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
    await expect(page.getByText("Microphone test passed", { exact: true })).toBeVisible();
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
    const overlay = page.getByRole("status").filter({ hasText: "Drop one audio file to import" });
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

test("transcription completion uses one toast across navigation without a result panel", async ({
  page,
}, testInfo) => {
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
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
  await expect(warning).toContainText("clipboard failed: unavailable");
  await expect(warning.locator(".lucide-circle-alert")).toBeVisible();
  await page.keyboard.press("F6");
  await warning.getByRole("button", { name: "Copy transcript" }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Copied to clipboard" }),
  ).toBeVisible();
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
    const selector = recorder.getByRole("combobox", { name: "Speech model", exact: true });
    await expect(recorder.getByRole("heading", { name: "Ready to record" })).toBeVisible();
    await expect(selector).toContainText("Whisper Tiny");
    await page.screenshot({ path: testInfo.outputPath("dictation-ready-desktop.png") });
    await page.evaluate(() => {
      Reflect.get(window, "go").main.App.StopRecording = async () => {
        window.dictationTest.status("transcribing");
      };
    });
    for (const width of [1347, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(recorder.getByRole("button", { name: "Start recording" })).toBeEnabled();
      await expect(selector).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (width === 360) {
        await page.screenshot({ path: testInfo.outputPath("dictation-ready-narrow.png") });
      }
      await recorder.getByRole("button", { name: "Start recording" }).click();
      await expect(recorder.getByRole("heading", { name: "Recording", exact: true })).toBeVisible();
      await expect(selector).toBeDisabled();
      const bars = recorder.locator('[data-slot="recording-level-meter"] > span');
      await expect(bars).toHaveCount(17);
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
      await expect(recorder.getByRole("heading", { name: "Transcribing…" })).toBeVisible();
      await expect(recorder.getByRole("button", { name: "Start recording" })).toBeDisabled();
      await page.evaluate(() => {
        window.dictationTest.status("idle");
        window.dictationTest.callbacks["dictation:level"](0);
      });
    }
    await simulateModelDownload(page);
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
    await page.screenshot({ path: testInfo.outputPath("dictation-download-narrow.png") });
    await recorder.getByRole("button", { name: "Cancel download" }).click();
    await expect(selector).toBeEnabled();
  });
}

test("home speech model selector shows the active model and saves installed selections", async ({
  page,
}, testInfo) => {
  await homeModelScenario(page);
  const selector = page.getByRole("combobox", { name: "Speech model", exact: true });
  await expect(selector).toContainText("Whisper Tiny");
  const settings = await page.evaluate(() =>
    structuredClone(window.dictationTest.snapshot.settings),
  );
  await page.evaluate(() => {
    const app = Reflect.get(window, "go").main.App;
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
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Whisper Base", exact: true }) })
      .getByRole("button", { name: "Active", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await expect(selector).toContainText("Whisper Base");
});

test("home speech model selector retains custom and failed selections and blocks active work", async ({
  page,
}) => {
  await homeModelScenario(page, true);
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
  await expect(page.getByRole("link", { name: "Download model", exact: true })).toBeVisible();
});

async function simulateModelDownload(page: Page) {
  await page.evaluate(() => {
    Reflect.get(window, "go").main.App.InstallModel = async (id: string) => {
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
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
    Reflect.set(Reflect.get(window, "go").main.App, "RetryShortcut", async () => {
      permission.attempts++;
      if (permission.granted) state.snapshot.status.shortcutError = "";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    });
  }, setup);
}

for (const recovery of ["button", "focus"] as const) {
  test(`shortcut permission recovery via ${recovery} preserves unsaved settings`, async ({
    page,
  }) => {
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
    expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
      "Ctrl+Alt+Space",
    );
    expect(await page.evaluate(() => window.dictationTest.snapshot.status.phase)).toBe("idle");
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

test("settings sections keep navigation above full-width content and preserve edits", async ({
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
  expect(contentBounds!.y).toBeGreaterThan(navBounds!.y + navBounds!.height);
  expect(contentBounds!.width).toBeGreaterThan(850);
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeHidden();
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+J");
  await page.screenshot({
    path: testInfo.outputPath("settings-dictation.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.getByRole("checkbox", { name: "Launch at login", exact: true }).check();
  await page.screenshot({
    path: testInfo.outputPath("settings-general.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Keep recordings/ }).check();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("settings-advanced.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+K");
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+J");
  await page.setViewportSize({ width: 760, height: 680 });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("settings-narrow.png"),
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Dictation", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("settings saves use dismissible success and error toasts and preserve failed drafts", async ({
  page,
}, testInfo) => {
  await page.goto("/#/settings");
  const shortcut = page.getByLabel("Global shortcut", { exact: true });
  const save = page.getByRole("button", { name: "Save settings", exact: true });
  const saved = page.locator('[data-slot="toast"]').filter({ hasText: "Settings saved." });
  const failed = page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" });
  await shortcut.fill("Ctrl+Alt+J");
  await save.click();
  await expect(saved).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    "Ctrl+Alt+J",
  );
  await page.screenshot({
    path: testInfo.outputPath("settings-save-toast.png"),
    animations: "disabled",
  });
  await saved.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(saved).toBeHidden();
  await shortcut.fill("Ctrl+Alt+K");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await save.click();
  await expect(failed).toBeVisible();
  await expect(saved).toHaveCount(0);
  await expect(shortcut).toHaveValue("Ctrl+Alt+K");
  await expect(save).toBeEnabled();
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    "Ctrl+Alt+J",
  );
  await page.keyboard.press("F6");
  await failed.getByRole("button", { name: "Dismiss notification" }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await save.click();
  await expect(saved).toBeVisible();
  await expect(saved).toHaveCount(1);
  await expect(failed).toHaveCount(0);
  expect(await page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe(
    "Ctrl+Alt+K",
  );
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
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
      .toBe("cleanup");
    await page
      .locator('[data-slot="toast"]')
      .filter({ hasText: "Prompts saved." })
      .getByRole("button", { name: "Dismiss notification" })
      .click();
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
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
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
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeInViewport();
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
  await page.getByRole("checkbox", { name: "Enable LLM processing", exact: true }).check();
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Prompts save failed" }),
  ).toBeVisible();
  await expect(automatic).toBeChecked();
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId)).toBe(
    "",
  );
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
  await expect(automatic).toBeChecked();
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.autoPromptId))
    .toBe("cleanup");
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByRole("checkbox", { name: "Enable LLM processing", exact: true }).uncheck();
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("prompts-wide.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Instructions", { exact: true }).scrollIntoViewIfNeeded();
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await expect(save).toBeInViewport();
  await save.click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        name: window.dictationTest.snapshot.textProcessing.prompts[0].name,
        model: window.dictationTest.snapshot.textProcessing.model,
      })),
    )
    .toEqual({ name: "My cleanup", model: "draft-model" });
  await page.setViewportSize({ width: 760, height: 680 });
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
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

test("prompt saves and model responses appear as dismissible toasts", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
  });
  await page.goto("/#/prompts?section=models");
  await page.getByLabel("Model identifier", { exact: true }).fill("new-model");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const saved = page.locator('[data-slot="toast"]').filter({ hasText: "Prompts saved." });
  await expect(saved).toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.model)).toBe(
    "new-model",
  );
  await saved.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(saved).toBeHidden();
  await page.getByRole("button", { name: "Test model", exact: true }).click();
  const response = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: "Model responded successfully." });
  await expect(response).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("Model responded successfully.", { exact: true }),
  ).toHaveCount(0);
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Prompts saved." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts[0].name),
  ).toBe("Retry cleanup");
});

test("model testing stays inside the card and cancellation remains available", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.textProcessing.enabled = true;
    window.dictationTest.snapshot.textProcessing.model = "saved-model";
    Reflect.set(
      Reflect.get(window, "go").main.App,
      "TestTextModel",
      async () => new Promise<string>((resolve) => Reflect.set(window, "finishModelTest", resolve)),
    );
  });
  await page.goto("/#/prompts?section=models");
  const card = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Text model", exact: true }),
  });
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
  await expect(dialog).toContainText("removed when you save your changes");
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
  await expect(page.getByText("Automatic processing is off.", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "RefinePrompt");
  });
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await page.getByRole("button", { name: "Refine prompt", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Prompt refinement needs the current backend",
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
  await page.getByRole("checkbox", { name: "Light cleanup" }).check();
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.microphoneId))
    .toBe("unplugged");
});

test("unchanged enabled startup registration can refresh its path", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.settings.launchAtLogin = true;
  });
  await page.goto("/#/settings");
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.launchAtLogin))
    .toBe(true);
});

test("setup ignores an older microphone enumeration reply", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.settings.setupComplete = false;
    const app = Reflect.get(window, "go").main.App;
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
  const current = page.getByRole("region", { name: "Current speech model" });
  await expect(current).toContainText("Whisper Small");
  await expect(page.getByRole("group", { name: "Model storage" })).toContainText("713.2 MB");
  await page.screenshot({ path: testInfo.outputPath("models-redesign-dark.png"), fullPage: true });
  await page
    .getByRole("region", { name: "Whisper Base", exact: true })
    .getByRole("button", { name: "Use model", exact: true })
    .click();
  await expect(current).toContainText("Whisper Base");
  await expect(
    page.getByRole("button", { name: "Remove Whisper Base", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove Whisper Small", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    localStorage.setItem("desktop-theme", "light");
  });
  await page.reload();
  await expect(current).toContainText("Whisper Small");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("models-redesign-light.png"), fullPage: true });
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible();
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

test("Models groups families in accessible accordions and reveals downloads from Home", async ({
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
  const whisper = page.getByRole("button", { name: "Whisper models", exact: true });
  const parakeet = page.getByRole("button", { name: "NVIDIA Parakeet models", exact: true });
  const moonshine = page.getByRole("button", { name: "Moonshine models", exact: true });
  await expect(whisper).toContainText("5 models");
  await expect(parakeet).toContainText("1 model");
  await expect(moonshine).toContainText("4 models");
  await expect(whisper).toHaveAttribute("aria-expanded", "false");
  await expect(parakeet).toHaveAttribute("aria-expanded", "false");
  await expect(moonshine).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Moonshine Base", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Whisper Tiny", exact: true })).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("model-families-desktop.png"),
    fullPage: true,
  });
  await moonshine.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(parakeet).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(parakeet).toHaveAttribute("aria-expanded", "true");
  await whisper.click();
  await expect(moonshine).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("region", { name: "Whisper models", exact: true }).getByRole("region"),
  ).toHaveCount(5);
  await expect(
    page.getByRole("region", { name: "NVIDIA Parakeet models", exact: true }).getByRole("region"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Moonshine models", exact: true }).getByRole("region"),
  ).toHaveCount(4);
  for (const [name, accuracy, speed] of [
    ["Whisper Tiny", "Basic", "Fastest"],
    ["Whisper Base", "Fair", "Very fast"],
    ["Whisper Small", "Good", "Fast"],
    ["Whisper Medium", "Better", "Moderate"],
    ["Whisper Large v3", "Best", "Slower"],
    ["NVIDIA Parakeet TDT v3", "High", "Fast"],
    ["Moonshine V2 Tiny", "Lower", "Fastest"],
    ["Moonshine Base", "Good", "Very fast"],
    ["Moonshine V2 Small", "Good", "Very fast"],
    ["Moonshine V2 Medium", "Better", "Fast"],
  ]) {
    const card = page.getByRole("region", { name, exact: true });
    await expect(card.getByRole("meter", { name: "Accuracy", exact: true })).toHaveAttribute(
      "aria-valuetext",
      accuracy,
    );
    await expect(card.getByRole("meter", { name: "Speed", exact: true })).toHaveAttribute(
      "aria-valuetext",
      speed,
    );
  }
  const tinyCard = page.getByRole("region", { name: "Whisper Tiny", exact: true });
  await expect(tinyCard).toContainText(
    "Quick notes and short messages on less powerful computers.",
  );
  const headingBounds = await tinyCard.getByRole("heading").boundingBox();
  const ratingBounds = await tinyCard.getByRole("meter", { name: "Accuracy" }).boundingBox();
  expect(ratingBounds!.x).toBeGreaterThan(headingBounds!.x);
  await page
    .getByRole("button", { name: "Supported languages for Whisper Tiny", exact: true })
    .hover();
  const languages = page.locator('[data-slot="tooltip-content"][data-open]');
  await expect(languages).toContainText("99 languages");
  await expect(languages).toHaveCSS("opacity", "1");
  await expect(languages).toContainText("Japanese");
  await expect(languages).toContainText("Yoruba");
  expect((await languages.locator("p").last().innerText()).split(", ")).toHaveLength(99);
  await page.screenshot({
    path: testInfo.outputPath("model-card-languages-desktop.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Supported languages for Whisper Large v3", exact: true })
    .focus();
  await expect(languages).toContainText("100 languages");
  await expect(languages).toContainText("Cantonese");
  await page.keyboard.press("Escape");
  const parakeetBadge = page.getByRole("button", {
    name: "Supported languages for NVIDIA Parakeet TDT v3",
    exact: true,
  });
  await parakeetBadge.focus();
  await expect(languages).toContainText("25 languages");
  expect((await languages.locator("p").last().innerText()).split(", ")).toHaveLength(25);
  await expect(languages).toContainText("Maltese");
  await page.keyboard.press("Escape");
  const moonshineCard = page.getByRole("region", { name: "Moonshine Base", exact: true });
  await expect(moonshineCard.getByText("English only", { exact: true })).toBeVisible();
  await expect(moonshineCard.getByText("Multilingual", { exact: true })).toHaveCount(0);
  await moonshine.focus();
  await page.keyboard.press("Space");
  await expect(moonshine).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "Moonshine Base", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 480, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("model-families-narrow.png"), fullPage: true });
  await page
    .getByRole("button", { name: "Supported languages for Whisper Tiny", exact: true })
    .focus();
  await expect(languages).toContainText("99 languages");
  await expect(languages).toHaveCSS("opacity", "1");
  const tooltipBounds = await languages.boundingBox();
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(480);
  expect(tooltipBounds!.y).toBeGreaterThanOrEqual(0);
  expect(tooltipBounds!.y + tooltipBounds!.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: testInfo.outputPath("model-card-languages-narrow.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await simulateModelDownload(page);
  await page.getByRole("combobox", { name: "Speech model", exact: true }).click();
  await page.getByRole("option", { name: /NVIDIA Parakeet TDT v3/ }).click();
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(moonshine).toHaveAttribute("aria-expanded", "true");
  await expect(parakeet).toHaveAttribute("aria-expanded", "true");
  await expect(parakeet).toContainText("Downloading");
  await expect(page.getByRole("progressbar", { name: "Model download progress" })).toBeVisible();
  await parakeet.click();
  await expect(parakeet).toHaveAttribute("aria-expanded", "false");
  await expect(parakeet).toContainText("Downloading");
  await parakeet.click();
  await page.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(parakeet).not.toContainText("Downloading");
  await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
    "Moonshine Base",
  );
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
    await page.getByRole("link", { name: "Models", exact: true }).click();
    const family = model.id.startsWith("moonshine")
      ? "Moonshine"
      : model.id.startsWith("parakeet")
        ? "NVIDIA Parakeet"
        : "Whisper";
    const group = page.getByRole("button", { name: `${family} models`, exact: true });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    const card = page.getByRole("region", { name: model.name, exact: true });
    await expect(card.getByText("Download size", { exact: true })).toBeVisible();
    await expect(card.getByRole("meter", { name: "Accuracy", exact: true })).toBeVisible();
    await expect(card.getByRole("meter", { name: "Speed", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Download & use", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs))
      .toEqual([model.id]);
    await expect(card.getByRole("progressbar", { name: "Model download progress" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
      "Whisper Tiny",
    );
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
    await expect(card.getByRole("button", { name: "Active", exact: true })).toBeDisabled();
    await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
      model.name,
    );
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
  await page.getByRole("combobox", { name: "Speech model", exact: true }).click();
  await page.getByRole("option", { name: /Whisper Small/ }).click();
  await page.getByRole("link", { name: "Models", exact: true }).click();
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
  await expect(
    page
      .getByRole("region", { name: "Whisper Tiny", exact: true })
      .getByRole("button", { name: "Active", exact: true }),
  ).toBeDisabled();
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
  await page.getByRole("link", { name: "Models", exact: true }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "65");
  await small.getByRole("button", { name: "Cancel download", exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(small.getByRole("button", { name: "Download & use", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Current speech model" })).toContainText(
    "Whisper Tiny",
  );
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
  await expect(small.getByRole("button", { name: "Active", exact: true })).toBeDisabled();
});

test("Models handles custom selections and missing model files", async ({ page }) => {
  await homeModelScenario(page, true);
  await simulateModelDownload(page);
  await page.goto("/#/models");
  const current = page.getByRole("region", { name: "Current speech model" });
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
    page.getByRole("button", { name: "Remove Whisper Small", exact: true }),
  ).toBeDisabled();
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
  await expect(page.getByRole("button", { name: "Active", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check & repair runtime", exact: true }).click();
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
      indicatorThemes: boolean[];
      callbacks: Record<string, (...args: unknown[]) => void>;
      deferSnapshots: boolean;
      failSnapshot: boolean;
      legacySnapshot: boolean;
      installedModelIDs: string[];
      pendingSnapshots: (() => void)[];
      deferHistory: boolean;
      pendingHistory: { query: string; resolve: () => void }[];
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: Window["dictationTest"] = {
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
      runtime: {
        OnFileDrop(
          handler: (x: number, y: number, paths: string[]) => void,
          useDropTarget: boolean,
        ) {
          if (useDropTarget) throw new Error("Expected window-wide audio drops");
          state.callbacks["wails:file-drop"] = handler as (...args: unknown[]) => void;
        },
        OnFileDropOff() {
          delete state.callbacks["wails:file-drop"];
        },
        ClipboardSetText: async (text: string) => {
          if (state.failClipboard) return false;
          state.clipboard = text;
          return true;
        },
        EventsOnMultiple(topic: string, handler: (...args: unknown[]) => void) {
          state.callbacks[topic] = handler;
          return () => {
            delete state.callbacks[topic];
          };
        },
      },
      go: {
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
            GetHistory: async (query: string, page: number) => {
              if (state.failHistory) throw new Error("History load failed");
              const entries = state.snapshot.history.filter((entry) =>
                [entry.rawTranscript, entry.finalTranscript].some((text) =>
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
            DeleteSessions: async (ids: string[]) => {
              if (state.failSave) throw new Error("History deletion failed");
              state.snapshot.history = state.snapshot.history.filter(
                (entry) => !ids.includes(entry.id),
              );
              state.outputs = state.outputs.filter((output) => !ids.includes(output.sessionId));
              state.history();
            },
            ExportSessions: async (ids: string[]) => {
              state.exportedText = state.snapshot.history
                .filter((entry) => ids.includes(entry.id))
                .map((entry) => entry.finalTranscript)
                .join("\n");
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
            ExportSession: async (id: string) => {
              state.exportedText =
                state.snapshot.history.find((entry) => entry.id === id)?.finalTranscript ?? "";
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
});

// Wait for React to commit after releasing a deliberately delayed bridge reply.
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

test("startup options apply only on save and survive refreshes and failed saves", async ({
  page,
}) => {
  await page.goto("/#/settings?section=general");
  const login = page.getByRole("checkbox", {
    name: "Launch at login",
    exact: true,
  });
  const background = page.getByRole("checkbox", {
    name: /Start in tray \/ menu bar/,
  });
  await expect(login).toBeEnabled();
  await expect(login).not.toBeChecked();
  await expect(background).not.toBeChecked();
  await login.check();
  await background.check();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.launchAtLogin))
    .toBe(false);
  await page.evaluate(() => {
    window.dictationTest.history();
    window.dictationTest.failSave = true;
  });
  await settle(page);
  await expect(login).toBeChecked();
  await expect(background).toBeChecked();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await expect(login).toBeChecked();
  await expect(background).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.launchAtLogin))
    .toBe(false);
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  const login = page.getByRole("checkbox", {
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
  await expect(page.getByRole("checkbox", { name: /Start in tray \/ menu bar/ })).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "Launch at login unavailable: access denied" }),
  ).toBeVisible();
});

test("history refresh preserves edits, and saving clears the dirty state", async ({ page }) => {
  await page.goto("/#/settings");
  const shortcut = page.getByLabel("Global shortcut", { exact: true });
  await expect(shortcut).toHaveValue("Ctrl+Alt+Space");
  await shortcut.fill("Ctrl+Alt+P");
  await page.getByRole("combobox", { name: "Microphone" }).click();
  await page.getByRole("option", { name: "USB microphone", exact: true }).click();
  await page.evaluate(() => window.dictationTest.history());
  await settle(page);
  await expect(shortcut).toHaveValue("Ctrl+Alt+P");
  await expect(page.getByRole("combobox", { name: "Microphone" })).toContainText("USB microphone");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0);
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.language = "en";
    window.dictationTest.history();
  });
  await settle(page);
  await expect(shortcut).toHaveValue("Ctrl+Alt+P");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
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
  await expect(page.getByText("Fresh history entry", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Start recording" })).toBeDisabled();
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
  await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
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
  await page.screenshot({
    path: testInfo.outputPath("vocabulary-desktop.png"),
    animations: "disabled",
  });
  await page.getByLabel("Preferred spelling", { exact: true }).first().fill("Postgres");
  const save = page.getByRole("button", { name: "Save vocabulary", exact: true });
  const discard = page.getByRole("button", { name: "Discard changes", exact: true });
  for (const width of [600, 360]) {
    await page.setViewportSize({ width, height: 700 });
    await page.getByRole("button", { name: "Remove Yap", exact: true }).scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await expect(discard).toBeInViewport();
    await expect(
      page.getByRole("status", { name: "" }).filter({ hasText: "Unsaved changes" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`vocabulary-${width}.png`),
      animations: "disabled",
    });
  }
  await discard.click();
  await expect(page.getByLabel("Preferred spelling", { exact: true }).first()).toHaveValue(
    "PostgreSQL",
  );
  await expect(save).toBeDisabled();
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
  await page.getByRole("button", { name: "Save vocabulary" }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Vocabulary save failed" }),
  ).toBeVisible();
  await expect(table.getByLabel("Preferred spelling", { exact: true })).toHaveValue(" PostgreSQL ");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Save vocabulary" }).click();
  await expect(table.getByLabel("Preferred spelling", { exact: true })).toHaveValue("PostgreSQL");
  await expect(page.getByRole("button", { name: "Save vocabulary" })).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].aliases.join("|")))
    .toBe("postgres|post gre SQL");
  await table.getByRole("checkbox", { name: "Enabled", exact: true }).uncheck();
  await page.getByRole("button", { name: "Save vocabulary" }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].enabled))
    .toBe(false);
  await page.getByRole("button", { name: "Remove PostgreSQL" }).click();
  await page.getByRole("button", { name: "Save vocabulary" }).click();
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
  const copy = page.getByRole("checkbox", { name: /Copy automatically to clipboard/ });
  const paste = page.getByRole("checkbox", { name: /Paste automatically/ });
  await expect(copy).toBeChecked();
  await expect(paste).toBeEnabled();
  await copy.uncheck();
  await expect(paste).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoCopy))
    .toBe(true);
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(copy).toBeChecked();
  await copy.uncheck();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await expect(copy).not.toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoCopy))
    .toBe(true);
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.autoCopy))
    .toBe(true);
});

test("light cleanup defaults off and applies only after settings save", async ({ page }) => {
  await page.goto("/#/settings");
  const cleanup = page.getByRole("checkbox", { name: /Light cleanup/ });
  await expect(cleanup).not.toBeChecked();
  await cleanup.check();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText))
    .toBe(false);
  await page.evaluate(() => window.dictationTest.history());
  await settle(page);
  await expect(cleanup).toBeChecked();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
    await expect(page.getByText("Microphone test passed", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Check & repair runtime", exact: true }).click();
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
    Reflect.get(window, "go").main.App.StopMicrophoneTest = async () => {
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
  await page.getByRole("link", { name: "Models", exact: true }).click();
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
  await expect(page.getByText("Microphone test passed", { exact: true })).toBeVisible();
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
  const recent = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recent dictations", exact: true }),
  });
  await expect(recent.getByRole("article")).toHaveCount(3);
  await expect(recent.getByRole("article").first()).toContainText("Result");
  await expect(recent.getByRole("article").first()).toContainText("Whisper Small");
  await expect(recent.getByRole("article").nth(1)).toContainText("Transcription");
  await expect(recent.getByRole("checkbox")).toHaveCount(0);
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await recent.screenshot({
      path: testInfo.outputPath(`recent-dictations-${width}.png`),
      animations: "disabled",
    });
  }
  await recent.getByRole("link", { name: /A Paris-based AI lab/ }).click();
  await expect(page).toHaveURL(/#\/history\/summary$/);
  await page.goto("/");
  await page.getByRole("link", { name: "View all", exact: true }).click();
  await expect(page).toHaveURL(/#\/history$/);
  await page.setViewportSize({ width: 1280, height: 900 });
  const cards = page.getByRole("article");
  await expect(cards.first()).toContainText("Result");
  await expect(cards.nth(1)).toContainText("Transcription");
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
    name: "Select page",
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
  await page.getByText("Select page", { exact: true }).click();
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
  await expect(page.getByRole("heading", { name: "Dictation", exact: true })).toBeFocused();
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
  const dialog = page.getByRole("dialog", {
    name: "Edit transcript",
    exact: true,
  });
  await expect(
    dialog.getByRole("region", { name: "Original transcription", exact: true }),
  ).toContainText("um yesterday");
  await expect(dialog.getByRole("textbox", { name: "Editable text", exact: true })).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("editor-comparison.png"),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
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
  const dialog = page.getByRole("dialog", { name: "Edit transcript", exact: true });
  const input = dialog.getByRole("textbox", { name: "Editable text" });
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
    const save = dialog.getByRole("button", { name: "Save transcript", exact: true });
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
  await dialog.getByRole("button", { name: "Save transcript", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(changes.locator("ins").last()).toContainText("on Friday");
  await contents.getByRole("tab", { name: "Transcription", exact: true }).click();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Send PostgreSQL on Friday.\n\nConfirm the meeting with the team.");
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await input.fill("Send postgres tomorrow.\n\nConfirm the meeting with the team.");
  await dialog.getByRole("button", { name: "Save transcript", exact: true }).click();
  await expect(contents.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Transcription", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await input.fill("New saved transcription.");
  await dialog.getByRole("button", { name: "Save transcript", exact: true }).click();
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

test("dictation pages preserve the History search and page when returning and deleting", async ({
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
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
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
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await expect(page.getByLabel("Search transcripts")).toHaveValue("Original");
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Dictation 50\b/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete this dictation?",
    exact: true,
  });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await dialog.getByRole("button", { name: "Delete dictation", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("History deletion failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Delete dictation", exact: true }).click();
  await expect(page).toHaveURL(/#\/history\?q=Original&page=1$/);
  await expect(page.getByLabel("Search transcripts")).toHaveValue("Original");
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dictation 51\b/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dictation 50\b/ })).toHaveCount(0);
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
    Reflect.set(Reflect.get(window, "go").main.App, "GetSnapshot", async () => ({
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
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "GetSession");
  });
  await page.goto("/#/history/one");
  await expect(page.getByRole("alert").filter({ hasText: "restart wails dev" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Generate output", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  await page.getByRole("option", { name: "Summary", exact: true }).click();
  const generate = page.getByRole("button", { name: "Generate output", exact: true });
  await generate.hover();
  await page.mouse.down();
  await expect(generate).toHaveCSS("transform", "matrix(0.98, 0, 0, 0.98, 0, 0)");
  await expect(generate).toHaveCSS("opacity", "1");
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.processing?.input))
    .toBe("Test the new model and compare its recognition of names and technical terms.");
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Original transcription", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dictationTest.processing!.resolve(
      "Compare the new model's recognition of names and technical terms.",
    ),
  );
  await settle(page);
  await expect(page.getByRole("tab", { name: "Original", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Output prompt", exact: true })).toContainText(
    "Summary",
  );
  const first = page
    .getByRole("article", { name: "Summary output", exact: true })
    .filter({ hasText: "Compare the new model's recognition" });
  await expect(first).toContainText("local-model");
  await expect(generate).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await first.getByText("Input and prompt", { exact: true }).click();
  await expect(first).toContainText("Test the new model and compare its recognition");
  await first.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Compare the new model's recognition of names and technical terms.");
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Editable text", exact: true })
    .fill("Updated transcription for the next comparison.");
  await page.getByRole("button", { name: "Save transcript", exact: true }).click();
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Updated transcription",
  );
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.snapshot.textProcessing.model = "new-model";
    state.snapshot.textProcessing.prompts = state.snapshot.textProcessing.prompts.filter(
      (prompt) => prompt.id !== "summary",
    );
    state.callbacks["setup:changed"]();
  });
  await first.getByRole("button", { name: "Regenerate", exact: true }).click();
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
  await expect(second).toContainText("new-model");
  await expect(first).toBeVisible();
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Updated transcription",
  );
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Original transcription", exact: true }),
  ).toContainText("um we should test");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await first.getByText("Input and prompt", { exact: true }).click();
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
  await expect(first).toContainText("local-model");
  await expect(second).toContainText("new-model");
  await first.getByRole("button", { name: "Delete output", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete this output?",
    exact: true,
  });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await dialog.getByRole("button", { name: "Delete output", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Output deletion failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Delete output", exact: true }).click();
  await expect(first).toHaveCount(0);
  await expect(second).toBeVisible();
  await page.getByRole("tab", { name: "Transcription", exact: true }).click();
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Updated transcription",
  );
});

test("failed, cancelled and abandoned output generation never adds a late result", async ({
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
  await page.getByRole("button", { name: "Generate output", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Model unavailable" })).toBeVisible();
  await expect(page.getByText("No generated outputs yet.", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failProcessing = false;
  });
  await page.getByRole("button", { name: "Generate output", exact: true }).click();
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
  await page.getByRole("button", { name: "Generate output", exact: true }).click();
  await page.evaluate(() => window.dictationTest.processing!.resolve("Successful retry"));
  await expect(page.getByRole("article")).toContainText("Successful retry");
  await page.getByRole("button", { name: "Generate output", exact: true }).click();
  const requestID = await page.evaluate(() => window.dictationTest.processing!.id);
  await page.getByRole("link", { name: "Back to History", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate((id) => window.dictationTest.cancelledProcessing.includes(id), requestID),
    )
    .toBe(true);
  await page.evaluate(() => window.dictationTest.processing!.resolve("Late after navigation"));
  await settle(page);
  expect(
    await page.evaluate(() => window.dictationTest.outputs.map((output) => output.text)),
  ).toEqual(["Successful retry"]);
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    "Edited speech",
  );
  expect(await page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("");
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
  await expect(page.getByRole("button", { name: "Generate output", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.failOutputs = false;
  });
  await page.getByRole("button", { name: "Retry outputs", exact: true }).click();
  const output = page.getByRole("article", {
    name: "Saved summary output",
    exact: true,
  });
  await expect(output).toContainText("previous-model");
  await expect(output.getByRole("button", { name: "Regenerate", exact: true })).toBeDisabled();
  await output.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("A saved summary");
  await output.getByRole("button", { name: "Delete output", exact: true }).click();
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
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "GetSessionOutputs");
  });
  await page.goto("/#/history/one");
  await expect(page.getByRole("region", { name: "Result", exact: true })).toContainText(
    "Edited speech",
  );
  await expect(page.getByRole("button", { name: "Copy result", exact: true })).toBeEnabled();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "restart wails dev" })).toBeVisible();
  await page.evaluate(() => {
    Reflect.set(Reflect.get(window, "go").main.App, "GetSessionOutputs", async () => []);
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
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Stop microphone test", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your speech model", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop microphone test", exact: true }),
  ).toBeVisible();
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
  const testDictation = page.getByRole("button", {
    name: "Test dictation",
    exact: true,
  });
  await expect(testDictation).toBeEnabled();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P");
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(testDictation).toBeDisabled();
  await expect(
    page.getByText("Save settings before testing the changes.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await page.getByText("Technical details", { exact: true }).click();
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
  await page.getByRole("button", { name: "Test dictation", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Models", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop test recording", exact: true }).click();
  await expect(page.getByText("Transcribing test…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page.getByRole("tab", { name: "Advanced", exact: true }).click();
  await expect(page.getByText("Test cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeEnabled();
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
  const dialog = page.getByRole("dialog", { name: "Edit transcript" });
  const input = dialog.getByRole("textbox", {
    name: "Editable text",
    exact: true,
  });
  await expect(input).toHaveValue("Send PostgreSQL.");
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Save transcript" })).toBeDisabled();
  await input.fill("Send PostgreSQL to Benji.\nThanks!");
  await dialog.getByRole("button", { name: "Save transcript" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Send PostgreSQL to Benji.\nThanks!", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript))
    .toBe("Send PostgreSQL to Benji.\nThanks!");
  await page.getByRole("button", { name: "Export result", exact: true }).click();
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
  const dialog = page.getByRole("dialog", { name: "Edit transcript" });
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
  await dialog.getByRole("button", { name: "Save transcript" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Transcript save failed");
  await expect(input).toHaveValue("My correction.");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Original plain transcript.");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await input.press("Control+Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("My correction.", { exact: true })).toBeVisible();
});

test("cancel and Escape discard edits, empty edits cannot be saved, and outside clicks keep the draft", async ({
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
  const dialog = page.getByRole("dialog", { name: "Edit transcript" });
  const input = dialog.getByRole("textbox", {
    name: "Editable text",
    exact: true,
  });
  await input.fill(" \n ");
  await expect(dialog.getByRole("button", { name: "Save transcript" })).toBeDisabled();
  await input.fill("Discard this.");
  await page.mouse.click(5, 5);
  await expect(input).toHaveValue("Discard this.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Original plain transcript.");
  await edit.click();
  await expect(input).toHaveValue("Original plain transcript.");
  await input.fill("Escape this.");
  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("Original plain transcript.");
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
  const dialog = page.getByRole("dialog", { name: "Edit transcript" });
  await dialog.getByRole("textbox", { name: "Editable text", exact: true }).fill("Keep my draft.");
  await page.evaluate(() => {
    window.dictationTest.snapshot.history = [];
    window.dictationTest.history();
  });
  await settle(page);
  await dialog.getByRole("button", { name: "Save transcript" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This dictation no longer exists");
  await expect(dialog.getByRole("textbox", { name: "Editable text", exact: true })).toHaveValue(
    "Keep my draft.",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
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
  await expect(add).toBeDisabled();
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
  await expect(page.getByRole("dialog", { name: "Edit transcript" })).toBeVisible();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("PostgreSQL connection ready.");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Vocabulary", exact: true })
    .click();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript))
    .toBe("postgres connection ready.");
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
  await expect(add).toBeDisabled();
  await input.fill("Two\nlines");
  await input.press("Control+A");
  await expect(add).toBeDisabled();
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

test("History pages select and export only the current page, and recover after deleting its last entries", async ({
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
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select page", exact: true }).check();
  await expect(page.getByText("50 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText("50 selected", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select page", exact: true }).check();
  await page.getByRole("button", { name: "Export selected", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.exportedText))
    .toBe("Dictation 50\nDictation 51");
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Delete 2 dictations?" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(52);
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Delete 2 dictations?" });
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await dialog.getByRole("button", { name: "Delete dictations", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("History deletion failed");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Delete dictations", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(50);
  await expect(page.getByText("50 dictations", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Dictation 0\b/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "History pages" })).toHaveCount(0);
});

test("History keeps its header, search and selection controls visible while scrolling", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("yap-sidebar-collapsed", "true");
    localStorage.setItem("desktop-theme", "dark");
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
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).check();
  for (const width of [1280, 760, 360]) {
    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect.poll(async () => (await title.boundingBox())!.y).toBeLessThan(30);
    const controls = [
      title,
      search,
      importAudio,
      page.getByRole("button", { name: "Export selected", exact: true }),
      page.getByRole("button", { name: "Delete selected", exact: true }),
    ];
    for (const control of controls) {
      const bounds = await control.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThan(width === 360 ? 380 : 300);
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
  await expect(page.getByRole("checkbox", { name: "Select page", exact: true })).toBeDisabled();
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Enable automatic deletion?" });
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays))
    .toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(1);
  await expect(retention.locator('[data-slot="select-value"]')).toHaveText("30 days");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Enable automatic deletion?" });
  await dialog.getByRole("button", { name: "Save and delete older history", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings save failed" }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length))
    .toBe(1);
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Enable automatic deletion?", exact: true })
    .getByRole("button", { name: "Save and delete older history", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays))
    .toBe(30);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Settings saved." }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await expect(page.getByRole("group", { name: "Model storage" })).toContainText("5 MB");
  await expect(page.getByRole("group", { name: "Model storage" })).toContainText(
    "2 models downloaded",
  );
  await expect(
    page.getByRole("button", { name: "Remove Whisper Base", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Remove Whisper Tiny", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Remove Whisper Tiny?" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("group", { name: "Model storage" })).toContainText("5 MB");
  await page.getByRole("button", { name: "Remove Whisper Tiny", exact: true }).click();
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
  await expect(page.getByRole("group", { name: "Model storage" })).toContainText("3 MB");
  await expect(page.getByRole("group", { name: "Model storage" })).toContainText(
    "1 model downloaded",
  );
  await expect(page.getByRole("button", { name: "Remove Whisper Tiny", exact: true })).toHaveCount(
    0,
  );
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

test("shortcut capture waits for key release, changes only the draft and preserves other settings edits", async ({
  page,
}) => {
  await page.goto("/#/settings?section=history");
  await page.getByRole("checkbox", { name: /Keep recordings/ }).check();
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
  await expect(page.getByRole("checkbox", { name: /Keep recordings/ })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+Space");
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("");
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureEnded)).toBe(1);
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+P");
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
  });
  dialog = await recordShortcut(page);
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+p");
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "could not restore the saved shortcut" }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failRestore = false;
    window.dictationTest.occupiedShortcut = "Ctrl+Alt+P";
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "your saved shortcut is unchanged" }),
  ).toBeVisible();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut))
    .toBe("Ctrl+Alt+Space");
  await page.evaluate(() => {
    window.dictationTest.occupiedShortcut = "";
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Dictate", exact: true })
    .click();
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
  await page.getByRole("checkbox", { name: "Enable LLM processing" }).check();
  await page.getByLabel("Model identifier").fill("my-local-model");
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
  await expect(page.getByText("Automatic processing is off.", { exact: true })).toBeVisible();
  await automatic.check();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await expect(page.getByRole("button", { name: "Test model", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.enabled))
    .toBe(false);
  await page.evaluate(() => {
    window.dictationTest.history();
    window.dictationTest.failSave = true;
  });
  await settle(page);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Technical ticket");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Prompts save failed" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await expect(page.getByLabel("Model identifier")).toHaveValue("my-local-model");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
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
  await expect(page.getByText("Automatic processing is off.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByRole("checkbox", { name: "Enable LLM processing" }).uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await page.getByRole("button", { name: "Process text", exact: true }).click();
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
  await page.getByRole("button", { name: "Save transcript", exact: true }).click();
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
  await page.getByRole("button", { name: "Export result", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.exportedText)).toBe(source);
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Editable text" })).toHaveValue(source);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
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
  await output.getByRole("button", { name: "Copy output", exact: true }).click();
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
  await page.getByRole("button", { name: "Save transcript", exact: true }).click();
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
  await page.getByRole("button", { name: "Process text", exact: true }).click();
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
        : page.getByRole("checkbox", { name: /^Keep recordings/ });
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
      await page.getByRole("button", { name: "Save vocabulary", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.dictationTest.snapshot.vocabulary.map((v) => v.canonical).join(","),
          ),
        )
        .toBe("PostgreSQL,Benji");
    } else {
      await control.check();
      await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
        : page.getByRole("checkbox", { name: /^Keep recordings/ });
    await expect(page.getByText("Snapshot unavailable", { exact: true })).toBeVisible();
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
    page.getByRole("button", { name: "Remove Whisper Tiny", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Repair & use", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.installedModelIDs))
    .toEqual(["tiny"]);
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.history();
  });
  await expect(page.getByRole("button", { name: "Active", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove Whisper Tiny", exact: true }),
  ).toBeDisabled();
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
  await expect(page.getByRole("heading", { name: "Prompts", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Enable LLM processing" })).toBeDisabled();
  await page.evaluate(() => {
    window.dictationTest.legacySnapshot = false;
  });
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Enable LLM processing" })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.legacySnapshot = true;
    window.dictationTest.history();
  });
  await expect(page.getByRole("alert").filter({ hasText: "different versions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompts", exact: true })).toBeVisible();
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
    page.getByText("Server responded. 2 models available.", { exact: true }),
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
  await page.getByRole("checkbox", { name: "Enable LLM processing" }).check();
  await expect(page.getByRole("button", { name: "Test model", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh models", exact: true }).click();
  await page.getByRole("tab", { name: "Prompts", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My cleanup");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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

test("server presets discover LM Studio and preserve saved choices until Save", async ({
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
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.endpoint)).toBe(
    "http://127.0.0.1:11434/v1",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  expect(await page.evaluate(() => window.dictationTest.snapshot.textProcessing.endpoint)).toBe(
    "http://127.0.0.1:1234/v1",
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
    page.getByText("Server responded. 1 model available.", { exact: true }),
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
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
  await expect(page.getByRole("tablist", { name: "Settings sections", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.model))
    .toBe("");
});

test("older backends show discovery restart guidance without hiding Prompts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "ListTextModels");
  });
  await page.goto("/#/prompts?section=models");
  await expect(page.getByRole("alert").filter({ hasText: "restart wails dev" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompts", exact: true })).toBeVisible();
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
    Reflect.set(state.snapshot.settings, "shortcut", null);
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
    window.dictationTest.snapshot.settings.shortcut = "Ctrl+Alt+Space";
  });
  await page.getByRole("button", { name: "Retry interface", exact: true }).click();
  await expect(page.getByRole("region", { name: "Dictation recorder", exact: true })).toBeVisible();
  await expect(page.getByText("Saved correction", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Spoken language", exact: true })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("German");
  await expect(page.getByRole("checkbox", { name: /^Light cleanup/ })).toBeChecked();
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
      Reflect.set(state.snapshot.settings, "shortcut", null);
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
  await expect(page.getByText("Persisted history", { exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Spoken language", exact: true })
      .locator('[data-slot="select-value"]'),
  ).toHaveText("German");
  await page.getByRole("tab", { name: "History & data", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Keep recordings/ })).toBeChecked();
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
  await expect(page.getByRole("checkbox", { name: "Enable LLM processing" })).toBeDisabled();
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
  await expect(page.getByRole("checkbox", { name: "Enable LLM processing" })).toBeChecked();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "History", exact: true }).click();
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
  await page.getByRole("checkbox", { name: /^Keep recordings/ }).check();
  await expect(panel.getByRole("button", { name: "Restore backup", exact: true })).toBeDisabled();
  await expect(
    panel.getByText("Save your settings before using backups.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await page.getByRole("link", { name: "History", exact: true }).click();
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
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "PreviewBackup");
  });
  await page.goto("/#/settings?section=history");
  const panel = page.getByRole("region", {
    name: "Backup & restore",
    exact: true,
  });
  await panel.getByRole("button", { name: "Restore backup", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("restart wails dev");
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
  await page.getByRole("link", { name: "History", exact: true }).click();
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  const overlay = page.getByRole("status").filter({ hasText: "Drop one audio file to import" });
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
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Cancel transcription", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await dropAudioFiles(page, ["C:\\Audio\\interview.mp3"]);
  await expect.poll(() => page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(2);
  expect(await page.evaluate(() => window.dictationTest.audioImports)).toBe(0);
  await page.getByRole("link", { name: "History", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeDisabled();
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
  // A genuinely new drag of that file still reports busy, then works after cancellation.
  await dropAudioFiles(page, ["C:\\Audio\\meeting.wav"]);
  await expect(page.getByRole("alert")).toContainText("Finish the current operation");
  await page.keyboard.press("F6");
  await page
    .locator('[data-slot="toast"][data-type="error"]')
    .getByRole("button", { name: "Dismiss notification" })
    .click();
  await expect(page.locator('[data-slot="toast"][data-type="error"]')).toHaveCount(0);
  await page.evaluate(() => {
    window.dictationTest.status("idle");
  });
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await dropAudioFiles(page, ["C:\\Audio\\meeting.wav"]);
  await expect.poll(() => page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(2);
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

test("audio drag and drop respects busy and unavailable models and clears drag feedback", async ({
  page,
}) => {
  await page.goto("/#/history");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "ordinary text");
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
  });
  await expect(page.getByText("Drop one audio file to import", { exact: true })).toBeHidden();
  await page.evaluate(() => window.dictationTest.status("recording"));
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["audio"], "meeting.wav"));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
  });
  const overlay = page
    .getByRole("status")
    .filter({ hasText: "Finish the current operation before importing audio" });
  await expect(overlay).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(overlay).toBeHidden();
  await dropAudioFiles(page, ["C:\\meeting.wav"]);
  await expect(page.getByRole("alert")).toContainText("Finish the current operation");
  await page.evaluate(() => {
    window.dictationTest.status("idle");
    window.dictationTest.snapshot.ready = false;
    window.dictationTest.history();
  });
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeDisabled();
  await dropAudioFiles(page, ["C:\\meeting.wav"]);
  await expect(page.getByRole("alert")).toContainText("Choose a speech model");
  expect(await page.evaluate(() => window.dictationTest.droppedAudio.length)).toBe(0);
});

test("audio drag and drop reports an outdated backend", async ({ page }) => {
  await page.goto("/#/history");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "ImportDroppedAudio");
  });
  await dropAudioFiles(page, ["C:\\meeting.wav"]);
  await expect(page.getByRole("alert")).toContainText("Audio import needs the current backend");
});

test("audio import is cancellable across navigation and results open from History", async ({
  page,
}) => {
  await page.goto("/#/history");
  await page.getByRole("button", { name: "Import audio", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dictationTest.audioImports)).toBe(1);
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Transcribing imported audio…" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Cancel transcription", exact: true }).click();
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
    Reflect.deleteProperty(Reflect.get(window, "go").main.App, "ImportAudio");
  });
  await button.click();
  await expect(page.getByRole("alert")).toContainText("Audio import needs the current backend");
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
  await expect(button).toBeDisabled();
});

test("history preference is shared between Home and Settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("switch", { name: "Save to history" }).click();
  await expect(page.getByRole("switch", { name: "Save to history" })).not.toBeChecked();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "History & data" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Save dictations to history" }),
  ).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Keep recordings" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Save dictations to history" }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
  await expect(panel).toContainText("Not saved");
  await page.screenshot({
    path: testInfo.outputPath("temporary-latest-result.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe(
    "Temporary text",
  );
  await panel.getByRole("button", { name: "Save to history", exact: true }).click();
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

test("unsaved page drafts survive navigation and explicit discard", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P");
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await page.getByLabel("Model identifier").fill("unsaved-local-model");
  await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
  await page.getByRole("button", { name: "Add term", exact: true }).click();
  await page.getByLabel("Preferred spelling", { exact: true }).fill("PostgreSQL");
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
  await page.getByRole("tab", { name: "Text model", exact: true }).click();
  await expect(page.getByLabel("Model identifier")).toHaveValue("unsaved-local-model");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveValue("PostgreSQL");
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+Space");
});

test("delivery warnings persist and recover the captured result after clipboard retry", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.evaluate(() => {
    const state = window.dictationTest;
    state.status("transcribing");
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
  await page.keyboard.press("F6");
  await warning.getByRole("button", { name: "Copy transcript" }).click();
  await expect(warning).toContainText("Couldn’t copy");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(5200);
  await expect(warning).toBeVisible();
  await page.evaluate(() => {
    window.dictationTest.failClipboard = false;
    window.dictationTest.snapshot.status.transcript = "A later result";
  });
  await page.keyboard.press("F6");
  await warning.getByRole("button", { name: "Copy transcript" }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.clipboard))
    .toBe("Recovered original text.");
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Copied to clipboard" }),
  ).toBeVisible();
});

test("dictation profiles create edit switch and delete", async ({ page }, testInfo) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Profile name").fill("Email");
  await dialog.getByRole("combobox", { name: "Spoken language", exact: true }).click();
  await page.getByRole("option", { name: "German", exact: true }).click();
  await dialog.getByRole("switch", { name: "Light cleanup" }).check();
  await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.language))
    .toBe("auto");
  await page.getByRole("button", { name: "Edit Email", exact: true }).click();
  await dialog.getByLabel("Profile name").fill("Work email");
  await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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

test("profile failures retain drafts and selection and Escape protects edits", async ({ page }) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Profile name").fill("Quick notes");
  await page.keyboard.press("Escape");
  await expect(dialog.getByText("Discard your unsaved profile changes?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not save profile");
  await expect(dialog.getByLabel("Profile name")).toHaveValue("Quick notes");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await selector.click();
  await page.getByRole("option", { name: "Quick notes", exact: true }).click();
  await expect(selector).toContainText("Default");
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Profile model unavailable" }),
  ).toBeVisible();
});

test("profile switching rebases untouched settings while preserving an unsaved shortcut", async ({
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
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Use Default", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Default", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Default", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Profile name")).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`modified profile icon and tooltip preserve the name and restore Default in ${theme}`, async ({
    page,
  }, testInfo) => {
    await homeModelScenario(page);
    await page.evaluate((theme) => localStorage.setItem("desktop-theme", theme), theme);
    await page.reload();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Spoken language", exact: true }).click();
    await page.getByRole("option", { name: "German", exact: true }).click();
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await page.setViewportSize({ width: 760, height: 560 });
    const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
    await expect(selector).toContainText("Default");
    await expect(selector).not.toContainText("(modified)");
    const marker = selector.getByRole("img", { name: "Modified profile" });
    await expect(marker).toBeInViewport();
    await marker.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Modified");
    await page.mouse.move(1, 1);
    await selector.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Modified");
    await page.mouse.move(1, 1);
    await page.getByRole("button", { name: "Start recording", exact: true }).focus();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
    await selector.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(selector).toBeFocused();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Modified");
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
  const selector = page.getByRole("combobox", { name: "Dictation profile", exact: true });
  await selector.click();
  await page.getByRole("option", { name: "Email", exact: true }).click();
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.cleanText = false;
    window.dictationTest.history();
  });
  await expect(selector).toContainText("Email");
  await expect(selector.getByRole("img", { name: "Modified profile" })).toBeVisible();
  await page.getByRole("link", { name: "Manage dictation profiles" }).click();
  await page.mouse.move(1, 1);
  await settle(page);
  await page.getByRole("img", { name: "Modified profile" }).hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText("Modified");
  await page.getByRole("button", { name: "Use Email", exact: true }).click();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await expect(selector).toContainText("Email");
  await expect(selector.getByRole("img", { name: "Modified profile" })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`setting indicators explain saved and unsaved cleanup changes in ${theme}`, async ({
    page,
  }, testInfo) => {
    await homeModelScenario(page);
    await page.evaluate((theme) => localStorage.setItem("desktop-theme", theme), theme);
    await page.reload();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const cleanup = page.getByRole("checkbox", { name: /^Light cleanup/ });
    const marker = page.getByRole("img", {
      name: "Light cleanup changed from Default",
      exact: true,
    });
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await expect(marker).toHaveCount(0);
    await page.getByText("Light cleanup", { exact: true }).click();
    await expect(cleanup).toBeChecked();
    await expect(marker).toBeVisible();
    await marker.hover();
    await expect(tooltip).toContainText("Changed from Default");
    await expect(tooltip).toContainText("Profile: Off");
    await expect(tooltip).toContainText("Current: On");
    await expect(tooltip).toContainText("Unsaved change — save to apply.");
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
    await page.evaluate(() => {
      window.dictationTest.failSave = true;
    });
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
    await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(cleanup).toBeChecked();
    await expect(marker).toBeVisible();
    await page.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(marker).toHaveCount(0);
    await page.evaluate(() => {
      window.dictationTest.failSave = false;
    });
    await cleanup.check();
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 760, height: 560 });
    await marker.hover();
    await expect(tooltip).toContainText("Profile: Off");
    await expect(tooltip).toContainText("Current: On");
    await expect(tooltip).not.toContainText("Unsaved");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`cleanup-setting-indicator-${theme}.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Use Default", exact: true }).click();
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
  await page.getByLabel("Speech model", { exact: true }).fill("/base");
  const model = page.getByRole("img", { name: "Speech model changed from Default", exact: true });
  await model.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Profile: Whisper Tiny",
  );
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    "Current: Whisper Base",
  );
  await page.getByLabel("Speech model", { exact: true }).fill("/tiny");
  await expect(model).toHaveCount(0);
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("tab", { name: "Dictation", exact: true }).click();
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
  await page.getByRole("button", { name: "Use Email", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Light cleanup/ })).toBeChecked();
  await expect(page.getByRole("img", { name: /changed from/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /^Light cleanup/ }).uncheck();
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
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
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
  await expect(tooltip).toContainText("Unsaved change");
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
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  await marker.hover();
  await expect(tooltip).toContainText("Current: Summary");
  await expect(tooltip).not.toContainText("Unsaved");
  await page.setViewportSize({ width: 760, height: 560 });
  await expect(marker).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Use Default", exact: true }).click();
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
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
  await page.getByRole("textbox", { name: "Chain name", exact: true }).fill("Meeting follow-up");
  await expect(page.getByRole("combobox", { name: "Step 1 input", exact: true })).toContainText(
    "Original transcription",
  );
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByRole("combobox", { name: "Step 2 prompt", exact: true }).click();
  await page.getByRole("option", { name: "Summary", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Step 2 input", exact: true })).toContainText(
    "Step 1: Cleanup",
  );
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByRole("combobox", { name: "Step 3 prompt", exact: true }).click();
  await page.getByRole("option", { name: "Email", exact: true }).click();
  await page.getByRole("combobox", { name: "Step 3 input", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Original transcription", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Saved transcript (including edits)", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: "Step 2: Summary", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Step 1: Cleanup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove step 1", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move step 1 down", exact: true })).toBeDisabled();
  await page.getByRole("switch", { name: "Run chain after dictation", exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("prompt-chain-editor-narrow.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
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
  await page.getByRole("dialog").getByRole("button", { name: "Delete chain", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  await page.getByRole("option", { name: "Follow-up (chain)", exact: true }).click();
  await page.getByRole("button", { name: "Run chain", exact: true }).click();
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
  await expect(page.getByRole("article", { name: "Summary output", exact: true })).toContainText(
    "A short summary.",
  );
  expect(await page.evaluate(() => window.dictationTest.clipboard)).toBe("");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe(
    "Edited transcript.",
  );
  await page.screenshot({ path: testInfo.outputPath("prompt-chain-results.png"), fullPage: true });
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
  await page.getByRole("combobox", { name: "Output prompt", exact: true }).click();
  await page.getByRole("option", { name: "Notes (chain)", exact: true }).click();
  await page.getByRole("button", { name: "Run chain", exact: true }).click();
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
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Profile name").fill("Meeting");
  await dialog.getByRole("combobox", { name: "After dictation", exact: true }).click();
  await page.getByRole("option", { name: "Meeting notes (chain)", exact: true }).click();
  await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
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
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
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
  await temporary.getByText("Completed chain steps", { exact: true }).click();
  await expect(temporary).toContainText("Step 1: Cleanup");
  await expect(temporary).toContainText("Cleaned result.");
  await temporary.getByRole("button", { name: "Copy step result", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.clipboard))
    .toBe("Cleaned result.");
  expect(await page.evaluate(() => window.dictationTest.snapshot.history)).toEqual([]);
});

test("profile cards add, keep, and remove automatic apps as badges", async ({ page }, testInfo) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const apps = page.getByRole("group", { name: "Apps for Default", exact: true });
  await apps.getByRole("combobox", { name: "Add app to Default", exact: true }).click();
  await page.getByRole("option", { name: "Outlook", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.appProfileRules))
    .toEqual([
      { applicationId: "windows:outlook.exe", applicationName: "Outlook", profileId: "default" },
    ]);
  await expect(apps.getByText("Outlook", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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
    Reflect.get(window, "go").main.App.GetProfileApplications = async () => [
      { id: "windows:outlook.exe", name: "Outlook" },
      { id: "windows:slack.exe", name: "Slack" },
      { id: "windows:code.exe", name: "Visual Studio Code" },
    ];
  });
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
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

test("shortcuts are grouped in one section and the cycle shortcut saves with settings", async ({
  page,
}) => {
  await homeModelScenario(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const shortcuts = page.getByRole("heading", { name: "Shortcuts", exact: true }).locator("..");
  await expect(shortcuts.getByLabel("Global shortcut", { exact: true })).toBeVisible();
  await expect(shortcuts.getByText("Recording mode", { exact: true })).toBeVisible();
  const cycle = shortcuts.getByLabel("Cycle profiles shortcut", { exact: true });
  await cycle.fill("Ctrl+Alt+P");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(cycle).toHaveValue("Ctrl+Alt+P");
  const save = page.getByRole("button", { name: "Save settings", exact: true });
  await save.click();
  await expect
    .poll(() => page.evaluate(() => window.dictationTest.snapshot.profileShortcut))
    .toBe("Ctrl+Alt+P");
  await expect(save).toBeDisabled();
  await cycle.fill("");
  await save.click();
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
  const save = page.getByRole("button", { name: "Save settings", exact: true });
  await cycle.fill("Ctrl+Alt+P");
  await page.evaluate(() => {
    window.dictationTest.failSave = true;
  });
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not save profile automation" }),
  ).toBeVisible();
  await expect(cycle).toHaveValue("Ctrl+Alt+P");
  await page.evaluate(() => {
    window.dictationTest.failSave = false;
  });
  await cycle.fill("Ctrl+Alt+Space");
  await save.click();
  await expect(
    page.getByRole("alert").filter({ hasText: /must use different shortcuts/i }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.dictationTest.snapshot.profileShortcut ?? "")).toBe("");
  await cycle.fill("Ctrl+Alt+P");
  await save.click();
  await expect(save).toBeDisabled();
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
