import { expect, test, type Page } from "@playwright/test";
import type {
  ChatMessage,
  ChatReference,
  ChatRequest,
  GeneratedOutput,
  Session,
  SessionChat,
  Snapshot,
} from "../src/lib/backend";
import { referenceRanges } from "../src/lib/chat-references";

async function scenario(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-language", "en");
    const session: Session = {
      id: "chat",
      title: "Launch notes",
      createdAt: "2026-11-01T12:00:00Z",
      durationMs: 18000,
      rawTranscript: "The deadline is Friday.\n\nAlex owns the launch.",
      finalTranscript: "The deadline is Friday.\n\nAlex owns the launch.",
      speechModel: "tiny",
      language: "en",
      audioPath: "",
    };
    const snapshot: Snapshot = {
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
        model: "local-model",
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
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const state = {
      session,
      snapshot,
      chat: {
        sessionId: "chat",
        messages: [],
        sources: [],
        summary: "",
        compactedThrough: 0,
      } as SessionChat,
      outputs: [] as GeneratedOutput[],
      calls: [] as ChatRequest[],
      reply: "Friday is the deadline. [[1]]",
      defer: false,
      cancelled: false,
      finish: () => {},
      clipboard: "",
      voiceID: "",
      voiceText: "What should we do next?",
      voiceDeferred: false,
      voiceFinish: () => {},
      references: null as ChatReference[] | null,
      update(text: string) {
        session.finalTranscript = text;
        callbacks["dictation:history"]?.();
      },
    };
    const methods = {
      GetSnapshot: async () => structuredClone(snapshot),
      GetHomeResult: async () => null,
      GetSession: async () => structuredClone(session),
      GetSessionOutputs: async () => structuredClone(state.outputs),
      GetSessionChat: async () => structuredClone(state.chat),
      SaveTranscript: async (_id: string, text: string) => state.update(text),
      GetHistory: async () => ({
        entries: [structuredClone(session)],
        total: 1,
        page: 0,
        pageSize: 50,
      }),
      GetMicrophones: async () => [],
      GetDiagnosticChecks: async () => [],
      SetIndicatorTheme: async () => {},
      CheckForUpdates: async () => ({
        currentVersion: "0.8.0",
        latestVersion: "",
        available: false,
        supported: false,
        configured: false,
        checkedAt: "",
        downloadURL: "",
        notes: "",
        error: "",
        message: "",
      }),
      SendChatMessage: async (id: string, _sessionID: string, request: ChatRequest) => {
        state.calls.push(structuredClone(request));
        state.cancelled = false;
        let selected = request.selection;
        if (request.retry) {
          const user = state.chat.messages.at(-2)!;
          request = {
            ...request,
            message: user.content,
            source: state.chat.sources.find((item) => item.id === user.sourceId)!.kind,
          };
          selected = user.selection ?? "";
          state.chat.messages.splice(-2);
        }
        const text =
          request.source === "original" ? session.rawTranscript : session.finalTranscript;
        const source = { id: `${request.source}:${text}`, kind: request.source, text };
        if (!state.chat.sources.some((item) => item.id === source.id))
          state.chat.sources.push(source);
        const turn: ChatMessage = {
          id,
          role: "assistant",
          content: "",
          sourceId: source.id,
          selection: selected,
          createdAt: new Date().toISOString(),
          state: "pending",
          references: [],
        };
        state.chat.messages.push(
          { ...turn, id: `user-${id}`, role: "user", content: request.message, state: "complete" },
          turn,
        );
        callbacks["chat:progress"]?.({
          sessionId: "chat",
          requestId: id,
          content: "Streaming reply",
          compacting: false,
        });
        if (state.defer)
          await new Promise<void>((resolve) => {
            state.finish = resolve;
          });
        turn.content = state.cancelled ? "Partial reply" : state.reply;
        turn.state = state.cancelled ? "cancelled" : "complete";
        turn.references = state.cancelled
          ? []
          : (state.references ?? [{ number: 1, quote: text.split("\n")[0] }]);
        return structuredClone(state.chat);
      },
      StartChatVoice: async (id: string) => {
        state.voiceID = id;
      },
      StopChatVoice: async (id: string) => {
        callbacks["chat:voice"]?.({
          sessionId: "chat",
          requestId: id,
          phase: "transcribing",
          text: "",
          error: "",
        });
        if (state.voiceDeferred)
          await new Promise<void>((resolve) => {
            state.voiceFinish = resolve;
          });
        if (state.voiceID !== id) throw new Error("Voice cancelled");
        state.voiceID = "";
        callbacks["chat:voice"]?.({
          sessionId: "chat",
          requestId: id,
          phase: "done",
          text: state.voiceText,
          error: "",
        });
        return state.voiceText;
      },
      CancelTextProcessing: async (id: string) => {
        if (state.voiceID === id) {
          state.voiceID = "";
          state.voiceFinish();
          callbacks["chat:voice"]?.({
            sessionId: "chat",
            requestId: id,
            phase: "cancelled",
            text: "",
            error: "",
          });
          return;
        }
        state.cancelled = true;
        state.finish();
      },
      ClearSessionChat: async () => {
        state.chat = {
          sessionId: "chat",
          messages: [],
          sources: [],
          summary: "",
          compactedThrough: 0,
        };
      },
      CopyText: async (text: string) => {
        state.clipboard = text;
      },
      SaveChatReply: async (_sessionID: string, id: string) => {
        const msg = state.chat.messages.find((item) => item.id === id)!;
        const output: GeneratedOutput = {
          id: `output-${id}`,
          sessionId: "chat",
          createdAt: msg.createdAt,
          prompt: { id: "chat", name: "Chat", instruction: "Saved chat reply" },
          model: "local-model",
          endpoint: "http://127.0.0.1:11434/v1",
          input: state.chat.sources.find((item) => item.id === msg.sourceId)!.text,
          text: msg.content,
          citations: {
            source: state.chat.sources.find((item) => item.id === msg.sourceId)!.kind,
            references: msg.references,
          },
        };
        state.outputs.push(output);
        callbacks["dictation:history"]?.();
        return output;
      },
      ApplyChatReply: async (_sessionID: string, id: string, expected: string) => {
        if (session.finalTranscript !== expected)
          throw new Error("The transcription changed during review");
        const msg = state.chat.messages.find((item) => item.id === id)!;
        const replacement = msg.content.replace(/\[\[\d+\]\]/g, "").trim();
        state.update(msg.selection ? expected.replace(msg.selection, replacement) : replacement);
      },
    };
    Reflect.set(window, "chatTest", state);
    Reflect.set(window, "mockBackend", { main: { App: methods } });
    Reflect.set(window, "mockEvents", {
      subscribe: (name: string, callback: (...args: unknown[]) => void) => {
        callbacks[name] = callback;
      },
    });
  });
  await page.goto("/#/history/chat");
  await expect(page.getByRole("heading", { name: "Launch notes", exact: true })).toBeVisible();
}

async function openChat(page: Page) {
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("region", { name: "Chat", exact: true })).toBeVisible();
  await expect(page.getByText("Loading conversation…")).toHaveCount(0);
}

async function selectFirstPassage(page: Page) {
  await page
    .locator('[data-slot="chat-source-text"]')
    .first()
    .locator("p")
    .first()
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  await page.getByRole("button", { name: "Ask about selection", exact: true }).click();
}

test("docked chat shares space with the source, links output citations, and survives navigation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await scenario(page);
  const before = (await page
    .getByRole("tabpanel", { name: "Transcription", exact: true })
    .boundingBox())!;
  await openChat(page);
  const source = page.getByRole("tabpanel", { name: "Transcription", exact: true });
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  const left = (await source.boundingBox())!,
    right = (await panel.boundingBox())!;
  expect(left.width).toBeLessThan(before.width);
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(right.x + right.width).toBeLessThanOrEqual(1440);
  expect(await panel.evaluate((node) => getComputedStyle(node).position)).toBe("static");
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").defer = true;
  });
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("When is the deadline?");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByText("Streaming reply", { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "chatTest").finish());
  await panel.getByRole("button", { name: "Passage 1", exact: true }).click();
  await expect(source.locator("mark")).toHaveText("The deadline is Friday.");
  await page.screenshot({ path: testInfo.outputPath("transcription-chat.png") });
  await panel.getByRole("button", { name: "Save as output", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Copy reply", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "chatTest").clipboard))
    .toBe("Friday is the deadline.");
  await panel.getByRole("button", { name: "Close chat", exact: true }).click();
  await expect(source).toHaveJSProperty("clientWidth", Math.round(before.width));
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page
    .getByRole("tabpanel", { name: "Outputs", exact: true })
    .getByRole("button", { name: "Passage 1", exact: true })
    .click();
  await expect(source.locator("mark")).toHaveText("The deadline is Friday.");
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("button", { name: "Regenerate", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Output actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Discuss in chat", exact: true }).click();
  await expect(panel.getByText("Discussing a saved output: Chat", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").defer = false;
  });
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Make this shorter");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "chatTest").calls.at(-1).outputId))
    .toBeTruthy();
  await page.evaluate(() => {
    location.hash = "/history";
  });
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "/history/chat";
  });
  await openChat(page);
  await expect(panel.getByText("Friday is the deadline.", { exact: false }).first()).toBeVisible();
});

test("selected rewrites preserve surrounding text and reject an out-of-date review", async ({
  page,
}) => {
  await scenario(page);
  await selectFirstPassage(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  await expect(panel.getByText("Selected passage", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").reply = "The deadline is Monday. [[1]]";
  });
  await panel
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Move the deadline to Monday");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: "Review rewrite", exact: true }).click();
  let review = page.getByRole("dialog", { name: "Review rewrite", exact: true });
  await expect(review).toContainText("Alex owns the launch.");
  await page.evaluate(() =>
    Reflect.get(window, "chatTest").update("The deadline is Tuesday.\n\nAlex owns the launch."),
  );
  await expect(review.getByRole("button", { name: "Apply rewrite", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.getByRole("button", { name: "Passage 1", exact: true }).click();
  await expect(panel.getByText(/This source passage has changed/)).toBeVisible();
  await expect(page.locator("mark")).toHaveCount(0);
  await page.evaluate(() =>
    Reflect.get(window, "chatTest").update("The deadline is Friday.\n\nAlex owns the launch."),
  );
  await panel.getByRole("button", { name: "Review rewrite", exact: true }).click();
  review = page.getByRole("dialog", { name: "Review rewrite", exact: true });
  await review.getByRole("button", { name: "Apply rewrite", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "chatTest").session.finalTranscript))
    .toBe("The deadline is Monday.\n\nAlex owns the launch.");
  expect(
    await page.evaluate(() => Reflect.get(window, "chatTest").session.rawTranscript),
  ).toContain("Friday");
});

test("stopping, retrying, source updates, and clearing keep chat usable at small widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 740 });
  await scenario(page);
  await openChat(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  const transcriptBounds = (await page
    .locator('[data-slot="transcription-scroll-pane"]')
    .boundingBox())!;
  const chatBounds = (await panel.boundingBox())!;
  expect(transcriptBounds.y + transcriptBounds.height).toBeLessThanOrEqual(chatBounds.y);
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").defer = true;
  });
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Draft an email");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(panel.getByText(/Reply stopped/)).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").defer = false;
    Reflect.get(window, "chatTest").update("The deadline is Monday.");
  });
  await expect(panel.getByText(/Transcription updated/)).toBeVisible();
  await panel.getByRole("button", { name: "Retry reply", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Passage 1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole("button", { name: "Clear chat", exact: true }).click();
  const clear = page.getByRole("dialog", { name: "Clear chat", exact: true });
  await expect(clear).toContainText("saved outputs are kept");
  await clear.getByRole("button", { name: "Clear chat", exact: true }).click();
  await expect(panel.getByText(/Ask about this transcription/)).toBeVisible();
});

test("source references reject stale and ambiguous passages", () => {
  expect(referenceRanges("one café 👋 two", [{ number: 1, quote: "café 👋" }])).toEqual([
    { start: 4, end: 11 },
  ]);
  expect(referenceRanges("changed", [{ number: 1, quote: "old text" }])).toEqual([]);
  expect(referenceRanges("same same", [{ number: 2, quote: "same" }])).toEqual([]);
});

test("Markdown selections retain source formatting and editor activity blocks applying rewrites", async ({
  page,
}) => {
  await scenario(page);
  await page.evaluate(() =>
    Reflect.get(window, "chatTest").update(
      "Send **notes** tomorrow &amp; confirm.\n\nKeep this paragraph.",
    ),
  );
  await expect(page.locator('[data-slot="chat-source-text"]').first().locator("strong")).toHaveText(
    "notes",
  );
  await selectFirstPassage(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  await expect(
    panel.getByText("Send **notes** tomorrow &amp; confirm.", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Make this clearer");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Review rewrite", exact: true })).toBeDisabled();
  await expect(panel.getByText(/Finish editing the transcription/)).toBeVisible();
  await panel.getByRole("button", { name: "Passage 1", exact: true }).click();
  await expect(page.locator('[data-slot="transcript-editor"]')).toBeVisible();
});

test("transcript and conversation scroll independently and a narrow chat focuses its composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await scenario(page);
  await page.evaluate(() =>
    Reflect.get(window, "chatTest").update(
      Array.from(
        { length: 80 },
        (_, i) => `Paragraph ${i}: keep the source visible while reading a long transcription.`,
      ).join("\n\n"),
    ),
  );
  await openChat(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  const transcript = page.locator('[data-slot="transcription-scroll-pane"]');
  const conversation = panel.getByRole("log");
  const composer = panel.getByRole("textbox", { name: "Message", exact: true });
  const bounds = (await panel.boundingBox())!;
  await expect
    .poll(() => transcript.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  await transcript.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(
    transcript
      .getByRole("tabpanel", { name: "Transcription", exact: true })
      .getByText("Paragraph 79:", { exact: false }),
  ).toBeInViewport();
  await expect(composer).toBeInViewport();
  expect(await panel.boundingBox()).toEqual(bounds);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").reply = Array.from(
      { length: 60 },
      (_, i) => `Reply paragraph ${i}: a detailed answer about the transcription.`,
    ).join("\n\n");
  });
  await composer.fill("Give me a detailed answer");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => conversation.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  await conversation.evaluate((node) => {
    node.scrollTop = 0;
  });
  const transcriptScroll = await transcript.evaluate((node) => node.scrollTop);
  await conversation.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(await transcript.evaluate((node) => node.scrollTop)).toBe(transcriptScroll);
  await expect(composer).toBeInViewport();
  expect(await panel.boundingBox()).toEqual(bounds);
  await transcript.evaluate((node) => {
    node.scrollTop = 0;
  });
  await panel.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.setViewportSize({ width: 760, height: 740 });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toBeFocused();
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toBeInViewport();
});

test("compact chat uses the shared Select, matching icon actions, and no suggested prompts", async ({
  page,
}) => {
  await scenario(page);
  await openChat(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  await expect(panel.locator("select")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "What decisions were made?", exact: true }),
  ).toHaveCount(0);
  const source = panel.getByRole("combobox", { name: "Source for new replies", exact: true });
  await source.click();
  await page.getByRole("option", { name: "Original transcription", exact: true }).click();
  await expect(source).toContainText("Original transcription");
  await expect(source).toHaveAttribute("aria-expanded", "false");
  await source.click();
  await expect(source).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("When is the deadline?");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  const buttons = panel.locator('[data-slot="chat-reply-actions"]').getByRole("button");
  await expect(buttons).toHaveCount(4);
  const bounds = await buttons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top };
    }),
  );
  for (const rect of bounds) {
    expect(rect.width).toBe(32);
    expect(rect.height).toBe(32);
    expect(rect.top).toBe(bounds[0].top);
  }
});

test("voice input appends to the composer once and waits for the user to send", async ({
  page,
}) => {
  await scenario(page);
  await openChat(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  const input = panel.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("My question:");
  await page.evaluate(() => {
    Reflect.get(window, "chatTest").voiceDeferred = true;
  });
  await panel.getByRole("button", { name: "Record a voice message", exact: true }).click();
  await expect(panel.getByText("Listening…", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Transcribe voice message", exact: true }).click();
  await expect(panel.getByText("Transcribing on your device…", { exact: true })).toBeVisible();
  await input.fill("Updated question:");
  await page.evaluate(() => Reflect.get(window, "chatTest").voiceFinish());
  await expect(input).toHaveValue("Updated question: What should we do next?");
  expect(await page.evaluate(() => Reflect.get(window, "chatTest").calls.length)).toBe(0);
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "chatTest").calls[0]?.message))
    .toBe("Updated question: What should we do next?");
});

test("closing or discarding a voice message cancels capture and ignores late results", async ({
  page,
}) => {
  await scenario(page);
  await openChat(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  await panel.getByRole("button", { name: "Record a voice message", exact: true }).click();
  await panel.getByRole("button", { name: "Discard voice message", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Record a voice message", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Record a voice message", exact: true }).click();
  await panel.getByRole("button", { name: "Close chat", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "chatTest").voiceID)).toBe("");
  await openChat(page);
  await expect(panel.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("");
});

test("grouped citations link to each source and action controls stay reachable with enlarged text", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 560 });
  await page.emulateMedia({ colorScheme: "dark" });
  await scenario(page);
  await openChat(page);
  const panel = page.getByRole("region", { name: "Chat", exact: true });
  await page.evaluate(() => {
    const state = Reflect.get(window, "chatTest");
    state.reply = "The deadline and owner are stated here [[1], [2]].";
    state.references = [
      { number: 1, quote: "The deadline is Friday." },
      { number: 2, quote: "Alex owns the launch." },
    ];
  });
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill("Summarize");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Passage 1", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Passage 2", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Save as output", exact: true }).click();
  await panel.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.getByRole("tab", { name: "Outputs", exact: true }).click();
  await page
    .getByRole("tabpanel", { name: "Outputs", exact: true })
    .getByRole("button", { name: "Passage 2", exact: true })
    .click();
  await expect(
    page.getByRole("tabpanel", { name: "Transcription", exact: true }).locator("mark"),
  ).toHaveText("Alex owns the launch.");
  await openChat(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await expect(
    panel.getByRole("button", { name: "Record a voice message", exact: true }),
  ).toBeInViewport();
  await expect(panel.getByRole("button", { name: "Close chat", exact: true })).toBeInViewport();
  await expect(panel.getByRole("button", { name: "Clear chat", exact: true })).toBeInViewport();
  await expect(
    panel.getByRole("combobox", { name: "Source for new replies", exact: true }),
  ).toBeInViewport();
  const panelBounds = (await panel.boundingBox())!;
  const sidebarBounds = (await page.locator("#app-sidebar").boundingBox())!;
  expect(panelBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x + sidebarBounds.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("chat-docked-narrow-dark.png") });
});
