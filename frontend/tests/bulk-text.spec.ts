import { expect, test, type Page } from "@playwright/test";
import type { BulkTextJob, BulkTextRequest, Snapshot } from "../src/lib/backend";

async function openAction(page: Page, action: string) {
  await page.getByRole("button", { name: "Process selected transcripts", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  return page.getByRole("dialog", { name: action, exact: true });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-language", "en");
    const callbacks: Record<string, (data?: unknown) => void> = {};
    const history = Array.from({ length: 55 }, (_, index) => ({
      id: `transcript-${index}`,
      title: index === 0 ? "Existing title" : "",
      createdAt: "2026-11-06T10:00:00Z",
      durationMs: 1000,
      rawTranscript: `Bulk transcript ${index}`,
      finalTranscript: `Bulk transcript ${index}`,
      speechModel: "base",
      language: "en",
      audioPath: "",
    }));
    const snapshot: Snapshot = {
      textProcessing: {
        enabled: localStorage.getItem("bulk-model-disabled") !== "true",
        model: "local-model",
        endpoint: "http://127.0.0.1:11434/v1",
        autoPromptId: "",
        prompts: [{ id: "summary", name: "Summary", instruction: "Summarize." }],
        chains: [
          {
            id: "chain",
            name: "Meeting workflow",
            steps: [{ id: "step", promptId: "summary", input: "transcript" }],
          },
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
        autoPaste: false,
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
      history: [],
      models: [],
      vocabulary: [],
      ready: true,
      dataDir: "",
      floatingIndicator: false,
      launchAtLoginAvailable: true,
      startInTrayAvailable: true,
      microphoneTested: true,
      shortcutTested: true,
      diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
      bulkTextQueue: [],
    };
    const state = {
      requests: [] as BulkTextRequest[],
      reject: false,
      snapshot,
      setQueue(jobs: BulkTextJob[]) {
        snapshot.bulkTextQueue = jobs;
        callbacks["text:queue"]?.(structuredClone(jobs));
      },
    };
    Object.assign(window, {
      bulkTest: state,
      mockEvents: {
        subscribe: (name: string, callback: (data?: unknown) => void) => {
          callbacks[name] = callback;
        },
      },
      mockBackend: {
        main: {
          App: {
            GetSnapshot: async () => structuredClone(snapshot),
            GetHistory: async (query: string, page: number) => {
              const entries = history.filter((entry) =>
                `${entry.title} ${entry.finalTranscript}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              );
              return {
                entries: entries.slice(page * 50, (page + 1) * 50),
                total: entries.length,
                page,
                pageSize: 50,
              };
            },
            GetRecentlyDeleted: async () => ({ entries: [], total: 0, page: 0, pageSize: 50 }),
            GetSession: async (id: string) => history.find((entry) => entry.id === id),
            GetSessionOutputs: async () => [],
            GetHomeResult: async () => null,
            CheckForUpdates: async () => ({ available: false }),
            QueueBulkText: async (request: BulkTextRequest) => {
              if (state.reject) throw new Error("Could not queue transcripts");
              state.requests.push(request);
              const selection = request.selection;
              const entries = history.filter((entry) =>
                selection.allMatching
                  ? `${entry.title} ${entry.finalTranscript}`
                      .toLowerCase()
                      .includes(selection.query.toLowerCase()) &&
                    !selection.excludedSessionIds?.includes(entry.id)
                  : selection.sessionIds.includes(entry.id),
              );
              const jobs = entries
                .filter(
                  (entry) => request.action !== "title" || request.replaceTitles || !entry.title,
                )
                .map((entry, index) => ({
                  id: `job-${state.requests.length}-${index}`,
                  sessionId: entry.id,
                  name: entry.title || entry.finalTranscript,
                  action: request.action,
                  prompt: request.promptId === "chain" ? "Meeting workflow" : "Summary",
                  state: "queued",
                  error: "",
                }));
              state.setQueue([...(snapshot.bulkTextQueue ?? []), ...jobs]);
              return jobs.length;
            },
            CancelBulkTextQueue: async () =>
              state.setQueue(
                (snapshot.bulkTextQueue ?? []).map((job) =>
                  ["queued", "running"].includes(job.state) ? { ...job, state: "cancelled" } : job,
                ),
              ),
            ClearFinishedBulkTextJobs: async () =>
              state.setQueue(
                (snapshot.bulkTextQueue ?? []).filter((job) =>
                  ["queued", "running"].includes(job.state),
                ),
              ),
          },
        },
      },
    });
  });
  await page.goto("/#/history");
  await expect(page.getByRole("checkbox", { name: "Select loaded", exact: true })).toBeEnabled();
});

test("queues titles for selected transcripts and keeps the selection for a second action", async ({
  page,
}) => {
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select dictation 2", exact: true }).check();
  const dialog = await openAction(page, "Generate titles");
  await expect(dialog).toContainText("2 transcripts selected");
  await expect(dialog.getByRole("checkbox", { name: "Replace existing titles" })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Add to queue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Process selected transcripts", exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, "bulkTest").requests)).toEqual([
    {
      selection: {
        sessionIds: ["transcript-0", "transcript-1"],
        allMatching: false,
        query: "",
        excludedSessionIds: [],
      },
      action: "title",
      promptId: "",
      replaceTitles: false,
    },
  ]);
  const queue = page.getByRole("region", { name: "Transcript processing queue", exact: true });
  await expect(queue).toContainText("0/1");
  const promptDialog = await openAction(page, "Run prompt or chain");
  await expect(promptDialog).toContainText("2 transcripts selected");
  await expect(
    promptDialog.getByRole("combobox", { name: "Prompt or chain", exact: true }),
  ).toContainText("Summary");
  await promptDialog.getByRole("button", { name: "Add to queue", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "bulkTest").requests[1].promptId)).toBe(
    "summary",
  );
  await expect(queue).toContainText("0/3");
});

test("queues a prompt or chain for all search matches with exclusions", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Search transcripts", exact: true })
    .fill("Bulk transcript");
  await expect(
    page.getByRole("checkbox", { name: "Select dictation 1", exact: true }),
  ).toBeEnabled();
  await page.getByRole("checkbox", { name: "Select loaded", exact: true }).check();
  await page.getByRole("button", { name: /Select all 55 matching/ }).click();
  await page.getByRole("checkbox", { name: "Select dictation 2", exact: true }).uncheck();
  const dialog = await openAction(page, "Run prompt or chain");
  await expect(dialog).toContainText("54 transcripts selected");
  await dialog.getByRole("combobox", { name: "Prompt or chain", exact: true }).click();
  await page.getByRole("option", { name: "Meeting workflow", exact: true }).click();
  await dialog.getByRole("button", { name: "Add to queue", exact: true }).click();
  const request = await page.evaluate(() => Reflect.get(window, "bulkTest").requests[0]);
  expect(request).toEqual({
    selection: {
      sessionIds: [],
      allMatching: true,
      query: "Bulk transcript",
      excludedSessionIds: ["transcript-1"],
    },
    action: "output",
    promptId: "chain",
    replaceTitles: false,
  });
  const queue = page.getByRole("region", { name: "Transcript processing queue", exact: true });
  await expect(queue).toContainText("0/54");
  await expect(queue.getByRole("listitem")).toHaveCount(54);
  await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
  await expect(queue).toBeVisible();
  await queue.getByRole("button", { name: "Cancel remaining", exact: true }).click();
  await expect(queue).toContainText("54/54");
  await queue.getByRole("button", { name: "Clear finished", exact: true }).click();
  await expect(queue).toHaveCount(0);
});

test("preserves dialog choices on failure and reports failed jobs at narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 780 });
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).check();
  const dialog = await openAction(page, "Generate titles");
  await dialog.getByRole("checkbox", { name: "Replace existing titles" }).check();
  await page.evaluate(() => {
    Reflect.get(window, "bulkTest").reject = true;
  });
  await dialog.getByRole("button", { name: "Add to queue", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not queue transcripts");
  await expect(dialog.getByRole("checkbox", { name: "Replace existing titles" })).toBeChecked();
  await page.evaluate(() => {
    Reflect.get(window, "bulkTest").reject = false;
  });
  await dialog.getByRole("button", { name: "Add to queue", exact: true }).click();
  await page.evaluate(() => {
    const state = Reflect.get(window, "bulkTest");
    state.setQueue(
      state.snapshot.bulkTextQueue.map((job: BulkTextJob) => ({
        ...job,
        state: "failed",
        error: "The local model is unavailable",
      })),
    );
  });
  const queue = page.getByRole("region", { name: "Transcript processing queue", exact: true });
  await expect(queue).toContainText("1 failed");
  await expect(queue).toContainText("The local model is unavailable");
  const bar = page.locator('[data-slot="history-selection-bar"]');
  expect(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("floats beside the page without reflow and keeps long queues usable in small windows", async ({
  page,
}) => {
  const heading = page.getByRole("heading", { name: "History", exact: true });
  const before = await heading.boundingBox();
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).check();
  await page.evaluate(() => {
    Reflect.get(window, "bulkTest").setQueue(
      Array.from({ length: 88 }, (_, index) => ({
        id: `job-${index}`,
        sessionId: `transcript-${index}`,
        name: `Transcript ${index} ${"long-title-".repeat(20)}`,
        action: "output",
        prompt: "Meeting workflow",
        state: index === 0 ? "running" : index === 1 ? "done" : "queued",
        error: "",
      })),
    );
  });
  const queue = page.getByRole("region", { name: "Transcript processing queue", exact: true });
  await expect(queue).toBeVisible();
  expect((await heading.boundingBox())!.y).toBe(before!.y);
  await expect(queue.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(100 / 88));
  const panel = page.getByRole("region", { name: "Processing activity", exact: true });
  const initial = (await panel.boundingBox())!;
  await page.evaluate(() => window.scrollTo(0, 400));
  expect((await panel.boundingBox())!.y).toBe(initial.y);
  for (const [width, height] of [
    [1280, 800],
    [480, 420],
    [320, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        const pane = (await panel.boundingBox())!;
        const selection = (await page
          .locator('[data-slot="history-selection-bar"]')
          .boundingBox())!;
        return pane.y + pane.height - selection.y;
      })
      .toBeLessThan(0);
    const pane = (await panel.boundingBox())!;
    const sidebar = (await page.locator("#app-sidebar").boundingBox())!;
    const selection = (await page.locator('[data-slot="history-selection-bar"]').boundingBox())!;
    expect(pane.x).toBeGreaterThanOrEqual(sidebar.width);
    expect(pane.x + pane.width).toBeLessThanOrEqual(width);
    expect(pane.y + pane.height).toBeLessThan(selection.y);
    const list = queue.getByRole("list", { name: "Processing jobs", exact: true });
    expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(queue.getByRole("listitem").last()).toBeInViewport();
    await expect(
      queue.getByRole("button", { name: "Cancel remaining", exact: true }),
    ).toBeInViewport();
    await expect(
      queue.getByRole("button", { name: "Clear finished", exact: true }),
    ).toBeInViewport();
    expect(await queue.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await panel.getByRole("button", { name: "Minimize activity pane", exact: true }).press("Enter");
  await expect(panel).toBeHidden();
  const toggle = page.getByRole("button", { name: "Processing activity", exact: true });
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("link", { name: "Vocabulary", exact: true }).click();
  await expect(panel).toBeHidden();
  await toggle.press("Enter");
  await expect(panel).toBeVisible();
  await expect(queue).toContainText("1/88");
  await expect(queue.getByRole("listitem")).toHaveCount(88);
  await panel.getByRole("button", { name: "Minimize activity pane", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("requires a configured model before submitting bulk work", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("bulk-model-disabled", "true");
  });
  await page.reload();
  await page.getByRole("checkbox", { name: "Select dictation 1", exact: true }).check();
  const dialog = await openAction(page, "Generate titles");
  await expect(dialog.getByRole("button", { name: "Add to queue", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Set up text model" })).toBeVisible();
});
