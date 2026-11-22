import { expect, test, type Page } from "@playwright/test";
import en from "../src/i18n/locales/en.json" with { type: "json" };
import type { DictationProfile } from "../src/lib/backend";
import { validateTextProcessing } from "../src/lib/validation/draft-validation";

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
        cleanText: false,
        saveAudio: false,
        launchAtLogin: false,
        startInTray: false,
        historyRetentionDays: 0,
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
      diagnostic: {
        phase: "",
        message: "",
        details: "",
        transcript: "",
        rawTranscript: "",
        durationMs: 0,
      },
      dictationProfiles: [] as DictationProfile[],
      activeProfileId: "",
    };
    const calls: unknown[] = [];
    const callbacks: Record<string, (data?: unknown) => void> = {};
    Reflect.set(window, "textModelTest", { state, calls, callbacks, failUpdate: false });
    Reflect.set(window, "mockEvents", {
      subscribe: (name: string, cb: (data?: unknown) => void) => {
        callbacks[name] = cb;
      },
    });
    Reflect.set(window, "mockBackend", {
      app: {
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
          CompleteOnboarding: async (profile: DictationProfile, value: typeof config) => {
            if (
              !state.ready ||
              !state.microphoneTested ||
              !state.shortcutTested ||
              state.diagnostic.phase !== "done"
            )
              throw new Error("Complete the dictation checks first");
            calls.push("setup:false");
            state.textProcessing = structuredClone(value);
            state.dictationProfiles.push(structuredClone(profile));
            state.activeProfileId = profile.id;
            state.settings.setupComplete = true;
          },
          StartDiagnosticTest: async () => {
            state.diagnostic.phase = "recording";
            state.status.phase = "diagnostic-recording";
            callbacks["dictation:status"]?.(structuredClone(state.status));
            callbacks["setup:changed"]?.();
          },
          StopDiagnosticTest: async () => {
            state.diagnostic = {
              phase: "done",
              message: "Runtime and model verified",
              details: "",
              rawTranscript: "My sample text",
              transcript: "My sample text.",
              durationMs: 1000,
            };
            state.status.phase = "idle";
            callbacks["dictation:status"]?.(structuredClone(state.status));
            callbacks["setup:changed"]?.();
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
          UpdateTextRuntime: async (id: string) => {
            calls.push(`runtime:${id}`);
            if (Reflect.get(window, "textModelTest").failUpdate)
              throw new Error("Synthetic text runtime update failure");
            Object.assign(state.status, {
              phase: "downloading",
              message: "Updating text runtime…",
              progress: 0.42,
            });
            callbacks["dictation:status"]?.(structuredClone(state.status));
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

test("model test cancellation stays inline while genuine failures notify", async ({ page }) => {
  await page.addInitScript(() => {
    const app = Reflect.get(window, "mockBackend").app.App;
    app.TestTextModel = () =>
      new Promise<string>((resolve) => Reflect.set(window, "finishCancelledModelTest", resolve));
  });
  await page.goto("/#/prompts?section=models");
  const testModel = page.getByRole("button", { name: "Test model", exact: true });
  await expect(testModel).toBeEnabled();
  await testModel.click();
  await page.getByRole("button", { name: "Cancel test", exact: true }).click();
  await page.evaluate(() =>
    Reflect.get(window, "finishCancelledModelTest")("Late successful result"),
  );
  await expect(testModel).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Processing cancelled" })).toBeVisible();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Processing cancelled" }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Model responded successfully" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    Reflect.get(window, "mockBackend").app.App.TestTextModel = async () => {
      throw new Error("Synthetic model connection failure");
    };
  });
  await testModel.click();
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: "Synthetic model connection failure" }),
  ).toBeVisible();
});

test("text runtime updates keep model and prompt selections through failure, cancel and success", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixture = Reflect.get(window, "textModelTest");
    fixture.state.textModels
      .filter((model: { installed: boolean }) => model.installed)
      .forEach((model: object) => Object.assign(model, { runtimeUpdateAvailable: true }));
  });
  await page.goto("/#/models?type=text");
  const row = page.getByRole("article", { name: "Gemma 4 E2B", exact: true });
  const update = row.getByRole("button", { name: "Update runtime", exact: true });
  const before = await page.evaluate(() =>
    structuredClone(Reflect.get(window, "textModelTest").state.textProcessing),
  );
  await expect(update).toBeEnabled();
  await page.evaluate(() => {
    Reflect.get(window, "textModelTest").failUpdate = true;
  });
  await update.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic text runtime update failure" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Reflect.get(window, "textModelTest").failUpdate = false;
  });
  await update.click();
  const section = page.getByRole("region", { name: "Built-in text models", exact: true });
  await expect(section.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  await section.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(update).toBeEnabled();
  await update.click();
  await page.evaluate(() => {
    const fixture = Reflect.get(window, "textModelTest");
    fixture.state.textModels.forEach((model: object) =>
      Object.assign(model, { runtimeUpdateAvailable: false }),
    );
    Object.assign(fixture.state.status, {
      phase: "idle",
      message: "Text runtime updated.",
      progress: 0,
    });
    fixture.callbacks["dictation:status"]?.(structuredClone(fixture.state.status));
    fixture.callbacks["setup:changed"]?.(["catalogs"]);
  });
  await expect(page.getByRole("button", { name: "Update runtime", exact: true })).toHaveCount(0);
  const after = await page.evaluate(() => ({
    config: Reflect.get(window, "textModelTest").state.textProcessing,
    calls: Reflect.get(window, "textModelTest").calls,
  }));
  expect(after.config).toEqual(before);
  expect(
    after.calls.filter((call: unknown) => typeof call === "string" && call.startsWith("install:")),
  ).toEqual([]);
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

test("model storage labels the whole library and shows downloaded category counts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = Reflect.get(window, "textModelTest").state;
    state.models = [
      {
        id: "tiny",
        name: "Whisper Tiny",
        size: 77691713,
        path: "/tiny",
        installed: true,
        diskBytes: 77691713,
        removable: true,
        description: "",
      },
    ];
    state.textModels.forEach((model: { installed: boolean; size: number; diskBytes?: number }) => {
      model.diskBytes = model.installed ? model.size : 0;
    });
  });
  await page.goto("/#/models");
  await expect(page.getByText("All models: 3 downloaded · 10.4 GB", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Speech models", exact: true })).toContainText("1");
  await expect(page.getByRole("tab", { name: "Text models", exact: true })).toContainText("2");
  await page.getByRole("tab", { name: "Text models", exact: true }).click();
  await expect(page.getByText("All models: 3 downloaded · 10.4 GB", { exact: true })).toBeVisible();
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

async function openOnboardingWorkflow(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: en["onboarding.goalTitle"] })).toBeVisible();
  for (let index = 0; index < 4; index++)
    await page
      .getByRole("button", { name: /^(Next|Continue to text workflow)$/, exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: /^(Next|Continue to text workflow)$/, exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: en["onboarding.practiceDictation"], exact: true }).click();
  await page.getByRole("button", { name: "Stop dictation test", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^(Next|Continue to text workflow)$/, exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: /^(Next|Continue to text workflow)$/, exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Add a text model (optional)" })).toBeVisible();
}

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
  await openOnboardingWorkflow(page);
  const setup = page.locator("main");
  await expect(
    page.getByRole("button", { name: en["onboarding.finishBasic"], exact: true }),
  ).toBeEnabled();
  const row = setup.getByRole("article", { name: "Gemma 4 E2B", exact: true });
  await row.getByRole("button", { name: "Download", exact: true }).click();
  await row.getByRole("button", { name: "Use model", exact: true }).click();
  await setup
    .getByRole("button", { name: en["onboarding.changeModelOptions"], exact: true })
    .click();
  await setup.getByRole("combobox", { name: "Context length", exact: true }).click();
  await page.getByRole("option", { name: "16,384 tokens", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "textModelTest").state.textProcessing.contextLength),
    )
    .toBe(16384);
  await setup.getByRole("button", { name: "Test model", exact: true }).click();
  await expect(setup.getByText("Model responded successfully.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^(Next|Continue to text workflow)$/, exact: true })
    .click();
  await page
    .getByRole("button", { name: en["onboarding.saveActivateProfile"], exact: true })
    .click();
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
    await openOnboardingWorkflow(page);
    await page.getByRole("button", { name: en["onboarding.finishBasic"], exact: true }).click();
    await expect(
      page.getByRole("heading", { name: en["onboarding.profileHeading"], exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: en["onboarding.finishBasic"], exact: true }).click();
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
  await openOnboardingWorkflow(page);
  await page
    .getByRole("button", { name: en["onboarding.changeModelOptions"], exact: true })
    .click();
  await expect(
    page.getByText(
      "Your external text model existing-local-model is enabled. Keep it, or choose a built-in model above.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^(Next|Continue to text workflow)$/, exact: true })
    .click();
  await page
    .getByRole("button", { name: en["onboarding.saveActivateProfile"], exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Set up Yap", exact: true })).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(window, "textModelTest").calls)).toEqual([
    "setup:false",
  ]);
});
