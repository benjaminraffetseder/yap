import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Snapshot } from "../src/lib/backend";

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function fixture(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/tests/motion-fixture.tsx";
    (await import(path)).mount();
  });
  await expect(page.getByRole("button", { name: "Open fixture dialog" })).toBeVisible();
}

async function spatialFrames(surface: Locator) {
  return surface.evaluate((element) =>
    element
      .getAnimations()
      .flatMap((animation) =>
        animation.effect instanceof KeyframeEffect
          ? animation.effect
              .getKeyframes()
              .filter(
                (frame) =>
                  (frame.transform && frame.transform !== "none") ||
                  (frame.scale && frame.scale !== "none" && frame.scale !== "1") ||
                  (frame.translate && frame.translate !== "none" && frame.translate !== "0px"),
              )
          : [],
      ),
  );
}

test("reduced motion keeps dropdown and dialog fades without spatial animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await page.getByRole("combobox", { name: "Fixture choice" }).click();
  const select = page.locator('[data-slot="select-content"]');
  await expect(select).toBeVisible();
  expect(await spatialFrames(select)).toEqual([]);
  await expect(select).toHaveCSS("transform", "none");
  await expect(select).toHaveCSS("transition-property", "opacity");
  await page.getByRole("option", { name: "Second choice" }).click();
  await expect(select).toBeHidden();
  await page.getByRole("button", { name: "Open fixture dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Fixture dialog" });
  await expect(dialog).toBeVisible();
  expect(await spatialFrames(dialog)).toEqual([]);
  await expect(dialog).toHaveCSS("transition-property", "opacity");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open fixture dialog" })).toBeFocused();
});

test("adjacent tooltips honor the provider instant phase", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "First trigger" }).hover();
  await expect(
    page.locator('[data-slot="tooltip-content"]').filter({ hasText: "First tooltip" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Second trigger" }).hover();
  const second = page
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: "Second tooltip" });
  await expect(second).toBeVisible();
  await expect(second).toHaveAttribute("data-instant", "delay");
  await expect(second).toHaveCSS("transition-duration", "0s");
  expect(await second.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("accordion reversals and dynamic content preserve natural geometry", async ({ page }) => {
  await fixture(page);
  const panel = page.locator('[data-slot="accordion-content"]');
  const trigger = page.getByRole("button", { name: "Fixture models" });
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  await page.getByRole("button", { name: "Toggle extra details" }).click();
  await expect
    .poll(async () => (await panel.boundingBox())!.height)
    .toBeGreaterThan(before!.height + 100);
  await trigger.evaluate((element) => {
    (element as HTMLElement).click();
    (element as HTMLElement).click();
    (element as HTMLElement).click();
  });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(page.getByText("Additional model details")).toBeVisible();
  expect(await panel.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("progress uses full-width geometry with normalized transform and accessible values", async ({
  page,
}) => {
  await fixture(page);
  const progress = page.getByRole("progressbar", { name: "Fixture progress" });
  const indicator = page.locator('[data-slot="progress-indicator"]');
  const track = page.locator('[data-slot="progress-track"]');
  await expect(progress).toHaveAttribute("aria-valuenow", "15");
  await expect(indicator).toHaveCSS("transform", "matrix(0.25, 0, 0, 1, 0, 0)");
  const layoutWidths = () =>
    page.evaluate(() => ({
      track: document.querySelector<HTMLElement>('[data-slot="progress-track"]')!.offsetWidth,
      fill: document.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!.offsetWidth,
    }));
  let widths = await layoutWidths();
  expect(widths.fill).toBe(widths.track);
  await page.getByRole("button", { name: "Advance progress" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "25");
  await expect(indicator).toHaveCSS("transform", "matrix(0.75, 0, 0, 1, 0, 0)");
  await expect(indicator).toHaveCSS("transition-property", "transform");
  widths = await layoutWidths();
  expect(widths.fill).toBe(widths.track);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(indicator).toHaveCSS("transition-property", "none");
  await page.getByRole("button", { name: "Complete progress" }).click();
  await expect(indicator).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await page.getByRole("button", { name: "Indeterminate progress" }).click();
  await expect(progress).not.toHaveAttribute("aria-valuenow");
  await expect(indicator).toHaveAttribute("data-indeterminate", "");
  await expect(track).toBeVisible();
});

test("popup transitions preserve centering and recover from interrupted dismissal", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await fixture(page);
  const trigger = page.getByRole("combobox", { name: "Fixture choice" });
  await trigger.click();
  const select = page.locator('[data-slot="select-content"]');
  await expect(select).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(select).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0.23, 1, 0.32, 1), cubic-bezier(0.23, 1, 0.32, 1)",
  );
  await page.keyboard.press("Escape");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(select).toHaveCount(1);
  await expect(select).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("dropdown.png") });
  await page.keyboard.press("Escape");
  await expect(select).toBeHidden();
  await page.getByRole("button", { name: "Open fixture dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Fixture dialog" });
  await expect(dialog).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

async function recordingScenario(page: Page) {
  await page.addInitScript(() => {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const snapshot: Snapshot = {
      textProcessing: {
        enabled: false,
        endpoint: "http://127.0.0.1:11434/v1",
        model: "",
        autoPromptId: "",
        prompts: [],
      },
      settings: {
        microphoneId: "",
        whisperPath: "/whisper",
        modelPath: "/tiny",
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
        phase: "recording",
        message: "Recording",
        startedAt: Date.now(),
        transcript: "",
        progress: 0,
        shortcutError: "",
        indicatorError: "",
        trayError: "",
        startupError: "",
        historyError: "",
      },
      models: [
        {
          id: "tiny",
          name: "Whisper Tiny",
          description: "Speech model",
          size: 100,
          diskBytes: 100,
          installed: true,
          removable: true,
          path: "/tiny",
        },
      ],
      history: [],
      ready: true,
      dataDir: "",
      floatingIndicator: false,
      launchAtLoginAvailable: true,
      startInTrayAvailable: true,
      vocabulary: [],
      microphoneTested: true,
      shortcutTested: true,
      diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
    };
    Object.assign(window, {
      motionScenario: { callbacks, snapshot },
      runtime: {
        EventsOnMultiple(topic: string, callback: (...args: unknown[]) => void) {
          callbacks[topic] = callback;
          return () => {
            delete callbacks[topic];
          };
        },
      },
      go: {
        main: {
          App: {
            GetSnapshot: async () => structuredClone(snapshot),
            CheckForUpdates: async () => ({ error: "", available: false }),
          },
        },
      },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }).first(),
  ).toBeEnabled();
}

test("recording level feedback avoids layout and follows live reduced-motion changes", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await recordingScenario(page);
  const recorder = page.getByRole("region", { name: "Dictation recorder" });
  const meter = recorder
    .locator('[aria-hidden="true"]')
    .filter({ has: page.locator("span") })
    .last();
  const bars = meter.locator("span");
  await expect(bars).toHaveCount(17);
  const geometry = () =>
    bars.evaluateAll((elements) =>
      elements.map((element) => ({
        height: (element as HTMLElement).offsetHeight,
        transform: getComputedStyle(element).transform,
        opacity: getComputedStyle(element).opacity,
      })),
    );
  const level = async (value: number) => {
    await page.evaluate(
      (value) => Reflect.get(window, "motionScenario").callbacks["dictation:level"](value),
      value,
    );
    await settle(page);
  };
  await level(0);
  const quiet = await geometry();
  await level(1);
  await expect
    .poll(async () => (await geometry()).map((bar) => bar.transform))
    .not.toEqual(quiet.map((bar) => bar.transform));
  expect((await geometry()).map((bar) => bar.height)).toEqual(quiet.map((bar) => bar.height));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const ring = recorder.locator('span[aria-hidden="true"]').nth(1);
  await expect(ring).toHaveCSS("transform", "none");
  await level(0);
  const reducedQuiet = await geometry();
  await level(1);
  const reducedLoud = await geometry();
  expect(reducedLoud.map((bar) => bar.transform)).toEqual(reducedQuiet.map((bar) => bar.transform));
  expect(reducedLoud.map((bar) => bar.height)).toEqual(reducedQuiet.map((bar) => bar.height));
  expect(reducedLoud.map((bar) => bar.opacity)).not.toEqual(reducedQuiet.map((bar) => bar.opacity));
  await expect(ring).toHaveCSS("transform", "none");
  const button = recorder.getByRole("button", { name: "Stop recording", exact: true });
  await button.hover();
  await expect(button).toHaveCSS("transform", "none");
  await page.mouse.down();
  await expect(button).toHaveCSS("transform", "none");
  await page.mouse.up();
  await page.evaluate(() => {
    const scenario = Reflect.get(window, "motionScenario");
    scenario.snapshot.status.phase = "transcribing";
    scenario.snapshot.status.message = "Transcribing…";
    scenario.callbacks["dictation:status"](structuredClone(scenario.snapshot.status));
  });
  const busy = page.getByRole("status").filter({ hasText: "Transcribing…" });
  await expect(busy.locator("svg").first()).toHaveCSS("animation-name", "none");
});
