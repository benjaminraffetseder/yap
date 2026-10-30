import { expect, test, type Page } from "@playwright/test";
import type { HomeResult, Snapshot } from "../src/lib/backend";

declare global {
  interface Window {
    homeResultsTest: {
      result: HomeResult | null;
      snapshot: Snapshot;
      calls: string[];
      clipboard: string;
      fail: string;
      failRead: boolean;
      defer: boolean;
      release: () => void;
      emit: () => void;
      setBusy: (busy: boolean) => void;
      accept: (imported?: boolean) => void;
      frame: (label: string, revision: number, dark: boolean, recovery: boolean) => void;
    };
  }
}

async function scenario(page: Page, saved = true) {
  await page.addInitScript(
    ({ saved }) => {
      localStorage.setItem("desktop-theme", "light");
      localStorage.setItem("yap-sidebar-collapsed", "true");
      const session = {
        id: "synthetic-result",
        createdAt: "2026-10-30T10:42:00Z",
        durationMs: 18000,
        rawTranscript: "Synthetic recognition: share the meeting notes tomorrow.",
        finalTranscript: "Synthetic recognition: share the meeting notes tomorrow.",
        speechModel: "tiny",
        language: "en",
        audioPath: "",
      };
      const callbacks: Record<string, (...args: unknown[]) => void> = {};
      const state: Window["homeResultsTest"] = {
        result: {
          session,
          outputs: [],
          text: session.finalTranscript,
          outputId: "",
          revision: "one",
          saved,
          imported: false,
          outcomes: {
            transcription: "complete",
            history: saved ? "saved" : "temporary",
            processing: "skipped",
            clipboard: "complete",
            paste: "requested",
          },
        },
        snapshot: {
          settings: {
            microphoneId: "",
            whisperPath: "/synthetic",
            modelPath: "/synthetic-model",
            language: "auto",
            shortcut: "Ctrl+F12",
            interaction: "toggle",
            autoCopy: true,
            autoPaste: true,
            saveHistory: saved,
            saveAudio: false,
            launchAtLogin: false,
            startInTray: false,
            cleanText: false,
            setupComplete: true,
            historyRetentionDays: 0,
          },
          status: {
            phase: "done",
            message: "Paste requested; copied to clipboard",
            startedAt: 0,
            transcript: "",
            progress: 0,
            shortcutError: "",
            indicatorError: "",
            trayError: "",
            startupError: "",
            historyError: "",
          },
          history: saved ? [session] : [],
          models: [
            {
              id: "tiny",
              name: "Whisper Tiny",
              path: "/synthetic-model",
              description: "Synthetic installed model",
              size: 100,
              diskBytes: 100,
              removable: true,
              installed: true,
            },
          ],
          ready: true,
          textProcessing: {
            enabled: false,
            endpoint: "http://127.0.0.1:11434/v1",
            model: "",
            autoPromptId: "",
            prompts: [],
            chains: [],
          },
          dataDir: "",
          floatingIndicator: true,
          launchAtLoginAvailable: false,
          startInTrayAvailable: false,
          vocabulary: [],
          microphoneTested: false,
          shortcutTested: false,
          diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
          dictationProfiles: [
            {
              id: "default",
              name: "Default",
              modelPath: "/synthetic-model",
              language: "auto",
              cleanText: false,
              autoPromptId: "",
            },
          ],
          activeProfileId: "default",
          defaultProfileId: "default",
          profileModified: false,
        },
        calls: [],
        clipboard: "",
        fail: "",
        failRead: false,
        defer: false,
        release: () => {},
        emit() {
          this.snapshot.history = this.result?.saved ? [this.result.session] : [];
          this.snapshot.latestResult =
            this.result && !this.result.saved
              ? {
                  session: this.result.session,
                  text: this.result.text,
                  outputs: this.result.outputs,
                }
              : null;
          callbacks["dictation:history"]?.();
        },
        setBusy(busy) {
          this.snapshot.status.phase = busy ? "text-processing" : "done";
          callbacks["dictation:status"]?.(structuredClone(this.snapshot.status));
        },
        accept(imported = false) {
          if (!this.result?.saved) this.result = null;
          this.snapshot.latestResult = null;
          this.snapshot.status.phase = imported ? "transcribing" : "recording";
          this.snapshot.status.importId = imported ? "synthetic-import" : "";
          this.snapshot.status.startedAt = Date.now();
          callbacks["dictation:status"]?.(structuredClone(this.snapshot.status));
        },
        frame(label, revision, dark, recovery) {
          callbacks["indicator:frame"]?.({
            label,
            revision,
            dark,
            phase: "done",
            primary: recovery ? "Open Yap" : "",
            secondary: "Dismiss",
            level: 0,
          });
        },
      };
      window.homeResultsTest = state;
      const methods = {
        GetSnapshot: async () => structuredClone(state.snapshot),
        GetHomeResult: async () => {
          if (state.failRead) throw new Error("Synthetic read failure");
          return structuredClone(state.result);
        },
        HomeResultAction: async (id: string, revision: string, action: string, text: string) => {
          if (state.defer)
            await new Promise<void>((resolve) => {
              state.release = resolve;
            });
          if (
            state.snapshot.status.phase === "recording" ||
            !state.result ||
            state.result.session.id !== id ||
            state.result.revision !== revision
          )
            throw new Error("Stale or busy result");
          if (state.fail === action) throw new Error("Synthetic action failure");
          state.calls.push(action);
          const result = state.result;
          if (action === "edit") {
            result.session.finalTranscript = text;
            result.text = text;
            result.outputId = "";
            result.outcomes.clipboard = "skipped";
            result.outcomes.paste = "skipped";
          }
          if (action === "save") {
            if (result.saved) throw new Error("Already saved");
            result.saved = true;
            result.outcomes.history = "saved";
          }
          if (action === "copy") {
            state.clipboard = result.text;
            result.outcomes.clipboard = "complete";
          }
          if (action.startsWith("copy:")) {
            const output = result.outputs.find((value) => value.id === action.slice(5));
            if (!output) throw new Error("Deleted output");
            state.clipboard = output.text;
          }
          result.revision += ":next";
          if (action === "dismiss") {
            state.result = null;
            state.snapshot.latestResult = null;
            callbacks["dictation:history"]?.();
          } else state.emit();
        },
        CheckForUpdates: async () => ({
          currentVersion: "0.7.0",
          latestVersion: "",
          available: false,
          configured: false,
          supported: false,
          checkedAt: "",
          downloadURL: "",
          notes: "",
          error: "",
          message: "",
        }),
        GetAudioSupport: async () => ({
          installed: true,
          managed: false,
          path: "",
          canDownload: false,
          size: 0,
          message: "",
        }),
        GetHistory: async () => ({
          entries: state.snapshot.history,
          page: 0,
          pageSize: 50,
          total: state.snapshot.history.length,
        }),
        GetSession: async (id: string) =>
          state.result?.session.id === id ? state.result.session : null,
        GetSessionOutputs: async () => state.result?.outputs ?? [],
        SetIndicatorTheme: async () => {},
        RetryShortcut: async () => {},
        StartRecording: async () => {
          if (state.fail === "start") throw new Error("Synthetic rejected start");
          state.accept();
        },
        StopRecording: async () => state.setBusy(false),
        Cancel: async () => state.setBusy(false),
      };
      Reflect.set(window, "mockBackend", { main: { App: methods } });
      Reflect.set(window, "mockEvents", {
        subscribe: (name: string, callback: (...args: unknown[]) => void) => {
          callbacks[name] = callback;
        },
      });
    },
    { saved },
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit result", exact: true })).toBeEnabled();
}

test("saved edits submit explicitly, cancel without writes, return focus and keep provenance", async ({
  page,
}) => {
  await scenario(page);
  const edit = page.getByRole("button", { name: "Edit result", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog", { name: "Edit result" });
  await dialog.getByLabel("Your text").fill("Synthetic discarded draft.");
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(dialog.getByLabel("Your text")).not.toHaveValue("Synthetic discarded draft.");
  await dialog.getByLabel("Your text").fill("Synthetic corrected text.");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([]);
  await dialog.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual(["edit"]);
  expect(await page.evaluate(() => window.homeResultsTest.result!.session.rawTranscript)).toContain(
    "Synthetic recognition:",
  );
  await expect(page.getByRole("status")).toContainText("Changes saved to History");
});

for (const saved of [true, false]) {
  test(`returning to Home waits for pending reads and shows the current ${saved ? "saved" : "temporary"} result`, async ({
    page,
  }, testInfo) => {
    await scenario(page, saved);
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.evaluate(() => {
      // Model the backend's serialized read reservation, including a reply
      // from a Home view that has already unmounted.
      let tail = Promise.resolve();
      let started = 0;
      Reflect.set(window, "homeReadStarted", () => started);
      Reflect.get(window, "mockBackend").main.App.GetHomeResult = () => {
        const read = tail.then(async () => {
          started++;
          const result = structuredClone(window.homeResultsTest.result);
          await new Promise((resolve) => setTimeout(resolve, 150));
          return result;
        });
        tail = read.then(() => {});
        return read;
      };
    });
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "homeReadStarted")()))
      .toBeGreaterThan(0);
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.evaluate(() => {
      const result = window.homeResultsTest.result!;
      result.text = result.session.finalTranscript = "Synthetic current result after navigation.";
      result.revision = "navigation-current";
    });
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await expect(page.getByLabel("Result text")).toHaveText(
      "Synthetic current result after navigation.",
    );
    await expect(page.getByRole("button", { name: "Refresh result", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit result", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.homeResultsTest.clipboard))
      .toBe("Synthetic current result after navigation.");
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Result action in progress")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`home-return-${saved ? "saved" : "temporary"}.png`),
      animations: "disabled",
    });
  });
}

test("a genuine return-to-Home read failure stays recoverable without calling an unknown result temporary", async ({
  page,
}) => {
  await scenario(page);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await page.evaluate(() => {
    window.homeResultsTest.failRead = true;
  });
  await page.getByRole("link", { name: "Dictate", exact: true }).click();
  const unknown = page.getByRole("region", { name: "Latest result", exact: true });
  await expect(unknown.getByRole("button", { name: "Refresh result" })).toBeVisible();
  await expect(unknown).not.toContainText("Temporary");
  await page.evaluate(() => {
    window.homeResultsTest.failRead = false;
  });
  await unknown.getByRole("button", { name: "Refresh result" }).click();
  await expect(page.getByRole("region", { name: "Latest saved result" })).toContainText(
    "Synthetic recognition",
  );
  await expect(page.getByRole("button", { name: "Edit result", exact: true })).toBeEnabled();
});

test("temporary edit is memory-only, IME cannot submit, busy keeps draft, failures can retry", async ({
  page,
}) => {
  await scenario(page, false);
  await page.getByRole("button", { name: "Edit result", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("Your text");
  await input.fill("Synthetic 日本語 correction.");
  await input.dispatchEvent("compositionstart");
  await input.press("Control+Enter");
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([]);
  await input.dispatchEvent("compositionend");
  await page.evaluate(() => window.homeResultsTest.setBusy(true));
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await expect(input).toHaveValue("Synthetic 日本語 correction.");
  await page.evaluate(() => window.homeResultsTest.setBusy(false));
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeEnabled();
  await page.evaluate(() => {
    window.homeResultsTest.fail = "edit";
  });
  await input.press("Control+Enter");
  await expect(dialog.getByRole("alert")).toContainText("draft is kept");
  await expect(input).toHaveValue("Synthetic 日本語 correction.");
  await page.evaluate(() => {
    window.homeResultsTest.fail = "";
  });
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.homeResultsTest.snapshot.history)).toEqual([]);
  expect(await page.evaluate(() => window.homeResultsTest.result!.saved)).toBe(false);
  await page.evaluate(() => {
    window.homeResultsTest.fail = "save";
  });
  await page.getByRole("button", { name: "Save to History", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your text is kept");
  await page.evaluate(() => {
    window.homeResultsTest.fail = "";
    window.homeResultsTest.failRead = true;
  });
  await page.getByRole("button", { name: "Save to History", exact: true }).click();
  await expect(page.getByText("Couldn’t refresh the result.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to History", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual(["edit", "save"]);
  await page.evaluate(() => {
    window.homeResultsTest.failRead = false;
  });
  await page.getByRole("button", { name: "Refresh result" }).click();
  await expect(page.getByRole("button", { name: "Edit result", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.homeResultsTest.calls.filter((action) => action === "save").length,
    ),
  ).toBe(1);
});

test("pending edits reject duplicate submit and dismissal; replacement/deletion retains stale drafts", async ({
  page,
}) => {
  await scenario(page);
  await page.getByRole("button", { name: "Edit result", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your text").fill("Synthetic pending edit.");
  await page.evaluate(() => {
    window.homeResultsTest.defer = true;
  });
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    window.homeResultsTest.defer = false;
    window.homeResultsTest.release();
  });
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Edit result", exact: true }).click();
  await dialog.getByLabel("Your text").fill("Synthetic stale draft to retain.");
  await page.evaluate(() => {
    window.homeResultsTest.result = null;
    window.homeResultsTest.emit();
  });
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await expect(dialog.getByLabel("Your text")).toHaveValue("Synthetic stale draft to retain.");
  await expect(dialog.getByText("The result changed.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recent dictations", exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual(["edit"]);
});

test("copy revalidates the backend revision, failed copy retries explicitly, dismiss stays memory-only", async ({
  page,
}) => {
  await scenario(page, false);
  await page.evaluate(() => {
    window.homeResultsTest.result!.revision = "replaced-behind-ui";
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn’t complete");
  expect(await page.evaluate(() => window.homeResultsTest.clipboard)).toBe("");
  await page.evaluate(() => {
    window.homeResultsTest.fail = "copy";
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.homeResultsTest.clipboard)).toBe("");
  await page.evaluate(() => {
    window.homeResultsTest.fail = "";
  });
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Paste manually");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.homeResultsTest.snapshot.history)).toEqual([]);
});

for (const saved of [true, false]) {
  test(`dismiss silently hides the ${saved ? "saved" : "temporary"} result across navigation`, async ({
    page,
  }, info) => {
    await scenario(page, saved);
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    await expect(dismiss).toBeVisible({ timeout: 3000 });
    const history = await page.evaluate(() => window.homeResultsTest.snapshot.history);
    await dismiss.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`dismiss-${saved ? "saved" : "temporary"}-before.png`),
    });
    await dismiss.click();
    await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toHaveCount(0);
    await expect(page.getByText("Temporary result dismissed.", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Recent dictations", exact: true }),
    ).toBeFocused();
    expect(await page.evaluate(() => window.homeResultsTest.snapshot.history)).toEqual(history);
    await page.getByRole("link", { name: "History", exact: true }).click();
    if (saved)
      await expect(
        page.getByText("Synthetic recognition: share the meeting notes tomorrow."),
      ).toBeVisible();
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Recent dictations", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toHaveCount(0);
    await expect(page.getByText("Temporary result dismissed.", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`dismiss-${saved ? "saved" : "temporary"}-after.png`),
    });
  });
}

test("Dismiss stays available after saving a temporary result", async ({ page }) => {
  await scenario(page, false);
  await page.getByRole("button", { name: "Save to History", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Latest saved result", exact: true }),
  ).toBeVisible();
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  await expect(dismiss).toBeVisible({ timeout: 3000 });
  await expect(dismiss).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save to History", exact: true })).toHaveCount(0);
  await dismiss.click();
  await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toHaveCount(0);
  await expect(page.getByText("Temporary result dismissed.", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.homeResultsTest.snapshot.history)).toHaveLength(1);
});

test("a read failure inside the editor retains the draft through an explicit refresh", async ({
  page,
}) => {
  await scenario(page);
  await page.getByRole("button", { name: "Edit result", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your text").fill("");
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await dialog.getByLabel("Your text").fill("Synthetic draft retained during read failure.");
  await page.evaluate(() => {
    window.homeResultsTest.failRead = true;
    window.homeResultsTest.emit();
  });
  await expect(dialog.getByRole("button", { name: "Refresh result" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await page.evaluate(() => {
    window.homeResultsTest.failRead = false;
  });
  await dialog.getByRole("button", { name: "Refresh result" }).click();
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeEnabled();
  await expect(dialog.getByLabel("Your text")).toHaveValue(
    "Synthetic draft retained during read failure.",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([]);
});

test("accepted capture/import expires temporary text despite cancel/read failure; rejected start preserves it", async ({
  page,
}) => {
  await scenario(page, false);
  await page.evaluate(() => {
    window.homeResultsTest.fail = "start";
  });
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Result text")).toContainText("Synthetic recognition");
  await page.evaluate(() => {
    window.homeResultsTest.fail = "";
  });
  await page.getByRole("button", { name: "Start recording", exact: true }).click();
  await expect(page.getByLabel("Result text")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.homeResultsTest.failRead = true;
    window.homeResultsTest.setBusy(false);
  });
  await expect(page.getByRole("button", { name: "Refresh result" })).toBeVisible();
  await expect(page.getByLabel("Result text")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await scenario(page, false);
  await page.getByRole("button", { name: "Edit result", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Your text")
    .fill("Synthetic dirty draft retained after accepted import.");
  await page.evaluate(() => window.homeResultsTest.accept(true));
  await expect(page.getByLabel("Result text")).toHaveCount(0);
  await expect(dialog.getByLabel("Your text")).toHaveValue(
    "Synthetic dirty draft retained after accepted import.",
  );
  await expect(dialog.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  await expect(dialog.getByText("The result changed.", { exact: false })).toBeVisible();
  await page.evaluate(() => {
    window.homeResultsTest.failRead = true;
    window.homeResultsTest.setBusy(false);
  });
  await expect(dialog.getByRole("button", { name: "Refresh result" })).toBeVisible();
  await expect(dialog.getByLabel("Your text")).toHaveValue(
    "Synthetic dirty draft retained after accepted import.",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
});

test("synthetic indicator presentation media uses recovery and paste-request wording", async ({
  page,
}, info) => {
  await scenario(page);
  await page.goto("/indicator.html");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 520, height: 68 });
  await page.getByRole("main", { name: "Dictation status" }).waitFor();
  for (const [index, dark] of [false, true].entries()) {
    await page.evaluate(
      ({ revision, dark }) =>
        window.homeResultsTest.frame("Open Yap to recover text", revision, dark, true),
      { revision: index * 2 + 1, dark },
    );
    await expect(page.getByRole("button", { name: "Open Yap", exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`synthetic-indicator-recovery-${dark ? "dark" : "light"}.png`),
    });
    await page.evaluate(
      ({ revision, dark }) =>
        window.homeResultsTest.frame("Paste requested", revision, dark, false),
      { revision: index * 2 + 2, dark },
    );
    await expect(page.getByText("Paste requested", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Yap", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`synthetic-indicator-paste-requested-${dark ? "dark" : "light"}.png`),
    });
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`synthetic Home result layout and interaction media ${theme}`, async ({ page }, info) => {
    await scenario(page, false);
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      const state = window.homeResultsTest;
      state.result!.text =
        "Synthetic demo · Share the updated meeting notes tomorrow. Keep the follow-up clear and easy to review.";
      state.result!.outcomes = {
        transcription: "complete",
        history: "failed",
        processing: "failed",
        clipboard: "failed",
        paste: "failed",
      };
      state.emit();
    }, theme);
    const region = page.getByRole("region", { name: "Temporary latest result" });
    await expect(region.getByRole("alert")).toHaveText(
      "Not saved to History. Save this result to keep it.",
    );
    await expect(region.getByText("What happened", { exact: false })).toHaveCount(0);
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`synthetic-home-${theme}-desktop.png`),
      fullPage: true,
    });
    await page.waitForTimeout(600);
    await region.getByRole("button", { name: "Edit result", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Your text")
      .fill("Synthetic demo · Share the revised notes tomorrow and confirm the next steps.");
    await expect(dialog.getByText("Apply changes in memory.", { exact: false })).toHaveCount(0);
    await expect(dialog.getByText("Submit with Apply changes", { exact: false })).toHaveCount(0);
    await expect(dialog).not.toHaveAttribute("aria-describedby");
    await page.screenshot({ path: info.outputPath(`synthetic-home-editor-${theme}-desktop.png`) });
    await page.waitForTimeout(600);
    await dialog.getByRole("button", { name: "Apply changes" }).click();
    await expect(dialog).toHaveCount(0);
    await region.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(region.getByRole("status")).toContainText("Paste manually");
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 760, height: 560 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
      window.homeResultsTest.result!.text =
        "Syntheticlongtext".repeat(45) + " · 日本語の合成データ";
      window.homeResultsTest.emit();
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
    await region.getByRole("button", { name: "Edit result", exact: true }).focus();
    await expect(region.getByRole("button", { name: "Edit result", exact: true })).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`synthetic-home-${theme}-760-200.png`),
      fullPage: true,
    });
    await region.getByRole("button", { name: "Edit result", exact: true }).press("Enter");
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`synthetic-home-editor-${theme}-760-200.png`) });
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(region.getByRole("button", { name: "Edit result", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
    await expect.poll(() => region.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await region.getByRole("button", { name: "Save to History", exact: true }).focus();
    await expect(
      region.getByRole("button", { name: "Save to History", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: info.outputPath(`synthetic-home-${theme}-760-200-expanded.png`),
      fullPage: true,
    });
  });
}
