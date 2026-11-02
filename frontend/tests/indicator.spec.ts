import { expect, test, type Page } from "@playwright/test";

const recording = {
  revision: 7,
  phase: "recording",
  label: "1:05 · Saving · Work",
  primary: "Stop",
  secondary: "Cancel",
  level: 0.6,
  dark: true,
};

test("desktop integration: completion indicator offers recovery with concise text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 376, height: 64 });
  await page.goto("/indicator.html");
  for (const [index, dark] of [false, true].entries()) {
    await sendFrame(page, {
      revision: 30 + index * 2,
      phase: "done",
      label: "Paste requested",
      primary: "Open Yap",
      secondary: "Dismiss",
      dark,
    });
    await expect(page.getByRole("button", { name: "Open Yap", exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`desktop-indicator-success-${dark ? "dark" : "light"}.png`),
      animations: "disabled",
    });
    await sendFrame(page, {
      revision: 31 + index * 2,
      phase: "done",
      label: "Open Yap to recover text",
      primary: "Open Yap",
      secondary: "Dismiss",
      dark,
    });
    await expect(page.locator("#label")).toHaveText("Open Yap to recover text");
    await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`desktop-indicator-warning-${dark ? "dark" : "light"}.png`),
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Open Yap", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, "indicatorEvents").filter(
          (event: { name: string }) => event.name === "indicator:action",
        ),
      ),
    )
    .toEqual([{ name: "indicator:action", data: { action: "primary", revision: 33 } }]);
});

async function sendFrame(page: Page, changes: Partial<typeof recording>) {
  await page.evaluate((frame) => Reflect.get(window, "sendIndicatorFrame")(frame), {
    ...recording,
    ...changes,
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((initial) => {
    const callbacks: Record<string, (frame: unknown) => void> = {};
    const emitted: { name: string; data: unknown }[] = [];
    Reflect.set(window, "indicatorEvents", emitted);
    Reflect.set(window, "mockBackend", {
      main: {
        App: new Proxy(
          {},
          {
            get: (_, method) => () => {
              throw Error(`Indicator called main backend: ${String(method)}`);
            },
          },
        ),
      },
    });
    Reflect.set(window, "mockEvents", {
      subscribe: (name: string, callback: (frame: unknown) => void) => {
        callbacks[name] = callback;
      },
      emit: (name: string, data: unknown) => {
        emitted.push({ name, data });
        if (name === "indicator:ready") callbacks["indicator:frame"]?.(initial);
        return false;
      },
    });
    Reflect.set(window, "sendIndicatorFrame", (frame: unknown) =>
      callbacks["indicator:frame"](frame),
    );
  }, recording);
});

for (const size of [
  { width: 316, height: 40 },
  { width: 376, height: 64 },
]) {
  test(`isolated indicator fits ${size.width}×${size.height} with long profile names`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/indicator.html");
    await expect(page.locator("#label")).toHaveText(recording.label);
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveAttribute(
      "data-slot",
      "button",
    );
    await page.screenshot({ path: test.info().outputPath("indicator.png") });
    await sendFrame(page, { label: "1:05 · Saving · Very long 日本語 profile name 👋".repeat(5) });
    for (const name of ["Stop", "Cancel"]) {
      const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
    expect(errors).toEqual([]);
    await page.reload();
    await expect(page.locator("#label")).toHaveText(recording.label);
  });
}

test("buttons carry the displayed revision and do not initiate dragging", async ({ page }) => {
  await page.setViewportSize({ width: 316, height: 40 });
  await page.goto("/indicator.html");
  await expect(page.locator("#label")).toHaveText(recording.label);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await sendFrame(page, {
    revision: 8,
    phase: "transcribing",
    label: "Transcribing…",
    primary: "",
  });
  await sendFrame(page, { revision: 7 });
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, "indicatorEvents").filter(
          (event: { name: string }) => event.name !== "indicator:ready",
        ),
      ),
    )
    .toEqual([
      { name: "indicator:action", data: { action: "primary", revision: 7 } },
      { name: "indicator:action", data: { action: "secondary", revision: 8 } },
    ]);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("dragging the status preserves ordered start, move and end events", async ({ page }) => {
  await page.setViewportSize({ width: 316, height: 40 });
  await page.goto("/indicator.html");
  await expect(page.locator("#label")).toHaveText(recording.label);
  await page.mouse.move(40, 20);
  await page.mouse.down();
  await page.mouse.move(80, 25, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "indicatorEvents").at(-1)))
    .toMatchObject({ name: "indicator:drag", data: { action: "end" } });
  const events = await page.evaluate(() =>
    Reflect.get(window, "indicatorEvents").filter(
      (event: { name: string }) => event.name === "indicator:drag",
    ),
  );
  expect(events[0].data.action).toBe("start");
  expect(events.some((event: { data: { action: string } }) => event.data.action === "move")).toBe(
    true,
  );
  expect(new Set(events.map((event: { data: { id: number } }) => event.data.id)).size).toBe(1);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("theme and recovery controls update without mounting the main UI", async ({ page }) => {
  await page.goto("/indicator.html");
  await expect(page.locator("#label")).toHaveText(recording.label);
  await expect(page.locator("html")).toHaveClass("dark");
  const darkBackground = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).backgroundColor);
  await sendFrame(page, {
    dark: false,
    phase: "error",
    label: "Dictation failed",
    primary: "Open Yap",
    secondary: "Dismiss",
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Open Yap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("background-color", darkBackground);
  await expect(page.getByRole("button", { name: "Open Yap" })).toHaveAttribute(
    "data-slot",
    "button",
  );
  await expect(page.locator("#indicator-root")).toBeVisible();
  await expect(page.locator("#root")).toHaveCount(0);
});

test("hiding the page ends an active drag once", async ({ page }) => {
  await page.setViewportSize({ width: 316, height: 40 });
  await page.goto("/indicator.html");
  await expect(page.locator("#label")).toHaveText(recording.label);
  await page.mouse.move(40, 20);
  await page.mouse.down();
  await page.mouse.move(80, 25);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Reflect.get(window, "indicatorEvents").filter(
            (event: { name: string; data?: { action: string } }) =>
              event.name === "indicator:drag" && event.data?.action === "end",
          ).length,
      ),
    )
    .toBe(1);
});

test("reduced motion keeps meter geometry fixed while retaining level feedback", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/indicator.html");
  await expect(page.locator("#label")).toHaveText(recording.label);
  const meter = page.locator(".meter i").first();
  const transform = await meter.evaluate((bar) => getComputedStyle(bar).transform);
  const opacity = await meter.evaluate((bar) => Number(getComputedStyle(bar).opacity));
  await sendFrame(page, { level: 1 });
  await expect(meter).toHaveCSS("transform", transform);
  expect(await meter.evaluate((bar) => Number(getComputedStyle(bar).opacity))).toBeGreaterThan(
    opacity,
  );
  await sendFrame(page, { phase: "transcribing", primary: "", label: "Transcribing…" });
  await expect(meter).toHaveCSS("animation-name", "none");
  await expect(meter).toHaveCSS("transform", transform);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(meter).toHaveCSS("animation-name", "busy");
});
