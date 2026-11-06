import { expect, test, type Page } from "@playwright/test";
import type { HomeResult, Snapshot } from "../src/lib/backend";

test("Home recorder stays anchored when a result arrives", async ({ page }) => {
  await scenario(page);
  for (const viewport of [
    { width: 1086, height: 722 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => {
      Reflect.set(window, "anchoredHomeResult", window.homeResultsTest.result);
      window.homeResultsTest.result = null;
      window.homeResultsTest.emit();
    });
    await expect(page.getByRole("heading", { name: "Ready to record", exact: true })).toBeVisible();
    const record = page.getByRole("button", { name: "Start recording", exact: true });
    const emptyPosition = (await record.boundingBox())!;
    await page.evaluate(() => {
      window.homeResultsTest.result = Reflect.get(window, "anchoredHomeResult");
      window.homeResultsTest.emit();
    });
    await expect(page.getByRole("heading", { name: "Latest result", exact: true })).toBeVisible();
    const resultPosition = (await record.boundingBox())!;
    expect(Math.abs(resultPosition.x - emptyPosition.x)).toBeLessThan(1);
    expect(Math.abs(resultPosition.y - emptyPosition.y)).toBeLessThan(1);
  }
});

test("Home workspace keeps recording and document controls aligned while options float over full text", async ({
  page,
}) => {
  await scenario(page);
  const text = Array.from(
    { length: 40 },
    (_, i) =>
      `Paragraph ${i + 1}: the complete saved text remains available for reading and copying without a shortened preview.`,
  ).join("\n\n");
  await page.evaluate((text) => {
    const state = window.homeResultsTest;
    state.result!.text = text;
    state.result!.session.finalTranscript = text;
    state.result!.revision = "long-workspace";
    state.emit();
  }, text);
  const workspace = page.getByRole("region", { name: "Latest saved result", exact: true });
  const content = workspace.getByLabel("Result text", { exact: true });
  await expect(content).toHaveText(text);
  const record = page.getByRole("button", { name: "Start recording", exact: true });
  const before = await workspace.boundingBox();
  const action = await record.boundingBox();
  const reading = await content.boundingBox();
  expect(reading && action && Math.abs(reading.x - action.x)).toBeLessThan(2);
  await page.getByRole("button", { name: "Recording options", exact: true }).click();
  const options = page.getByRole("dialog", { name: "Recording options", exact: true });
  await expect(options).toBeVisible();
  const after = await workspace.boundingBox();
  expect(before && after && Math.abs(before.y - after.y)).toBeLessThan(1);
  await page.keyboard.press("Escape");
  await expect(options).toHaveCount(0);
  const pane = workspace.getByRole("tabpanel", { name: "Transcript", exact: true });
  expect(await pane.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await pane.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(
    await pane.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
  ).toBe(true);
  await expect(workspace.getByRole("button", { name: "Copy", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
  await page.setViewportSize({ width: 760, height: 560 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  const copy = workspace.getByRole("button", { name: "Copy", exact: true });
  await copy.focus();
  await expect(copy).toBeFocused();
  await expect(copy).toBeInViewport();
  const buttonBounds = await copy.boundingBox();
  expect(buttonBounds!.y).toBeGreaterThanOrEqual(0);
  expect(buttonBounds!.y + buttonBounds!.height).toBeLessThanOrEqual(560);
  const readingSpace = await pane.evaluate((node) => {
    const style = getComputedStyle(node);
    const text = node.querySelector("#home-result-text")!;
    return {
      height: node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      lineHeight: parseFloat(getComputedStyle(text).lineHeight),
    };
  });
  expect(readingSpace.height).toBeGreaterThanOrEqual(4 * readingSpace.lineHeight);
  const rail = page.locator("#app-sidebar");
  expect(await rail.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  for (const link of await rail.getByRole("link").all()) {
    await expect(link).toBeInViewport();
    const bounds = (await link.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.homeResultsTest.clipboard)).toBe(text);
  expect(await page.evaluate(() => window.homeResultsTest.result!.session.rawTranscript)).toBe(
    "Synthetic recognition: share the meeting notes tomorrow.",
  );
  const confirmedReadingSpace = await pane.evaluate((node) => {
    const style = getComputedStyle(node);
    return node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  });
  expect(confirmedReadingSpace).toBeGreaterThanOrEqual(2 * readingSpace.lineHeight);
  await pane.scrollIntoViewIfNeeded();
  await expect(pane).toBeInViewport();
  await pane.evaluate((node) => {
    node.scrollTop = 0;
  });
  const tabs = workspace.getByRole("tablist", { name: "Result views", exact: true });
  const tabsBounds = (await tabs.boundingBox())!;
  expect(tabsBounds.y).toBeGreaterThanOrEqual(0);
  expect(tabsBounds.y + tabsBounds.height).toBeLessThanOrEqual(560);
  expect((await content.boundingBox())!.y).toBeGreaterThanOrEqual(
    tabsBounds.y + tabsBounds.height - 1,
  );
  await pane.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(
    await pane.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(760);
  const scroll = await page.locator('[data-slot="home-recorder"]').evaluate((node) => {
    const root = node.parentElement!,
      panel = root.querySelector('[data-slot="home-result-panel"]')!,
      pane = panel.querySelector('[role="tabpanel"]')!;
    return {
      client: root.clientHeight,
      total: root.scrollHeight,
      root: root.getBoundingClientRect().toJSON(),
      panel: panel.getBoundingClientRect().toJSON(),
      pane: pane.getBoundingClientRect().toJSON(),
      text: panel.textContent?.slice(-100),
    };
  });
  expect(scroll.total <= scroll.client + 2, JSON.stringify(scroll)).toBe(true);
});

for (const language of ["en", "de"] as const) {
  test(`Home extreme heading preserves its accessible name and reading space ${language}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await scenario(page);
    await page.evaluate((language) => localStorage.setItem("desktop-language", language), language);
    await page.reload();
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    const heading = page.getByRole("heading", {
      name: language === "de" ? "Letztes Ergebnis" : "Latest result",
      exact: true,
    });
    await expect(heading).toBeVisible();
    const visibleText = heading.locator('[aria-hidden="true"]');
    await expect(visibleText).toHaveText(language === "de" ? "Ergebnis" : "Result");
    await expect(visibleText).toBeVisible();
    const pane = page.locator('[data-slot="home-result-panel"] [role="tabpanel"]');
    const text = page.locator("#home-result-text");
    await expect(text).toHaveCSS("font-size", "32px");
    await expect(text).toHaveCSS("line-height", "56px");
    expect(await pane.evaluate((node) => node.clientHeight)).toBeGreaterThanOrEqual(240);
    const named = "Meeting notes with a custom title that remains available in full";
    await page.evaluate((named) => {
      const state = window.homeResultsTest;
      state.result!.session.title = named;
      state.emit();
    }, named);
    await expect(page.getByRole("heading", { name: named, exact: true })).toHaveText(named);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("Home output tabs keep source-specific copy and return to the current result on request", async ({
  page,
}) => {
  await scenario(page);
  const outputText = "# Takeaway\n\n- Keep the original text.\n- Copy the selected output.";
  await page.evaluate((text) => {
    const state = window.homeResultsTest;
    state.result!.outputs = [
      {
        id: "synthetic-output",
        sessionId: state.result!.session.id,
        createdAt: "2026-11-04T12:00:00Z",
        model: "synthetic-model",
        endpoint: "http://127.0.0.1:11434/v1",
        prompt: { id: "summary", name: "Summary", instruction: "Summarize." },
        input: state.result!.text,
        text,
      },
    ];
    state.emit();
  }, outputText);
  const workspace = page.getByRole("region", { name: "Latest saved result", exact: true });
  const outputs = workspace.getByRole("tab", { name: /^Outputs/ });
  await outputs.click();
  await expect(workspace.getByRole("heading", { name: "Takeaway", exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "Copy output", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.homeResultsTest.clipboard)).toBe(outputText);
  await expect(outputs).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => window.homeResultsTest.result!.text)).toBe(
    "Synthetic recognition: share the meeting notes tomorrow.",
  );
  expect(await page.evaluate(() => window.homeResultsTest.result!.outputs[0].text)).toBe(
    outputText,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("yap:show-result")));
  await expect(workspace.getByRole("tab", { name: "Transcript", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await outputs.click();
  await page.setViewportSize({ width: 480, height: 760 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const compactView = workspace.getByRole("combobox", { name: "Result views", exact: true });
  await expect(compactView).toBeVisible();
  await compactView.click();
  await page.getByRole("option", { name: "Transcript", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await compactView.click();
  await page.getByRole("option", { name: /^Outputs \(/ }).click();
  await expect(compactView).toContainText("Outputs (1)");
  expect(
    await compactView.evaluate((node) => {
      const value = node.querySelector('[data-slot="select-value"]')!;
      const range = document.createRange();
      range.selectNodeContents(value.firstChild!);
      const text = range.getBoundingClientRect(),
        box = value.getBoundingClientRect();
      return text.left >= box.left - 1 && text.right <= box.right + 1;
    }),
  ).toBe(true);
  await expect(workspace.getByRole("heading", { name: "Takeaway", exact: true })).toBeInViewport();
  await expect(workspace.getByText("Keep the original text.", { exact: true })).toBeInViewport();
  await page.evaluate(() => {
    const state = window.homeResultsTest;
    const previous = state.result!;
    state.result = {
      ...previous,
      session: { ...previous.session, id: "replacement", finalTranscript: "Replacement result." },
      text: "Replacement result.",
      revision: "replacement-one",
      outputs: [],
    };
    state.emit();
  });
  await expect(workspace.getByLabel("Result text", { exact: true })).toHaveText(
    "Replacement result.",
  );
  await expect(outputs).toHaveCount(0);
  await expect(compactView).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([
    "copy:synthetic-output",
  ]);
});

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
  const readingMeasure = await page.getByLabel("Result text", { exact: true }).evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    lineHeight: getComputedStyle(node).lineHeight,
  }));
  const edit = page.getByRole("button", { name: "Edit result", exact: true });
  await edit.click();
  const dialog = page.getByRole("region", { name: "Edit result", exact: true });
  await expect(dialog).toHaveAccessibleDescription("Apply saves to History · Original preserved.");
  await expect(dialog.getByLabel("Your text")).toBeFocused();
  const draftMeasure = await dialog.getByLabel("Your text").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      contentWidth:
        node.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth),
      lineHeight: style.lineHeight,
    };
  });
  expect(Math.abs(draftMeasure.contentWidth - readingMeasure.width)).toBeLessThan(1);
  expect(draftMeasure.lineHeight).toBe(readingMeasure.lineHeight);
  expect(
    await dialog.getByLabel("Your text").evaluate((node) => node.clientHeight),
  ).toBeGreaterThan(240);
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
  await expect(
    page.getByRole("status").filter({ hasText: "Changes saved to History" }),
  ).toBeVisible();
});

for (const saved of [true, false]) {
  test(`Home keeps an unapplied ${saved ? "saved" : "temporary"} draft across navigation`, async ({
    page,
  }) => {
    await scenario(page, saved);
    const original = await page.evaluate(() => window.homeResultsTest.result!.text);
    const edit = page.getByRole("button", { name: "Edit result", exact: true });
    const editor = page.getByRole("region", { name: "Edit result", exact: true });
    const draft = editor.getByLabel("Your text", { exact: true });
    await edit.click();
    await draft.fill("Unsaved correction retained across navigation.");
    await page.getByRole("link", { name: "History", exact: true }).click();
    expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([]);
    expect(await page.evaluate(() => window.homeResultsTest.result!.text)).toBe(original);
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await edit.click();
    await expect(draft).toHaveValue("Unsaved correction retained across navigation.");

    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await edit.click();
    await expect(draft).toHaveValue(original);
    await draft.fill("Explicitly applied correction.");
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await edit.click();
    await expect(draft).toHaveValue("Explicitly applied correction.");
    expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual(["edit"]);
    expect(await page.evaluate(() => window.homeResultsTest.result!.saved)).toBe(saved);
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
  });

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

for (const replacement of ["revision", "session"] as const) {
  test(`Home does not reuse an unapplied draft for a replacement ${replacement}`, async ({
    page,
  }) => {
    await scenario(page);
    const edit = page.getByRole("button", { name: "Edit result", exact: true });
    const editor = page.getByRole("region", { name: "Edit result", exact: true });
    await edit.click();
    await editor.getByLabel("Your text").fill("A draft for the old result only.");
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.evaluate((replacement) => {
      const result = window.homeResultsTest.result!;
      if (replacement === "session") result.session.id = "replacement-session";
      else result.revision = "replacement-revision";
      result.text = result.session.finalTranscript = "Current replacement result.";
    }, replacement);
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await edit.click();
    await expect(editor.getByLabel("Your text")).toHaveValue("Current replacement result.");
    await expect(editor.getByRole("button", { name: "Apply changes", exact: true })).toBeDisabled();
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(false);
    expect(await page.evaluate(() => window.homeResultsTest.calls)).toEqual([]);
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
  await expect(unknown.getByRole("link", { name: "Open History", exact: true })).toBeVisible();
  expect((await unknown.boundingBox())!.height).toBeLessThan(240);
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
  const dialog = page.getByRole("region", { name: "Edit result", exact: true });
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
  const dialog = page.getByRole("region", { name: "Edit result", exact: true });
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
  await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeFocused();
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
  await expect(page.getByRole("status").filter({ hasText: "Paste manually" })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.homeResultsTest.snapshot.history)).toEqual(history);
    await page.getByRole("link", { name: "History", exact: true }).click();
    if (saved)
      await expect(
        page.getByText("Synthetic recognition: share the meeting notes tomorrow."),
      ).toBeVisible();
    await page.getByRole("link", { name: "Dictate", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeVisible();
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
  const dialog = page.getByRole("region", { name: "Edit result", exact: true });
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
  const dialog = page.getByRole("region", { name: "Edit result", exact: true });
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
    const dialog = page.getByRole("region", { name: "Edit result", exact: true });
    await dialog
      .getByLabel("Your text")
      .fill("Synthetic demo · Share the revised notes tomorrow and confirm the next steps.");
    await expect(dialog.getByText("Apply changes in memory.", { exact: false })).toHaveCount(0);
    await expect(dialog.getByText("Submit with Apply changes", { exact: false })).toHaveCount(0);
    await expect(dialog).toHaveAccessibleDescription(
      "Temporary result · Apply doesn’t save to History.",
    );
    await expect(dialog.getByLabel("Your text")).toHaveAccessibleDescription(
      "Temporary result · Apply doesn’t save to History.",
    );
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
