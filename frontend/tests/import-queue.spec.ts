import { expect, test, type Page } from "@playwright/test";
import type { BulkTextJob, ImportJob, Snapshot } from "../src/lib/backend";

const job = (id: string, state = "queued", progress = -1): ImportJob => ({
  id,
  name: `${id}.wav`,
  state,
  progress,
  message:
    state === "queued"
      ? "Queued"
      : state === "preparing"
        ? "Decoding…"
        : state === "done"
          ? "Saved to History"
          : state,
  sessionId: "",
  transcript: "",
  error: "",
});
async function queue(page: Page, jobs: ImportJob[]) {
  await page.evaluate((jobs) => Reflect.get(window, "queueTest").queue(jobs), jobs);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    let drop: ((_x: number, _y: number, paths: string[]) => void) | undefined;
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
      importQueue: [],
      models: [],
      history: [],
      ready: true,
      dataDir: "",
      floatingIndicator: false,
      launchAtLoginAvailable: true,
      startInTrayAvailable: true,
      vocabulary: [],
      microphoneTested: false,
      shortcutTested: false,
      diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
    };
    const state = {
      reorderCalls: [] as string[][],
      removeCalls: [] as string[],
      retryCalls: [] as string[],
      copied: "",
      dropped: [] as string[],
      rejectReorder: false,
      cancelCalls: 0,
      queue(jobs: ImportJob[]) {
        snapshot.importQueue = jobs;
        callbacks["import:queue"]?.(structuredClone(jobs));
      },
      status(status: Partial<Snapshot["status"]>) {
        Object.assign(snapshot.status, status);
        callbacks["dictation:status"]?.(structuredClone(snapshot.status));
      },
      textQueue(jobs: BulkTextJob[]) {
        snapshot.bulkTextQueue = jobs;
        callbacks["text:queue"]?.(structuredClone(jobs));
      },
      drop(paths: string[]) {
        drop?.(0, 0, paths);
      },
    };
    Object.assign(window, {
      queueTest: state,
      mockEvents: {
        subscribe(topic: string, handler: (...args: unknown[]) => void) {
          callbacks[topic] = handler;
          return () => {
            delete callbacks[topic];
          };
        },
        onFileDrop(handler: typeof drop) {
          drop = handler;
        },
        offFileDrop() {
          drop = undefined;
        },
      },
      mockBackend: {
        main: {
          App: {
            GetSnapshot: async () => structuredClone(snapshot),
            Cancel: async () => {
              state.cancelCalls++;
              state.status({ phase: "idle", message: "Ready", importId: "" });
            },
            GetHistory: async () => ({ entries: [], total: 0, page: 0, pageSize: 50 }),
            GetMicrophones: async () => [],
            GetDiagnosticChecks: async () => [],
            ImportAudio: async () => {},
            ImportDroppedAudio: async (paths: string[]) => {
              state.dropped = paths;
            },
            ReorderImportQueue: async (ids: string[]) => {
              state.reorderCalls.push(ids);
              if (state.rejectReorder) throw new Error("Queue changed; try again");
              let n = 0;
              const jobs = snapshot.importQueue ?? [];
              state.queue(
                jobs.map((entry) => {
                  if (entry.state !== "queued") return entry;
                  const result = jobs.find((j) => j.id === ids[n])!;
                  n++;
                  return result;
                }),
              );
            },
            RemoveImport: async (id: string) => {
              state.removeCalls.push(id);
            },
            RetryImport: async (id: string) => {
              state.retryCalls.push(id);
            },
            ClearFinishedImports: async () =>
              state.queue(
                (snapshot.importQueue ?? []).filter((j) =>
                  ["queued", "preparing", "transcribing", "processing"].includes(j.state),
                ),
              ),
            CopyText: async (value: string) => {
              state.copied = value;
            },
          },
        },
      },
    });
  });
  await page.goto("/#/history");
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
});

test("docks the activity pane inside desktop and narrow content frames", async ({ page }) => {
  await queue(page, [job("interview", "transcribing", 42), job("notes")]);
  const pane = page.getByRole("region", { name: "Processing activity", exact: true });
  for (const width of [1086, 480]) {
    await page.setViewportSize({ width, height: 754 });
    const bounds = (await pane.boundingBox())!;
    const content = (await page.getByRole("main").boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(content.x + 12);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(content.x + content.width - 12);
    expect(bounds.width).toBeLessThanOrEqual(288);
    expect(bounds.height).toBeLessThan(200);
  }
});

test("shows real and indeterminate progress, and remains non-modal", async ({ page }, testInfo) => {
  await queue(page, [job("interview", "transcribing", 42), job("notes")]);
  await expect(
    page.getByRole("region", { name: "Processing activity", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Transcribing 42%", { exact: true })).toBeVisible();
  const progress = page.getByRole("progressbar", { name: "Progress for interview.wav" });
  await expect(progress).toHaveAttribute("aria-valuenow", "42");
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Processing activity", exact: true }),
  ).toBeVisible();
  await queue(page, [job("interview", "preparing"), job("notes")]);
  await expect(progress).not.toHaveAttribute("aria-valuenow");
  const indicator = progress.locator("[data-slot=progress-indicator]");
  await expect(indicator).toHaveAttribute("data-indeterminate", "");
  await expect(indicator).toHaveCSS("animation-name", "import-progress");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(indicator).toHaveCSS("animation-name", "none");
  await page.screenshot({ path: testInfo.outputPath("import-drawer.png") });
});

test("minimizes completely and keeps updates hidden until reopened from any view", async ({
  page,
}) => {
  await queue(page, [job("interview", "transcribing", 42), job("notes")]);
  const pane = page.getByRole("region", { name: "Processing activity", exact: true });
  const toggle = page.getByRole("button", { name: "Processing activity", exact: true });
  await pane.getByRole("button", { name: "Minimize activity pane" }).click();
  await expect(pane).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-description", "2 tasks pending");
  await queue(page, [job("interview", "transcribing", 52), job("notes"), job("extra")]);
  await expect(pane).toBeHidden();
  await queue(page, [job("interview", "done"), job("notes", "done"), job("extra", "done")]);
  await queue(page, [job("new")]);
  await expect(pane).toBeHidden();
  await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
  await expect(pane).toBeHidden();
  await toggle.click();
  await expect(pane).toBeVisible();
  await expect(pane.getByText("new.wav", { exact: true })).toBeVisible();
});

test("the activity button opens the empty pane and Escape returns focus", async ({ page }) => {
  const toggle = page.getByRole("button", { name: "Processing activity", exact: true });
  await toggle.press("Enter");
  const pane = page.getByRole("region", { name: "Processing activity", exact: true });
  await expect(pane).toContainText("No processing activity");
  await pane.getByRole("button", { name: "Minimize activity pane" }).focus();
  await page.keyboard.press("Escape");
  await expect(pane).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("one activity pane shows both queues without counting the active operation twice", async ({
  page,
}) => {
  await queue(page, [job("interview", "transcribing", 42)]);
  await page.evaluate(() => {
    const state = Reflect.get(window, "queueTest");
    state.status({ importId: "interview", phase: "transcribing", message: "Transcribing" });
    state.textQueue([
      {
        id: "text-1",
        sessionId: "saved",
        name: "Meeting notes",
        action: "output",
        prompt: "Summary",
        state: "queued",
        error: "",
      },
    ]);
  });
  const pane = page.getByRole("region", { name: "Processing activity", exact: true });
  const toggle = page.getByRole("button", { name: "Processing activity", exact: true });
  await expect(pane.getByRole("region", { name: "Imports", exact: true })).toBeVisible();
  await expect(
    pane.getByRole("region", { name: "Transcript processing queue", exact: true }),
  ).toBeVisible();
  await expect(pane.getByRole("region", { name: "Current operation", exact: true })).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-description", "2 tasks pending");
  await pane.getByRole("button", { name: "Minimize activity pane" }).click();
  await page.evaluate(() => {
    const state = Reflect.get(window, "queueTest");
    state.queue([
      {
        id: "interview",
        name: "interview.wav",
        state: "done",
        progress: 100,
        message: "Saved",
        error: "",
        transcript: "",
        sessionId: "",
      },
    ]);
    state.textQueue([
      {
        id: "text-1",
        sessionId: "saved",
        name: "Meeting notes",
        action: "output",
        prompt: "Summary",
        state: "running",
        error: "",
      },
    ]);
    state.status({ importId: "", phase: "text-processing", message: "Generating a summary" });
  });
  await expect(pane).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-description", "1 task pending");
  await toggle.click();
  await expect(pane.getByRole("region", { name: "Current operation", exact: true })).toHaveCount(0);
  await pane
    .getByRole("region", { name: "Imports", exact: true })
    .getByRole("button", { name: "Clear finished" })
    .click();
  await expect(pane.getByRole("region", { name: "Imports", exact: true })).toHaveCount(0);
  await expect(pane.getByRole("link", { name: "Meeting notes", exact: true })).toBeVisible();
});

test("standalone processing uses the shared activity pane and can reopen from the sidebar or command palette", async ({
  page,
}) => {
  const pane = page.getByRole("region", { name: "Processing activity", exact: true });
  const toggle = page.getByRole("button", { name: "Processing activity", exact: true });
  await page.evaluate(() =>
    Reflect.get(window, "queueTest").status({
      phase: "transcribing",
      message: "Transcribing speech",
    }),
  );
  await expect(pane.getByRole("region", { name: "Current operation", exact: true })).toContainText(
    "Transcribing speech",
  );
  await pane.getByRole("button", { name: "Minimize activity pane" }).click();
  await expect(pane).toBeHidden();
  await expect(
    page.getByRole("button", { name: "View processing activity", exact: true }),
  ).toHaveCount(0);
  await toggle.click();
  await expect(pane).toBeVisible();
  await pane.getByRole("button", { name: "Minimize activity pane" }).click();
  await page.evaluate(() =>
    Reflect.get(window, "queueTest").status({
      phase: "downloading",
      progress: 0.42,
      message: "Downloading model",
    }),
  );
  await expect(pane).toBeHidden();
  await toggle.click();
  await expect(
    pane.getByRole("progressbar", { name: "Current operation", exact: true }),
  ).toHaveAttribute("aria-valuenow", "42");
  await pane.getByRole("button", { name: "Cancel current operation", exact: true }).click();
  await expect(pane).toContainText("No processing activity");
  expect(await page.evaluate(() => Reflect.get(window, "queueTest").cancelCalls)).toBe(1);
  await pane.getByRole("button", { name: "Minimize activity pane" }).click();
  await page.keyboard.press("Control+k");
  const command = page.getByRole("dialog", { name: "Command palette", exact: true });
  await command.getByRole("combobox").fill("Processing activity");
  await command.getByRole("option", { name: "Processing activity", exact: true }).click();
  await expect(pane).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("keyboard and grip dragging reorder only queued rows", async ({ page }) => {
  await queue(page, [job("active", "transcribing", 42), job("one"), job("two"), job("three")]);
  await expect(page.getByRole("button", { name: "Reorder active.wav" })).toBeDisabled();
  const grip = page.getByRole("button", { name: "Reorder two.wav" });
  await grip.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "queueTest").reorderCalls))
    .toEqual([["two", "one", "three"]]);
  const dragGrip = page.getByRole("button", { name: "Reorder three.wav" });
  await dragGrip.scrollIntoViewIfNeeded();
  await dragGrip.click({ trial: true });
  const from = await dragGrip.boundingBox();
  const to = await page.getByRole("button", { name: "Reorder one.wav" }).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2 + ((to!.y - from!.y - 10) * step) / 12,
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "queueTest").reorderCalls.at(-1)))
    .toEqual(["two", "three", "one"]);
  await expect(
    page.getByRole("region", { name: "Processing activity", exact: true }),
  ).toBeVisible();
});

test("keyboard reorder keeps focus across pending saves and consecutive moves", async ({
  page,
}) => {
  await page.evaluate(() => {
    const api = Reflect.get(window, "mockBackend").main.App;
    const reorder = api.ReorderImportQueue;
    api.ReorderImportQueue = async (ids: string[]) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return reorder(ids);
    };
  });
  await queue(page, [job("one"), job("two"), job("three")]);
  const grip = page.getByRole("button", { name: "Reorder three.wav" });
  await grip.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "queueTest").reorderCalls))
    .toEqual([["one", "three", "two"]]);
  await expect(grip).toBeFocused();
  await expect(grip).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "queueTest").reorderCalls))
    .toEqual([
      ["one", "three", "two"],
      ["three", "one", "two"],
    ]);
  await expect(grip).toBeFocused();
});

test("failed reorder rolls back and rows expose cancel, retry, copy, and clear", async ({
  page,
}) => {
  await queue(page, [
    job("active", "preparing"),
    job("one"),
    job("two"),
    { ...job("failed", "failed"), error: "Unsupported file" },
    { ...job("done", "done"), transcript: "Keep me", sessionId: "session-id" },
  ]);
  await page.evaluate(() => {
    Reflect.get(window, "queueTest").rejectReorder = true;
  });
  await page.getByRole("button", { name: "Reorder two.wav" }).press("Alt+ArrowUp");
  await expect(page.getByText("Queue changed; try again", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("list", { name: "Import files" })
        .locator("li")
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid"))),
    )
    .toEqual([
      "import-row-active",
      "import-row-one",
      "import-row-two",
      "import-row-failed",
      "import-row-done",
    ]);
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await page.getByRole("button", { name: "Cancel active.wav" }).click();
  await page.getByRole("button", { name: "Remove one.wav" }).click();
  await page.getByRole("button", { name: "Retry failed.wav" }).click();
  await page.getByRole("button", { name: "Copy done.wav" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "queueTest").copied))
    .toBe("Keep me");
  await expect(page.getByRole("link", { name: "Open done.wav" })).toHaveAttribute(
    "href",
    "#/history/session-id",
  );
  await page.getByRole("button", { name: "Clear finished" }).click();
  await expect(page.getByTestId("import-row-done")).toBeHidden();
});

test("suppresses per-file toasts and summarizes a minimized batch once", async ({ page }) => {
  await queue(page, [job("old", "done")]);
  await queue(page, [job("old", "done"), job("one", "transcribing", 42), job("two")]);
  await page.getByRole("button", { name: "Minimize activity pane" }).click();
  await page.evaluate(() => {
    const state = Reflect.get(window, "queueTest");
    state.status({ importId: "one", phase: "transcribing" });
    state.status({ importId: "one", phase: "done", message: "Saved to History" });
    state.status({ importId: "two", phase: "transcribing" });
    state.status({ importId: "two", phase: "error", message: "Failed sample" });
  });
  await queue(page, [job("old", "done"), job("one", "done"), job("two", "failed")]);
  await expect(page.getByText("1 import finished, 1 failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Transcription finished", { exact: true })).toBeHidden();
  await expect(page.getByText("Failed sample", { exact: true })).toBeHidden();
  await expect(page.locator('[data-slot="toast"]')).toHaveCount(1);
});

test("accepts multi-path drops while recording and keeps picker enabled", async ({ page }) => {
  await page.evaluate(() => Reflect.get(window, "queueTest").status({ phase: "recording" }));
  await expect(page.getByRole("button", { name: "Import audio", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["audio"], "one.wav", { type: "audio/wav" }));
    window.dispatchEvent(
      new DragEvent("dragenter", { dataTransfer, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByText("Drop audio files to import", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["audio"], "one.wav"));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
    Reflect.get(window, "queueTest").drop(["/one.wav", "/two.mp3"]);
  });
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "queueTest").dropped))
    .toEqual(["/one.wav", "/two.mp3"]);
});
