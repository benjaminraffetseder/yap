import { expect, test, type Page } from "@playwright/test";

async function scenario(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-language", "en");
    const session = {
      id: "editing",
      title: "Editing sample",
      createdAt: "2026-11-23T10:00:00Z",
      durationMs: 1000,
      rawTranscript: "Alex original.",
      finalTranscript: "Alex **owns** launch. Alex waits.",
      speechModel: "tiny",
      language: "en",
      audioPath: "",
    };
    const original = "Original generated output. [[1]]";
    const output = {
      id: "output-one",
      sessionId: session.id,
      createdAt: session.createdAt,
      prompt: { id: "summary", name: "Summary", instruction: "Summarize." },
      model: "local",
      endpoint: "http://127.0.0.1:11434/v1",
      input: session.rawTranscript,
      text: original,
      originalText: original,
      edited: false,
      citations: { source: "original", references: [{ number: 1, quote: session.rawTranscript }] },
    };
    const snapshot = {
      settings: {
        microphoneId: "",
        whisperPath: "/synthetic",
        modelPath: "/tiny",
        language: "auto",
        shortcut: "Ctrl+F12",
        interaction: "toggle",
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
      history: [session],
      models: [],
      ready: true,
      textProcessing: {
        enabled: true,
        endpoint: "http://127.0.0.1:11434/v1",
        model: "local",
        autoPromptId: "",
        prompts: [],
        chains: [],
      },
      dataDir: "",
      floatingIndicator: false,
      launchAtLoginAvailable: false,
      startInTrayAvailable: false,
      vocabulary: [],
      microphoneTested: false,
      shortcutTested: false,
      diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
    };
    const listeners: Record<string, (data?: unknown) => void> = {};
    const state = {
      session,
      output,
      writes: 0,
      clipboard: "",
      emit: () => listeners["dictation:history"]?.(),
    };
    Reflect.set(window, "contentEditingTest", state);
    Reflect.set(window, "mockBackend", {
      app: {
        App: {
          GetSnapshot: async () => snapshot,
          GetHomeResult: async () => null,
          GetSession: async () => session,
          GetSessionOutputs: async () => [output],
          GetSessionChat: async () => ({
            sessionId: session.id,
            messages: [],
            sources: [],
            summary: "",
            compactedThrough: 0,
          }),
          GetHistory: async () => ({ entries: [session], total: 1, page: 0, pageSize: 50 }),
          GetMicrophones: async () => [],
          GetDiagnosticChecks: async () => [],
          GetRevisions: async () => [
            { id: 1, createdAt: session.createdAt, updatedAt: session.createdAt, value: original },
          ],
          CheckForUpdates: async () => ({
            currentVersion: "0.15.0",
            latestVersion: "",
            supported: false,
            configured: false,
            available: false,
            checkedAt: "",
            downloadURL: "",
            notes: "",
            error: "",
            message: "",
          }),
          SaveSessionOutput: async (
            _sessionID: string,
            _outputID: string,
            text: string,
            expected: string,
          ) => {
            if (output.text !== expected)
              throw new Error("the output changed while editing; your draft was kept");
            state.writes++;
            output.text = text;
            output.edited = text !== original;
            state.emit();
            return output;
          },
          SaveTranscriptChecked: async (_id: string, text: string, expected: string) => {
            if (session.finalTranscript !== expected)
              throw new Error("the transcript changed while editing; your draft was kept");
            state.writes++;
            session.finalTranscript = text;
            state.emit();
          },
          CopyText: async (text: string) => {
            state.clipboard = text;
          },
          RefineSelection: async () => "Refined selection.",
          CancelTextProcessing: async () => {},
        },
      },
    });
    Reflect.set(window, "mockEvents", {
      subscribe: (name: string, callback: (data?: unknown) => void) => {
        listeners[name] = callback;
      },
      ClipboardSetText: async (text: string) => {
        state.clipboard = text;
        return true;
      },
    });
  });
  await page.goto("/#/history/editing");
  await expect(page.getByRole("heading", { name: "Editing sample", exact: true })).toBeVisible();
}

test("detail search owns only the active document and preserves citation rendering", async ({
  page,
}) => {
  await scenario(page);
  await expect(page.getByRole("button", { name: "Find in document", exact: true })).toHaveCount(0);
  const actions = page.getByRole("button", { name: "Dictation actions", exact: true });
  await actions.click();
  await page.getByRole("menuitem", { name: "Find in document", exact: true }).click();
  const search = page.getByRole("search");
  await expect(search.getByRole("textbox")).toBeFocused();
  await search.getByRole("textbox").fill("Alex");
  await expect(search.getByRole("status")).toHaveText("1 / 2");
  await search.getByRole("button", { name: "Next", exact: true }).click();
  await expect(search.getByRole("status")).toHaveText("2 / 2");
  await search.getByRole("textbox").press("Escape");
  await expect(actions).toBeFocused();
  await page.keyboard.press("Control+f");
  await expect(search.getByRole("textbox")).toBeFocused();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await expect(page.getByRole("button", { name: "Find in document", exact: true })).toHaveCount(0);
  await actions.focus();
  await actions.press("Enter");
  await page.getByRole("menuitem", { name: "Find in document", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("search").getByRole("textbox")).toBeFocused();
  await page.getByRole("search").getByRole("textbox").fill("Alex");
  await expect(page.getByRole("search").getByRole("status")).toHaveText("1 / 1");
  await page.getByRole("search").getByRole("textbox").press("Escape");
  await expect(actions).toBeFocused();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Passage 1", exact: true })).toBeVisible();
  const outputs = page.getByRole("region", { name: "Generated outputs", exact: true });
  const find = outputs.getByRole("button", { name: "Find in document", exact: true });
  await find.click();
  const outputSearch = outputs.getByRole("search");
  const outputQuery = outputSearch.getByRole("textbox", { name: "Find in document", exact: true });
  await expect(outputQuery).toBeFocused();
  await outputQuery.fill("Original");
  await expect(outputSearch.getByRole("status")).toHaveText("1 / 1");
  await page.evaluate(() => {
    const app = Reflect.get(window, "mockBackend").app.App;
    const read = app.GetSessionOutputs;
    app.GetSessionOutputs = async () => {
      await new Promise<void>((resolve) => Reflect.set(window, "releaseOutputRefresh", resolve));
      app.GetSessionOutputs = read;
      return read();
    };
    Reflect.get(window, "contentEditingTest").emit();
  });
  await expect(outputs.getByRole("button", { name: "Edit output", exact: true })).toBeDisabled();
  await outputQuery.press("Escape");
  await expect(find).toBeFocused();
  await page.evaluate(() => Reflect.get(window, "releaseOutputRefresh")());
  await expect(outputs.getByRole("button", { name: "Edit output", exact: true })).toBeEnabled();
  await page.keyboard.press("Control+f");
  await expect(outputQuery).toBeFocused();
  await outputQuery.press("Escape");
  const edit = outputs.getByRole("button", { name: "Edit output", exact: true });
  await edit.click();
  await outputs.getByRole("button", { name: "Done", exact: true }).click();
  await expect(edit).toBeFocused();
});

test("output edits autosave in place, preserve original and citations, and restore original", async ({
  page,
}) => {
  await scenario(page);
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "Edit output", exact: true }).click();
  const editor = page.locator('[data-slot="output-editor"]');
  await editor
    .getByRole("textbox", { name: "Editing output", exact: true })
    .fill("Edited generated output. [[1]]");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "contentEditingTest").output.text))
    .toContain("Edited generated output.");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "contentEditingTest").output.text))
    .toContain("[[1]]");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "contentEditingTest").output.originalText))
    .toBe("Original generated output. [[1]]");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Passage 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit output", exact: true }).click();
  await editor.getByRole("button", { name: "Editing tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Restore original", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "contentEditingTest").output.text))
    .toBe("Original generated output. [[1]]");
});

for (const kind of ["output", "transcript"] as const) {
  test(`conflicting ${kind} save retains its draft and retries explicitly against the confirmed text`, async ({
    page,
  }) => {
    await scenario(page);
    if (kind === "output") {
      await page.getByRole("tab", { name: "Outputs", exact: true }).click();
      await page.getByRole("button", { name: "Edit output", exact: true }).click();
    } else await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
    const editor = page.locator(`[data-slot="${kind}-editor"]`);
    const field = editor.getByRole("textbox", {
      name: kind === "output" ? "Editing output" : "Editable text",
      exact: true,
    });
    await field.fill("My pending draft.");
    await page.evaluate((kind) => {
      const state = Reflect.get(window, "contentEditingTest");
      if (kind === "output") state.output.text = "Newer native text.";
      else state.session.finalTranscript = "Newer native text.";
      state.emit();
    }, kind);
    await expect(editor.getByRole("alert")).toContainText("changed while editing");
    await expect(field).toHaveText("My pending draft.");
    expect(
      await page.evaluate((kind) => {
        const state = Reflect.get(window, "contentEditingTest");
        return kind === "output" ? state.output.text : state.session.finalTranscript;
      }, kind),
    ).toBe("Newer native text.");
    expect(await page.evaluate(() => Reflect.get(window, "contentEditingTest").writes)).toBe(0);
    await editor.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate((kind) => {
          const state = Reflect.get(window, "contentEditingTest");
          return kind === "output" ? state.output.text : state.session.finalTranscript;
        }, kind),
      )
      .toBe("My pending draft.");
    expect(await page.evaluate(() => Reflect.get(window, "contentEditingTest").writes)).toBe(1);
    await expect(editor.getByRole("alert")).toHaveCount(0);
  });
}

test("editing chrome uses matching button sizes, shadcn checkbox, overflow menu and sticky toolbar", async ({
  page,
}, info) => {
  await scenario(page);
  await page.evaluate(() => {
    const state = Reflect.get(window, "contentEditingTest");
    state.output.text = Array.from(
      { length: 65 },
      (_, index) => `Alex paragraph ${index + 1}. Notes for this document.`,
    ).join("\n\n");
    state.output.edited = true;
    state.emit();
  });
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page.getByRole("button", { name: "Edit output", exact: true }).click();
  const editor = page.locator('[data-slot="output-editor"]');
  const copy = await editor.getByRole("button", { name: "Copy", exact: true }).boundingBox();
  const done = await editor.getByRole("button", { name: "Done", exact: true }).boundingBox();
  expect(copy!.height).toBe(done!.height);
  await expect(editor.getByRole("button", { name: "Version history", exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "Editing tools", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Version history", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const textbox = editor.getByRole("textbox", { name: "Editing output", exact: true });
  await textbox.focus();
  await page.keyboard.press("Control+f");
  const search = editor.getByRole("search");
  await search.getByRole("textbox", { name: "Find", exact: true }).fill("Alex");
  await search.getByRole("textbox", { name: "Replace with", exact: true }).fill("Alek");
  await expect(
    search.getByRole("checkbox", { name: "Remember replacement in dictionary", exact: true }),
  ).toHaveAttribute("data-slot", "checkbox");
  const toolbar = editor.locator('[data-slot="content-editor-toolbar"]');
  await expect(toolbar).toHaveCSS("position", "sticky");
  const stickyTop = await toolbar.evaluate((node) => {
    let scroller = node.parentElement;
    while (
      scroller &&
      !(
        getComputedStyle(scroller).overflowY.match(/auto|scroll/) &&
        scroller.scrollHeight > scroller.clientHeight
      )
    )
      scroller = scroller.parentElement;
    const target = scroller ?? document.scrollingElement!;
    const top = scroller?.getBoundingClientRect().top ?? 0;
    target.scrollTop += node.getBoundingClientRect().top - top + 250;
    return top;
  });
  await expect
    .poll(async () => (await toolbar.boundingBox())!.y)
    .toBeGreaterThanOrEqual(stickyTop - 1);
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeLessThan(stickyTop + 3);
  await page.screenshot({ path: info.outputPath("content-editing-toolbar.png") });
});
