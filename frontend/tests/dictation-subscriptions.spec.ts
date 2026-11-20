import { expect, test, type Page } from "@playwright/test";

async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, "mockBackend", { app: { App: {} } });
  });
  await page.goto("/tests/dictation-subscriptions.html");
  await expect(page.getByTestId("connection")).toHaveText("ready");
  await expect(page.getByTestId("configuration")).toHaveText("auto");
  await settle(page);
});
async function commits(page: Page) {
  return page.evaluate(() => ({
    ...Reflect.get(window, "subscriptionFixture").commits,
  })) as Promise<Record<string, number>>;
}

test("the activity pane does not rerender its queues for operation progress", async ({ page }) => {
  const profiler = await page.context().newCDPSession(page);
  await profiler.send("Profiler.enable");
  await profiler.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  async function queueCalls() {
    const { result } = await profiler.send("Profiler.takePreciseCoverage");
    return Object.fromEntries(
      ["ImportQueue", "BulkTextQueue"].map((name) => [
        name,
        result
          .filter((script) => /\/(import-queue|bulk-text-queue)\.tsx(?:\?|$)/.test(script.url))
          .flatMap((script) => script.functions)
          .filter((fn) => fn.functionName === name)
          .reduce((sum, fn) => sum + fn.ranges[0].count, 0),
      ]),
    );
  }
  try {
    await page.evaluate(() => {
      const fixture = Reflect.get(window, "subscriptionFixture");
      fixture.emit("import:queue", [{ id: "one", state: "queued", name: "one.wav", progress: 0 }]);
      fixture.emit("text:queue", []);
      fixture.snapshot.status.phase = "transcribing";
      fixture.emit("dictation:status", structuredClone(fixture.snapshot.status));
    });
    await expect(page.getByTestId("queue")).toHaveText("1");
    await expect(page.getByTestId("phase")).toHaveText("transcribing");
    await settle(page);
    const initial = await queueCalls();
    expect(initial.ImportQueue).toBeGreaterThan(0);
    expect(initial.BulkTextQueue).toBeGreaterThan(0);
    for (const progress of [20, 40, 60]) {
      await page.evaluate((progress) => {
        const fixture = Reflect.get(window, "subscriptionFixture");
        fixture.snapshot.status.progress = progress;
        fixture.emit("dictation:status", structuredClone(fixture.snapshot.status));
      }, progress);
      await expect(page.getByTestId("progress")).toHaveText(String(progress));
    }
    expect(await queueCalls()).toEqual({ ImportQueue: 0, BulkTextQueue: 0 });
  } finally {
    await profiler.send("Profiler.stopPreciseCoverage");
    await profiler.detach();
  }
});
test("progress updates only render status consumers", async ({ page }) => {
  await page.evaluate(() => {
    const fixture = Reflect.get(window, "subscriptionFixture");
    fixture.snapshot.status.phase = "transcribing";
    fixture.emit("dictation:status", structuredClone(fixture.snapshot.status));
  });
  await expect(page.getByTestId("phase")).toHaveText("transcribing");
  await settle(page);
  const before = await commits(page);
  for (const progress of [20, 40, 60]) {
    await page.evaluate((progress) => {
      const fixture = Reflect.get(window, "subscriptionFixture");
      fixture.snapshot.status.progress = progress;
      fixture.emit("dictation:status", structuredClone(fixture.snapshot.status));
    }, progress);
    await expect(page.getByTestId("progress")).toHaveText(String(progress));
  }
  const after = await commits(page);
  expect(after.status).toBeGreaterThan(before.status);
  for (const key of [
    "actions",
    "phase",
    "activity",
    "queue",
    "level",
    "configuration",
    "connection",
    "updates",
  ]) {
    expect(after[key], `${key} must ignore progress`).toBe(before[key]);
  }
});
test("queue and audio events leave unrelated subscriptions idle", async ({ page }) => {
  const before = await commits(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(window, "subscriptionFixture");
    fixture.emit("import:queue", [{ id: "one", state: "queued", name: "one.wav", progress: 0 }]);
  });
  await expect(page.getByTestId("queue")).toHaveText("1");
  await settle(page);
  const queued = await commits(page);
  expect(queued.queue).toBeGreaterThan(before.queue);
  for (const key of [
    "actions",
    "phase",
    "activity",
    "status",
    "level",
    "configuration",
    "connection",
    "updates",
  ]) {
    expect(queued[key], `${key} must ignore queue changes`).toBe(before[key]);
  }
  await page.evaluate(() =>
    Reflect.get(window, "subscriptionFixture").emit("dictation:level", 0.75),
  );
  await expect(page.getByTestId("level")).toHaveText("0.75");
  const leveled = await commits(page);
  expect(leveled.level).toBeGreaterThan(queued.level);
  for (const key of [
    "actions",
    "phase",
    "activity",
    "status",
    "queue",
    "configuration",
    "connection",
    "updates",
  ]) {
    expect(leveled[key], `${key} must ignore audio samples`).toBe(queued[key]);
  }
});

test("operation errors reach their consumers without changing the phase subscription", async ({
  page,
}) => {
  const before = await commits(page);
  await page.evaluate(() => {
    const fixture = Reflect.get(window, "subscriptionFixture");
    fixture.snapshot.status.historyError = "History unavailable";
    fixture.emit("dictation:status", structuredClone(fixture.snapshot.status));
  });
  await expect(page.getByTestId("history-error")).toHaveText("History unavailable");
  const after = await commits(page);
  expect(after.activity).toBeGreaterThan(before.activity);
  expect(after.status).toBeGreaterThan(before.status);
  for (const key of [
    "actions",
    "phase",
    "queue",
    "level",
    "configuration",
    "connection",
    "updates",
  ]) {
    expect(after[key], `${key} must ignore unrelated operation errors`).toBe(before[key]);
  }
});
