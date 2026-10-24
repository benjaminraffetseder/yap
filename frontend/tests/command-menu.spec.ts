import { expect, test, type Page } from "@playwright/test";
import type { HistoryPageResult, Session, Settings, Snapshot } from "../src/lib/backend";

async function openMenu(page: Page, query = "") {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  if (query) await input.fill(query);
  return dialog;
}

test("Ctrl/Cmd+K toggles the palette, Escape closes it, and prevented events are ignored", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openMenu(page);
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeHidden();
  await openMenu(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Meta+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Meta+k");
  await expect(dialog).toBeHidden();
  await page.evaluate(() => {
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
  });
  await expect(dialog).toBeHidden();
});

test("keywords filter commands and Settings: Advanced opens its tab", async ({ page }) => {
  await page.goto("/");
  const dialog = await openMenu(page, "diagnostics");
  await expect(dialog.getByRole("option", { name: "Dictate", exact: true })).toHaveCount(0);
  await dialog.getByRole("option", { name: "Settings: Advanced", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/settings\?section=advanced$/);
  await expect(page.getByRole("tab", { name: "Advanced", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("theme commands update the dark class and mark the selected theme", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  let dialog = await openMenu(page, "Theme: Dark");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveClass(/dark/);
  dialog = await openMenu(page, "appearance");
  await expect(
    dialog.getByRole("option", { name: "Theme: Dark (current)", exact: true }),
  ).toHaveAttribute("data-checked", "true");
  await dialog.screenshot({ path: testInfo.outputPath("command-palette-dark.png") });
  await dialog.getByRole("option", { name: "Theme: Light", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("the palette toggles the sidebar and opens by hotkey while collapsed", async ({ page }) => {
  await page.goto("/");
  const dialog = await openMenu(page);
  await dialog.getByRole("option", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await openMenu(page);
  await dialog.getByRole("option", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
});

test("browser preview enables navigation and appearance but disables native actions", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openMenu(page);
  for (const name of [
    "Start recording",
    "Import audio files…",
    "Turn Save to history off",
    "Check for updates",
  ]) {
    await expect(dialog.getByRole("option", { name: new RegExp(`^${name}`) })).toBeDisabled();
  }
  await expect(
    dialog.getByRole("option", { name: "Download a speech model…", exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByRole("option", { name: "Theme: Dark", exact: true })).toBeEnabled();
});

type PaletteState = {
  snapshot: Snapshot;
  callbacks: Record<string, (...args: unknown[]) => void>;
  actions: string[];
  searches: { query: string; page: number }[];
  requests: { query: string; resolve: () => void; reject: () => void }[];
  deferHistory: boolean;
  failAction: boolean;
  deferAction: boolean;
  finishAction: () => void;
};

declare global {
  interface Window {
    commandTest: PaletteState;
  }
}

test.describe("desktop commands and history", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const entries: Session[] = Array.from({ length: 10 }, (_, index) => ({
        id: `entry-${index}`,
        createdAt: `2026-10-${String(23 - index).padStart(2, "0")}T09:00:00Z`,
        durationMs: 5000,
        rawTranscript: `Needle original ${index}`,
        finalTranscript: `Edited dictation ${index}`,
        speechModel: "tiny",
        language: "en",
        audioPath: "",
      }));
      const snapshot: Snapshot = {
        settings: {
          microphoneId: "",
          whisperPath: "/whisper",
          modelPath: "/tiny",
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
        textProcessing: { enabled: false, endpoint: "", model: "", autoPromptId: "", prompts: [] },
        history: entries,
        models: ["tiny", "base", "small"].map((id) => ({
          id,
          name: `Whisper ${id}`,
          path: `/${id}`,
          installed: id !== "small",
          size: 100,
          diskBytes: 100,
          removable: true,
          description: "Speech model",
        })),
        dictationProfiles: ["Work", "Personal"].map((name) => ({
          id: name,
          name,
          modelPath: "/tiny",
          language: "auto",
          cleanText: false,
          autoPromptId: "",
        })),
        activeProfileId: "Work",
        ready: true,
        dataDir: "",
        floatingIndicator: false,
        launchAtLoginAvailable: true,
        startInTrayAvailable: true,
        vocabulary: [],
        microphoneTested: false,
        shortcutTested: false,
        diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
        latestResult: { session: entries[0], text: "Temporary transcript" },
      };
      const state: PaletteState = {
        snapshot,
        callbacks: {},
        actions: [],
        searches: [],
        requests: [],
        deferHistory: false,
        failAction: false,
        deferAction: false,
        finishAction: () => {},
      };
      function phase(value: string) {
        snapshot.status.phase = value;
        state.callbacks["dictation:status"]?.(structuredClone(snapshot.status));
      }
      async function action(name: string) {
        state.actions.push(name);
        if (state.failAction) throw new Error("Command failed");
        if (state.deferAction)
          await new Promise<void>((resolve) => {
            state.finishAction = resolve;
          });
      }
      Object.assign(window, {
        commandTest: state,
        runtime: {
          EventsOnMultiple: (name: string, callback: (...args: unknown[]) => void) => {
            state.callbacks[name] = callback;
            return () => {
              delete state.callbacks[name];
            };
          },
        },
        go: {
          main: {
            App: {
              GetSnapshot: async () => structuredClone(snapshot),
              GetMicrophones: async () => [],
              GetDiagnosticChecks: async () => [],
              GetProfileApplications: async () => [],
              SetIndicatorTheme: async () => {},
              CheckForUpdates: async (manual: boolean) => {
                state.actions.push(`updates:${manual}`);
                return {
                  currentVersion: "0.6.0",
                  latestVersion: "0.7.0",
                  available: true,
                  supported: true,
                  configured: true,
                  checkedAt: "",
                  downloadURL: "",
                  notes: "",
                  error: "",
                  message: "",
                };
              },
              OpenUpdateDownload: () => action("download-update"),
              StartRecording: async () => {
                await action("start");
                phase("recording");
              },
              StopRecording: async () => {
                await action("stop");
                phase("transcribing");
              },
              ImportAudio: () => action("import"),
              Cancel: async () => {
                await action("cancel");
                phase("idle");
              },
              CopyText: (text: string) => action(`copy:${text}`),
              SaveLatestResult: (id: string) => action(`save:${id}`),
              SetSaveHistory: async (value: boolean) => {
                await action(`history:${value}`);
                snapshot.settings.saveHistory = value;
              },
              ApplyDictationProfile: async (id: string) => {
                await action(`profile:${id}`);
                snapshot.activeProfileId = id;
              },
              SaveSettings: async (settings: Settings) => {
                await action(`model:${settings.modelPath}`);
                snapshot.settings = settings;
              },
              BeginShortcutCapture: async () => "capture-token",
              EndShortcutCapture: async () => {},
              GetAudioSupport: async () => ({
                installed: true,
                managed: true,
                path: "/ffmpeg",
                canDownload: true,
                size: 0,
                message: "Installed",
              }),
              GetHistory: async (query: string, page: number) => {
                state.searches.push({ query, page });
                const matches = snapshot.history.filter((entry) =>
                  `${entry.rawTranscript} ${entry.finalTranscript}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                );
                const result: HistoryPageResult = {
                  entries: structuredClone(matches.slice(page * 50, (page + 1) * 50)),
                  total: matches.length,
                  page,
                  pageSize: 50,
                };
                if (!state.deferHistory) return result;
                return new Promise<HistoryPageResult>((resolve, reject) => {
                  state.requests.push({
                    query,
                    resolve: () => resolve(result),
                    reject: () => reject(new Error("History failed")),
                  });
                });
              },
              GetSession: async (id: string) => snapshot.history.find((entry) => entry.id === id),
              GetSessionOutputs: async () => [],
            },
          },
        },
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
  });

  test("recent dictations show five entries, and selecting one opens its page", async ({
    page,
  }) => {
    const dialog = await openMenu(page);
    await expect(dialog.getByRole("option").filter({ hasText: "Edited dictation" })).toHaveCount(5);
    await dialog.getByRole("option").filter({ hasText: "Edited dictation 0" }).click();
    await expect(page).toHaveURL(/#\/history\/entry-0$/);
    await expect(dialog).toBeHidden();
  });

  test("history search debounces, uses the first page, and keeps backend matches regardless of their label", async ({
    page,
  }) => {
    await page.clock.install();
    const dialog = await openMenu(page);
    const input = dialog.getByRole("combobox");
    await input.fill("n");
    await page.clock.fastForward(250);
    expect(await page.evaluate(() => window.commandTest.searches)).toEqual([]);
    await input.fill("nee");
    await page.clock.fastForward(100);
    await input.fill("needle");
    await page.clock.fastForward(199);
    expect(await page.evaluate(() => window.commandTest.searches)).toEqual([]);
    await page.clock.fastForward(1);
    await expect(dialog.getByRole("option").filter({ hasText: "Edited dictation" })).toHaveCount(8);
    expect(await page.evaluate(() => window.commandTest.searches)).toEqual([
      { query: "needle", page: 0 },
    ]);
  });

  test("obsolete history results and errors are ignored during debounce and after closing", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.commandTest.deferHistory = true;
    });
    let dialog = await openMenu(page, "dictation 0");
    await expect.poll(() => page.evaluate(() => window.commandTest.requests.length)).toBe(1);
    await dialog.getByRole("combobox").fill("dictation 1");
    await expect.poll(() => page.evaluate(() => window.commandTest.requests.length)).toBe(2);
    await page.evaluate(() => window.commandTest.requests[1].resolve());
    await expect(
      dialog.getByRole("option").filter({ hasText: "Edited dictation 1" }),
    ).toBeVisible();
    await page.evaluate(() => window.commandTest.requests[0].reject());
    await expect(
      dialog.getByRole("option").filter({ hasText: "Edited dictation 1" }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
    await dialog.getByRole("combobox").fill("dictation 2");
    await expect.poll(() => page.evaluate(() => window.commandTest.requests.length)).toBe(3);
    await page.keyboard.press("Escape");
    dialog = await openMenu(page);
    await page.evaluate(() => window.commandTest.requests[2].resolve());
    await expect(dialog.getByRole("combobox")).toHaveValue("");
    await expect(dialog.getByRole("option").filter({ hasText: "Edited dictation" })).toHaveCount(5);
  });

  test("search all history encodes the query in the History URL", async ({ page }) => {
    const dialog = await openMenu(page, "notes & plans?");
    await dialog
      .getByRole("option", { name: 'Search all history for "notes & plans?"', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/history\?q=notes%20%26%20plans%3F$/);
    await expect(page.getByRole("textbox", { name: "Search transcripts" })).toHaveValue(
      "notes & plans?",
    );
  });

  test("recording actions follow live state, preserve the history toggle, and hide latest results while busy", async ({
    page,
  }) => {
    let dialog = await openMenu(page);
    await expect(dialog.getByRole("option", { name: /^Start recording/ })).toContainText(
      "Ctrl+Alt+Space",
    );
    await dialog.getByRole("option", { name: /^Start recording/ }).click();
    await expect(dialog).toBeHidden();
    dialog = await openMenu(page);
    await expect(dialog.getByRole("option", { name: "Stop recording", exact: true })).toBeEnabled();
    await expect(
      dialog.getByRole("option", { name: "Import audio files…", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("option", { name: "Copy latest result", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("option", { name: "Turn Save to history off", exact: true }).click();
    dialog = await openMenu(page);
    await expect(
      dialog.getByRole("option", { name: "Turn Save to history on", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("option", { name: "Stop recording", exact: true }).click();
    dialog = await openMenu(page);
    await expect(dialog.getByRole("option", { name: /^Start recording/ })).toBeDisabled();
    expect(await page.evaluate(() => window.commandTest.actions)).toEqual(
      expect.arrayContaining(["start", "history:false", "stop"]),
    );
  });

  test("download cancellation is available only during downloading and backend failures use app-error", async ({
    page,
  }) => {
    const dialog = await openMenu(page);
    await expect(dialog.getByRole("option", { name: "Cancel download", exact: true })).toHaveCount(
      0,
    );
    await page.evaluate(() => {
      const state = window.commandTest;
      state.snapshot.status.phase = "downloading";
      state.callbacks["dictation:status"](structuredClone(state.snapshot.status));
    });
    await dialog.getByRole("option", { name: "Cancel download", exact: true }).click();
    await page.evaluate(() => {
      window.commandTest.failAction = true;
    });
    await openMenu(page, "Import audio files");
    await dialog.getByRole("option", { name: "Import audio files…", exact: true }).click();
    await expect(
      page.locator('[data-slot="toast"]').filter({ hasText: "Command failed" }),
    ).toBeVisible();
  });

  test("profiles, installed models, latest result and app commands use their backend actions", async ({
    page,
  }) => {
    let dialog = await openMenu(page);
    await expect(
      dialog.getByRole("option", { name: "Switch to profile: Work (current)", exact: true }),
    ).toHaveAttribute("data-checked", "true");
    await expect(
      dialog.getByRole("option", { name: /Use speech model: Whisper small/ }),
    ).toHaveCount(0);
    for (const label of [
      "Switch to profile: Personal",
      "Use speech model: Whisper base",
      "Copy latest result",
      "Save latest result to history",
      "Check for updates",
      "Download update",
    ]) {
      if (label !== "Switch to profile: Personal") dialog = await openMenu(page);
      await dialog.getByRole("option", { name: label, exact: true }).click();
      await expect(dialog).toBeHidden();
    }
    expect(await page.evaluate(() => window.commandTest.actions)).toEqual(
      expect.arrayContaining([
        "profile:Personal",
        "model:/base",
        "copy:Temporary transcript",
        "save:entry-0",
        "updates:true",
        "download-update",
      ]),
    );
  });

  test("pending backend actions remain disabled when the palette is reopened", async ({ page }) => {
    await page.evaluate(() => {
      window.commandTest.deferAction = true;
    });
    let dialog = await openMenu(page);
    await dialog.getByRole("option", { name: "Import audio files…", exact: true }).click();
    dialog = await openMenu(page);
    await expect(
      dialog.getByRole("option", { name: "Import audio files…", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => window.commandTest.finishAction());
    await expect(
      dialog.getByRole("option", { name: "Import audio files…", exact: true }),
    ).toBeEnabled();
  });

  test("Ctrl+K is captured as a shortcut, including when a capture button has focus", async ({
    page,
  }) => {
    await page.goto("/#/settings?section=dictation");
    await page.getByRole("button", { name: "Record shortcut", exact: true }).click();
    const capture = page.getByRole("dialog", { name: "Record shortcut", exact: true });
    await expect(
      capture.getByRole("group", { name: "Shortcut capture", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(capture).toContainText("Ctrl+K");
    await capture.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette", exact: true })).toBeHidden();
    await expect(capture).toBeVisible();
    await capture.getByRole("button", { name: "Cancel", exact: true }).click();
    await openMenu(page);
  });
});
