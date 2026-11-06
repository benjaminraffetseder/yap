import { expect, test } from "@playwright/test";
import { validateTextProcessing } from "../src/lib/draft-validation";

test("built-in context validation respects each model limit", () => {
  const value = {
    enabled: true,
    provider: "builtin",
    endpoint: "unused",
    model: "gemma-4-e2b",
    contextLength: 8192,
    autoPromptId: "",
    prompts: [],
    chains: [],
  };
  expect(validateTextProcessing(value)).toBe("");
  expect(validateTextProcessing({ ...value, contextLength: 262144 })).not.toBe("");
  expect(validateTextProcessing({ ...value, model: "gemma-4-12b", contextLength: 262144 })).toBe(
    "",
  );
  expect(validateTextProcessing({ ...value, contextLength: 0 })).toBe("");
  expect(validateTextProcessing({ ...value, contextLength: 2049 })).not.toBe("");
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("desktop-language", "en");
    const config = {
      enabled: true,
      provider: "builtin",
      endpoint: "http://127.0.0.1:11434/v1",
      model: "gemma-4-e2b",
      contextLength: 0,
      autoPromptId: "",
      prompts: [],
      chains: [],
    };
    const state = {
      textProcessing: config,
      textRuntimeAvailable: true,
      recommendedTextContext: 8192,
      textModels: [
        {
          id: "gemma-4-e2b",
          name: "Gemma 4 E2B",
          size: 3349516256,
          maxContext: 131072,
          installed: true,
        },
        {
          id: "gemma-4-e4b",
          name: "Gemma 4 E4B",
          size: 5154941280,
          maxContext: 131072,
          installed: false,
        },
        {
          id: "gemma-4-12b",
          name: "Gemma 4 12B",
          size: 6975879296,
          maxContext: 262144,
          installed: true,
        },
      ],
      settings: {
        setupComplete: true,
        modelPath: "/tiny",
        whisperPath: "/whisper",
        microphoneId: "",
        language: "auto",
        shortcut: "Ctrl+Alt+Space",
        interaction: "hold",
        saveHistory: true,
        autoCopy: true,
        autoPaste: true,
      },
      status: {
        phase: "idle",
        message: "Ready",
        progress: 0,
        startedAt: 0,
        transcript: "",
        shortcutError: "",
        indicatorError: "",
        trayError: "",
        startupError: "",
        historyError: "",
      },
      models: [],
      history: [],
      vocabulary: [],
      ready: true,
      microphoneTested: true,
      shortcutTested: true,
      dataDir: "",
      diagnostic: {},
    };
    const calls: unknown[] = [];
    Reflect.set(window, "textModelTest", { state, calls });
    const callbacks: Record<string, (data?: unknown) => void> = {};
    Reflect.set(window, "mockEvents", {
      subscribe: (name: string, cb: (data?: unknown) => void) => {
        callbacks[name] = cb;
      },
    });
    Reflect.set(window, "mockBackend", {
      main: {
        App: {
          GetSnapshot: async () => structuredClone(state),
          CheckForUpdates: async () => ({ available: false, error: "" }),
          GetHistory: async () => ({ entries: [], total: 0, hasMore: false }),
          GetMicrophones: async () => [],
          GetHomeResult: async () => null,
          CompleteSetup: async (skip: boolean) => {
            calls.push(`setup:${skip}`);
            if (!skip && (!state.ready || !state.microphoneTested || !state.shortcutTested))
              throw new Error("Complete the dictation checks first");
            state.settings.setupComplete = true;
          },
          SaveTextProcessing: async (value: typeof config) => {
            calls.push(structuredClone(value));
            state.textProcessing = structuredClone(value);
            return structuredClone(value);
          },
          ListTextModels: async () => {
            calls.push("external-discovery");
            return [];
          },
          TestTextModel: async () => {
            calls.push("test-text-model");
            return "OK";
          },
          CancelTextProcessing: async () => {},
          Cancel: async () => {
            calls.push("cancel");
            state.status.phase = "idle";
            callbacks["dictation:status"]?.(structuredClone(state.status));
          },
          InstallTextModel: async (id: string) => {
            calls.push(`install:${id}`);
            state.textModels.find((m) => m.id === id)!.installed = true;
            callbacks["setup:changed"]?.();
          },
          RemoveTextModel: async (id: string) => {
            calls.push(`remove:${id}`);
            state.textModels.find((m) => m.id === id)!.installed = false;
          },
        },
      },
    });
  });
});

test("context controls save, follow model limits, and preserve automatic selection", async ({
  page,
}) => {
  await page.goto("/#/prompts?section=models");
  const context = page.getByRole("combobox", { name: "Context length", exact: true });
  await expect(context).toContainText("Automatic");
  await context.click();
  await expect(page.getByRole("option", { name: "262,144 tokens", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "32,768 tokens", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing.contextLength),
    )
    .toBe(32768);
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "Gemma 4 12B", exact: true }).click();
  await context.click();
  await page.getByRole("option", { name: "262,144 tokens", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing.contextLength),
    )
    .toBe(262144);
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "Gemma 4 E2B", exact: true }).click();
  await expect(context).toContainText("Automatic");
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing.contextLength),
    )
    .toBe(0);
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "textModelTest").calls.includes("external-discovery"),
    ),
  ).toBe(false);
  await page.reload();
  await expect(context).toContainText("Automatic");
});

test("library downloads and removes text models through dedicated methods", async ({ page }) => {
  await page.goto("/#/models?type=text");
  const card = page.getByRole("article", { name: "Gemma 4 E4B", exact: true });
  await card.getByRole("button", { name: "Download", exact: true }).click();
  await expect(card.getByText("Downloaded", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "More actions · Gemma 4 E4B", exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(card.getByText("Not downloaded", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => Reflect.get(window, "textModelTest").calls);
  expect(calls).toEqual(["install:gemma-4-e4b", "remove:gemma-4-e4b"]);
  await page.getByRole("button", { name: "More actions · Gemma 4 E2B", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Remove", exact: true })).toBeDisabled();
});

test("text downloads can be cancelled and resumed from the library", async ({ page }) => {
  await page.addInitScript(() => {
    const state = Reflect.get(window, "textModelTest").state;
    state.textModels[1].diskBytes = 67108864;
    state.status = {
      ...state.status,
      phase: "downloading",
      message: "Checking or downloading gemma-4-e4b…",
      progress: 0.5,
    };
  });
  await page.goto("/#/models?type=text");
  const library = page.getByRole("region", { name: "Built-in text models", exact: true });
  const card = library.getByRole("article", { name: "Gemma 4 E4B", exact: true });
  await expect(library.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(card.getByRole("button", { name: "Resume download", exact: true })).toBeDisabled();
  await library.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByRole("button", { name: "Resume download", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "Resume download", exact: true }).click();
  await expect(card.getByText("Downloaded", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "textModelTest").calls)).toEqual([
    "cancel",
    "install:gemma-4-e4b",
  ]);
});

test("model segments switch catalogs, support keyboard navigation, and persist in the URL", async ({
  page,
}) => {
  await page.goto("/#/models");
  const speech = page.getByRole("tab", { name: "Speech models", exact: true });
  const text = page.getByRole("tab", { name: "Text models", exact: true });
  const library = page.getByRole("region", { name: "Built-in text models", exact: true });
  await expect(speech).toHaveAttribute("aria-selected", "true");
  await expect(library).toBeHidden();
  await text.click();
  await expect(library).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search models", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(text).toHaveAttribute("aria-selected", "true");
  await text.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(speech).toHaveAttribute("aria-selected", "true");
  await expect(library).toBeHidden();
  await page.goto("/#/models#text-models");
  await expect(text).toHaveAttribute("aria-selected", "true");
});

test("using a downloaded text model enables it and resets an oversized context", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = Reflect.get(window, "textModelTest").state;
    state.textProcessing.model = "gemma-4-12b";
    state.textProcessing.contextLength = 262144;
  });
  await page.goto("/#/models?type=text");
  const row = page.getByRole("article", { name: "Gemma 4 E2B", exact: true });
  await row.getByRole("button", { name: "Use model", exact: true }).click();
  await expect(row).toHaveAttribute("aria-current", "true");
  const saved = await page.evaluate(
    () => Reflect.get(window, "textModelTest").state.textProcessing,
  );
  expect(saved).toMatchObject({
    enabled: true,
    provider: "builtin",
    model: "gemma-4-e2b",
    contextLength: 0,
  });
});

test("setup enables a downloaded text model, saves context, and tests it before finishing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = Reflect.get(window, "textModelTest").state;
    state.settings.setupComplete = false;
    state.textProcessing.enabled = false;
    state.textModels.forEach((model: { installed: boolean }) => {
      model.installed = false;
    });
  });
  await page.goto("/");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  const setup = page.getByRole("region", { name: "Text model setup", exact: true });
  await expect(setup).toBeVisible();
  const finish = page.getByRole("button", { name: "Finish setup", exact: true });
  await expect(finish).toBeDisabled();
  const row = setup.getByRole("article", { name: "Gemma 4 E2B", exact: true });
  await row.getByRole("button", { name: "Download", exact: true }).click();
  await row.getByRole("button", { name: "Use model", exact: true }).click();
  await expect(finish).toBeEnabled();
  await setup.getByRole("combobox", { name: "Context length", exact: true }).click();
  await page.getByRole("option", { name: "16,384 tokens", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing.contextLength),
    )
    .toBe(16384);
  await setup.getByRole("button", { name: "Test model", exact: true }).click();
  await expect(setup.getByText("Model responded successfully.", { exact: true })).toBeVisible();
  await finish.click();
  await expect(page.getByRole("heading", { name: "Set up Yap", exact: true })).toBeHidden();
  expect(
    await page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing),
  ).toMatchObject({
    enabled: true,
    provider: "builtin",
    model: "gemma-4-e2b",
    contextLength: 16384,
  });
});

for (const previouslyEnabled of [false, true]) {
  test(`setup can skip text models without bypassing dictation checks${previouslyEnabled ? " and disables an unavailable model" : ""}`, async ({
    page,
  }) => {
    await page.addInitScript((enabled) => {
      const state = Reflect.get(window, "textModelTest").state;
      state.settings.setupComplete = false;
      state.textProcessing.enabled = enabled;
      state.textModels.forEach((model: { installed: boolean }) => {
        model.installed = false;
      });
    }, previouslyEnabled);
    await page.goto("/");
    for (let i = 0; i < 3; i++)
      await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Set up Yap", exact: true })).toBeHidden();
    expect(
      await page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing.enabled),
    ).toBe(false);
    const calls = await page.evaluate(() => Reflect.get(window, "textModelTest").calls);
    expect(calls.at(-1)).toBe("setup:false");
    expect(
      calls.filter((call: unknown) => typeof call === "string" && call.startsWith("install:")),
    ).toEqual([]);
  });
}

test("setup keeps an existing external text-model configuration", async ({ page }) => {
  await page.addInitScript(() => {
    const state = Reflect.get(window, "textModelTest").state;
    state.settings.setupComplete = false;
    state.textProcessing.provider = "external";
    state.textProcessing.model = "existing-local-model";
  });
  await page.goto("/");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByText(
      "Your external text model existing-local-model is enabled. Keep it, or choose a built-in model above.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up Yap", exact: true })).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(window, "textModelTest").calls)).toEqual([
    "setup:false",
  ]);
});
