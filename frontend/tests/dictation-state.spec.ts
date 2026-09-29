import { expect, test, type Page } from "@playwright/test"
import type { DiagnosticCheck, Settings, Snapshot, Status, VocabularyEntry } from "../src/lib/backend"

declare global {
  interface Window {
    dictationTest: {
      snapshot: Snapshot
      callbacks: Record<string, (...args: unknown[]) => void>
      deferSnapshots: boolean
      pendingSnapshots: (() => void)[]
      failSave: boolean
      exportedText: string
      checks: DiagnosticCheck[]
      status: (phase: string) => void
      history: () => void
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state: Window["dictationTest"] = {
      snapshot: {
        settings: { microphoneId: "", whisperPath: "/whisper", modelPath: "/model", language: "auto", shortcut: "Ctrl+Alt+Space", interaction: "hold", autoPaste: true, saveAudio: false, launchAtLogin: false, startInTray: false, cleanText: false, setupComplete: true },
        status: { phase: "idle", message: "Ready", startedAt: 0, transcript: "", progress: 0, shortcutError: "", indicatorError: "", trayError: "", startupError: "" },
        models: [], history: [], ready: true, dataDir: "", floatingIndicator: true, launchAtLoginAvailable: true, startInTrayAvailable: true, vocabulary: [], microphoneTested: false, shortcutTested: false, diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
      },
      callbacks: {}, deferSnapshots: false, pendingSnapshots: [], failSave: false, exportedText: "", checks: [{ id: "runtime", name: "Whisper runtime", ready: true, message: "Executable found" }, { id: "model", name: "Speech model", ready: true, message: "Model file readable" }, { id: "microphone", name: "Microphone", ready: true, message: "System default" }],
      status(phase: string) {
        state.snapshot.status = { ...state.snapshot.status, phase, message: phase === "transcribing" ? "Transcribing…" : "Ready", startedAt: Date.now() }
        state.callbacks["dictation:status"](structuredClone(state.snapshot.status))
      },
      history() { state.callbacks["dictation:history"]() },
    }
    window.dictationTest = state
    Object.assign(window, {
      runtime: {
        EventsOnMultiple(topic: string, handler: (...args: unknown[]) => void) {
          state.callbacks[topic] = handler
          return () => { delete state.callbacks[topic] }
        },
      },
      go: { main: { App: {
        GetSnapshot() {
          const copy = structuredClone(state.snapshot)
          if (state.deferSnapshots) return new Promise(resolve => { state.pendingSnapshots.push(() => resolve(copy)) })
          return Promise.resolve(copy)
        },
        GetMicrophones: async () => [{ id: "usb", name: "USB microphone" }],
        GetDiagnosticChecks: async () => structuredClone(state.checks),
        StartDiagnosticTest: async () => { state.snapshot.diagnostic = { phase: "recording", message: "Say a short sentence", details: "", transcript: "", durationMs: 0 }; state.status("diagnostic-recording"); state.callbacks["dictation:level"](.6) },
        StopDiagnosticTest: async () => { state.snapshot.diagnostic.phase = "transcribing"; state.snapshot.diagnostic.message = "Transcribing test…"; state.status("diagnostic-transcribing") },
        SaveSettings: async (settings: Settings) => {
          if (state.failSave) throw new Error("Settings save failed")
          if (settings.microphoneId !== state.snapshot.settings.microphoneId) state.snapshot.microphoneTested = false
          if (settings.shortcut !== state.snapshot.settings.shortcut) state.snapshot.shortcutTested = false
          state.snapshot.settings = structuredClone(settings)
        },
        SaveVocabulary: async (entries: VocabularyEntry[]) => {
          if (state.failSave) throw new Error("Vocabulary save failed")
          state.snapshot.vocabulary = structuredClone(entries.map(entry => ({ ...entry, canonical: entry.canonical.trim() })))
          return structuredClone(state.snapshot.vocabulary)
        },
        AddVocabularyTerm: async (canonical: string, aliases: string[]) => {
          if (state.failSave) throw new Error("Vocabulary save failed")
          if (state.snapshot.status.phase === "recording") throw new Error("finish the current operation before changing vocabulary")
          canonical = canonical.trim()
          for (const phrase of [canonical, ...aliases]) {
            if (state.snapshot.vocabulary.some(entry => [entry.canonical, ...entry.aliases].some(value => value.toLowerCase() === phrase.toLowerCase()))) throw new Error(`"${phrase}" is already assigned to another vocabulary term`)
          }
          state.snapshot.vocabulary.push({ id: crypto.randomUUID(), canonical, aliases, enabled: true })
          state.callbacks["setup:changed"]()
          return structuredClone(state.snapshot.vocabulary)
        },
        StartMicrophoneTest: async () => { state.snapshot.microphoneTested = false; state.status("mic-test"); state.callbacks["dictation:level"](.6) },
        StopMicrophoneTest: async () => { state.snapshot.microphoneTested = true; state.status("idle") },
        Cancel: async () => { if (state.snapshot.status.phase.startsWith("diagnostic-")) state.snapshot.diagnostic = { phase: "cancelled", message: "Test cancelled", details: "", transcript: "", durationMs: 0 }; state.snapshot.microphoneTested = false; state.status("idle") },
        CompleteSetup: async () => { state.snapshot.settings.setupComplete = true },
        RestartSetup: async () => { state.snapshot.settings.setupComplete = false; state.snapshot.microphoneTested = false; state.snapshot.shortcutTested = false },
        InstallModel: async (id: string) => { state.status("downloading"); state.snapshot.settings.modelPath = `/${id}`; state.snapshot.settings.whisperPath = "/whisper" },
        SaveTranscript: async (id: string, text: string) => {
          if (state.failSave) throw new Error("Transcript save failed")
          const entry = state.snapshot.history.find(item => item.id === id)
          if (!entry) throw new Error("This dictation no longer exists")
          entry.finalTranscript = text
          state.history()
        },
        ExportSession: async (id: string) => { state.exportedText = state.snapshot.history.find(entry => entry.id === id)?.finalTranscript ?? "" },
        CopyText: async (text: string) => { state.snapshot.status.transcript = text },
        StartRecording: async () => { state.status("recording") },
      } } },
    })
  })
})

// Wait for React to commit after releasing a deliberately delayed bridge reply.
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  })
}

test("startup options apply only on save and survive refreshes and failed saves", async ({ page }) => {
  await page.goto("/#/settings")
  const login = page.getByRole("checkbox", { name: "Launch at login", exact: true })
  const background = page.getByRole("checkbox", { name: /Start in tray \/ menu bar/ })
  await expect(login).toBeEnabled()
  await expect(login).not.toBeChecked()
  await expect(background).not.toBeChecked()
  await login.check()
  await background.check()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.launchAtLogin)).toBe(false)
  await page.evaluate(() => { window.dictationTest.history(); window.dictationTest.failSave = true })
  await settle(page)
  await expect(login).toBeChecked()
  await expect(background).toBeChecked()
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(page.getByText("Settings save failed", { exact: true })).toBeVisible()
  await expect(login).toBeChecked()
  await expect(background).toBeChecked()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.launchAtLogin)).toBe(false)
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.startInTray && window.dictationTest.snapshot.settings.launchAtLogin)).toBe(true)
  await login.uncheck()
  await background.uncheck()
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.startInTray || window.dictationTest.snapshot.settings.launchAtLogin)).toBe(false)
})

test("unsupported startup controls are disabled and registration errors are visible", async ({ page }) => {
  await page.goto("/#/settings")
  const login = page.getByRole("checkbox", { name: "Launch at login", exact: true })
  await expect(login).toBeEnabled()
  await page.evaluate(() => {
    window.dictationTest.snapshot.launchAtLoginAvailable = false
    window.dictationTest.snapshot.startInTrayAvailable = false
    window.dictationTest.snapshot.status.startupError = "Launch at login unavailable: access denied"
    window.dictationTest.history()
  })
  await expect(login).toBeDisabled()
  await expect(page.getByRole("checkbox", { name: /Start in tray \/ menu bar/ })).toBeDisabled()
  await expect(page.getByRole("alert").filter({ hasText: "Launch at login unavailable: access denied" })).toBeVisible()
})

test("history refresh preserves edits, and saving clears the dirty state", async ({ page }) => {
  await page.goto("/#/settings")
  const shortcut = page.getByLabel("Global shortcut", { exact: true })
  await expect(shortcut).toHaveValue("Ctrl+Alt+Space")
  await shortcut.fill("Ctrl+Alt+P")
  await page.getByRole("combobox", { name: "Microphone" }).click()
  await page.getByRole("option", { name: "USB microphone", exact: true }).click()
  await page.evaluate(() => window.dictationTest.history())
  await settle(page)
  await expect(shortcut).toHaveValue("Ctrl+Alt+P")
  await expect(page.getByRole("combobox", { name: "Microphone" })).toContainText("USB microphone")
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.microphoneId)).toBe("usb")
  await expect(shortcut).toHaveValue("Ctrl+Alt+P")
})

test("pristine settings follow backend changes while failed saves retain edits", async ({ page }) => {
  await page.goto("/#/settings")
  const shortcut = page.getByLabel("Global shortcut", { exact: true })
  await expect(shortcut).toHaveValue("Ctrl+Alt+Space")
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.shortcut = "Ctrl+Alt+Q"
    window.dictationTest.history()
  })
  await expect(shortcut).toHaveValue("Ctrl+Alt+Q")
  await shortcut.fill("Ctrl+Alt+P")
  await page.evaluate(() => { window.dictationTest.failSave = true })
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(page.getByText("Settings save failed", { exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.dictationTest.snapshot.settings.language = "en"
    window.dictationTest.history()
  })
  await settle(page)
  await expect(shortcut).toHaveValue("Ctrl+Alt+P")
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible()
})

test("history replies preserve newer recording events and still update history", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled()
  await page.evaluate(() => {
    const state = window.dictationTest
    state.snapshot.history = [{ id: "new", createdAt: new Date().toISOString(), durationMs: 1000, rawTranscript: "Fresh history entry", finalTranscript: "Fresh history entry", speechModel: "tiny", language: "en", audioPath: "" }]
    state.deferSnapshots = true
    state.history()
    state.status("recording")
  })
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled()
  await page.evaluate(() => window.dictationTest.pendingSnapshots[0]())
  await expect(page.getByText("Fresh history entry", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled()
})

test("out-of-order replies cannot replace the newest snapshot", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled()
  await page.evaluate(() => {
    const state = window.dictationTest
    state.deferSnapshots = true
    state.history()
    state.snapshot.status = { ...state.snapshot.status, phase: "recording", startedAt: Date.now() } as Status
    state.history()
    state.pendingSnapshots[1]()
  })
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled()
  await page.evaluate(() => window.dictationTest.pendingSnapshots[0]())
  await settle(page)
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeEnabled()
})

test("action refresh replies preserve status events received while awaiting them", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled()
  await page.evaluate(() => { window.dictationTest.deferSnapshots = true })
  await page.getByRole("button", { name: "Start recording" }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingSnapshots.length)).toBe(1)
  await page.evaluate(() => {
    window.dictationTest.status("transcribing")
    window.dictationTest.pendingSnapshots[0]()
  })
  await settle(page)
  await expect(page.getByRole("heading", { name: "Transcribing…", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Start recording" })).toBeDisabled()
})

test("vocabulary drafts survive refresh and failed saves, normalize and persist", async ({ page }) => {
  await page.goto("/#/vocabulary")
  await page.getByRole("button", { name: "Add term", exact: true }).click()
  await page.getByLabel("Preferred spelling", { exact: true }).fill(" PostgreSQL ")
  await page.getByLabel("Aliases (comma-separated)").fill("postgres, post gre SQL")
  await page.evaluate(() => { window.dictationTest.history(); window.dictationTest.failSave = true })
  await settle(page)
  await page.getByRole("button", { name: "Save vocabulary" }).click()
  await expect(page.getByText("Vocabulary save failed", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveValue(" PostgreSQL ")
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await page.getByRole("button", { name: "Save vocabulary" }).click()
  await expect(page.getByLabel("Preferred spelling", { exact: true })).toHaveValue("PostgreSQL")
  await expect(page.getByRole("button", { name: "Save vocabulary" })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].aliases.join("|"))).toBe("postgres|post gre SQL")
  await page.getByRole("checkbox", { name: "Enabled", exact: true }).uncheck()
  await page.getByRole("button", { name: "Save vocabulary" }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary[0].enabled)).toBe(false)
  await page.getByRole("button", { name: "Remove PostgreSQL" }).click()
  await page.getByRole("button", { name: "Save vocabulary" }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length)).toBe(0)
})

test("light cleanup defaults off and applies only after settings save", async ({ page }) => {
  await page.goto("/#/settings")
  const cleanup = page.getByRole("checkbox", { name: /Light cleanup/ })
  await expect(cleanup).not.toBeChecked()
  await cleanup.check()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText)).toBe(false)
  await page.evaluate(() => window.dictationTest.history())
  await settle(page)
  await expect(cleanup).toBeChecked()
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.cleanText)).toBe(true)
})

test("first run guides installation, mic testing and shortcut verification", async ({ page }) => {
  await page.addInitScript(() => {
    const s = window.dictationTest.snapshot
    s.settings.setupComplete = false
    s.settings.modelPath = ""
    s.ready = false
    s.models = [{ id: "base", name: "Whisper Base", description: "Everyday dictation", size: 147000000, path: "/base", installed: false }]
  })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Set up Yap" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Download & use" }).click()
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled()
  await page.evaluate(() => {
    window.dictationTest.snapshot.ready = true
    window.dictationTest.snapshot.models[0].installed = true
    window.dictationTest.status("idle")
    window.dictationTest.history()
  })
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled()
  await page.getByRole("combobox", { name: "Microphone", exact: true }).click()
  await page.getByRole("option", { name: "USB microphone", exact: true }).click()
  await page.getByRole("button", { name: "Test microphone", exact: true }).click()
  await expect(page.getByRole("meter", { name: "Microphone level" })).toHaveAttribute("value", "0.6")
  await expect(page.getByRole("button", { name: "Skip setup" })).toBeDisabled()
  await page.getByRole("button", { name: "Stop test", exact: true }).click()
  await expect(page.getByText("Microphone test passed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(page.getByRole("button", { name: "Finish setup" })).toBeDisabled()
  await page.evaluate(() => { window.dictationTest.snapshot.shortcutTested = true; window.dictationTest.callbacks["setup:changed"]() })
  await expect(page.getByText("Shortcut test passed", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Finish setup" }).click()
  await expect(page.getByRole("heading", { name: "Dictate", exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(0)
  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await page.getByRole("button", { name: "Run setup" }).click()
  await expect(page.getByRole("heading", { name: "Set up Yap" })).toBeVisible()
  await page.getByRole("button", { name: "Skip setup" }).click()
  await expect(page.getByRole("heading", { name: "Dictate", exact: true })).toBeVisible()
})

test("history uses processed text for copy and exposes searchable originals", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = [{ id: "clean", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "um, send postgres", finalTranscript: "Send PostgreSQL.", speechModel: "base", language: "en", audioPath: "" }]
  })
  await page.goto("/#/history")
  await page.getByLabel("Search transcripts").fill("um,")
  await page.getByRole("button", { name: /Send PostgreSQL/ }).click()
  await page.getByText("Original transcript", { exact: true }).click()
  await expect(page.getByText("um, send postgres", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Copy", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("Send PostgreSQL.")
})

test("microphone test remains stoppable after navigating away from setup", async ({ page }) => {
  await page.addInitScript(() => { window.dictationTest.snapshot.settings.setupComplete = false })
  await page.goto("/")
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("button", { name: "Test microphone", exact: true }).click()
  await page.getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("button", { name: "Save settings", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Stop microphone test", exact: true }).click()
  await expect(page.getByRole("button", { name: "Stop microphone test", exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.microphoneTested)).toBe(true)
})

test("diagnostics show microphone activity and an isolated transcript preview", async ({ page }) => {
  await page.goto("/#/settings")
  await expect(page.getByText("Executable found", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Test dictation", exact: true }).click()
  await expect(page.getByRole("meter", { name: "Dictation test microphone level" })).toHaveAttribute("value", "0.6")
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Stop dictation test", exact: true }).click()
  await expect(page.getByRole("button", { name: "Transcribing test…", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Cancel test", exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const state = window.dictationTest
    state.snapshot.diagnostic = { phase: "done", message: "Runtime and model verified", details: "", transcript: "A short test sentence.", durationMs: 2000 }
    state.status("idle")
    state.callbacks["setup:changed"]()
  })
  await expect(page.getByText("Runtime and model verified", { exact: true })).toBeVisible()
  await expect(page.getByText("A short test sentence.", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Global shortcut", { exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("")
})

test("diagnostics block unsaved settings and unavailable files until refreshed", async ({ page }) => {
  await page.goto("/#/settings")
  const testDictation = page.getByRole("button", { name: "Test dictation", exact: true })
  await expect(testDictation).toBeEnabled()
  await page.getByLabel("Global shortcut", { exact: true }).fill("Ctrl+Alt+P")
  await expect(testDictation).toBeDisabled()
  await expect(page.getByText("Save settings before testing the changes.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(testDictation).toBeEnabled()
  await page.evaluate(() => { window.dictationTest.checks[1] = { id: "model", name: "Speech model", ready: false, message: "Speech model is empty; download it again in Models." } })
  await page.getByRole("button", { name: "Refresh diagnostics" }).click()
  await expect(page.getByText("Speech model is empty; download it again in Models.", { exact: true })).toBeVisible()
  await expect(testDictation).toBeDisabled()
  await page.evaluate(() => { window.dictationTest.checks[1] = { id: "model", name: "Speech model", ready: true, message: "Model file readable" } })
  await page.getByRole("button", { name: "Refresh diagnostics" }).click()
  await expect(testDictation).toBeEnabled()
})

test("diagnostic errors include recovery guidance and expandable details", async ({ page }) => {
  await page.goto("/#/settings")
  await page.getByRole("button", { name: "Test dictation", exact: true }).click()
  await page.getByRole("button", { name: "Stop dictation test", exact: true }).click()
  await page.evaluate(() => {
    const state = window.dictationTest
    state.snapshot.diagnostic = { phase: "error", message: "Transcription failed. Reinstall the model in Models.", details: "Whisper could not load model: invalid header", transcript: "", durationMs: 0 }
    state.status("idle")
    state.callbacks["setup:changed"]()
  })
  await expect(page.getByRole("alert").filter({ hasText: "Reinstall the model" })).toBeVisible()
  await page.getByText("Technical details", { exact: true }).click()
  await expect(page.getByText("Whisper could not load model: invalid header", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Test dictation", exact: true }).click()
  await expect(page.getByText("Whisper could not load model: invalid header", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Cancel test", exact: true }).click()
  await expect(page.getByText("Test cancelled", { exact: true })).toBeVisible()
})

test("test capture and transcription remain cancellable across navigation", async ({ page }) => {
  await page.goto("/#/settings")
  await page.getByRole("button", { name: "Test dictation", exact: true }).click()
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Models", exact: true }).click()
  await page.getByRole("button", { name: "Stop test recording", exact: true }).click()
  await expect(page.getByText("Transcribing test…", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings", exact: true }).click()
  await expect(page.getByText("Test cancelled", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Test dictation", exact: true })).toBeEnabled()
})

test("saved transcript edits drive display, search, copy and export while keeping originals", async ({ page }) => {
  await page.addInitScript(() => { window.dictationTest.snapshot.history = [{ id: "edit", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "um, send postgres", finalTranscript: "Send PostgreSQL.", speechModel: "base", language: "en", audioPath: "" }] })
  await page.goto("/#/history")
  await page.getByRole("button", { name: /Send PostgreSQL/ }).click()
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Edit transcript" })
  const input = dialog.getByLabel("Transcript", { exact: true })
  await expect(input).toHaveValue("Send PostgreSQL.")
  await expect(input).toBeFocused()
  await expect(dialog.getByRole("button", { name: "Save transcript" })).toBeDisabled()
  await input.fill("Send PostgreSQL to Benji.\nThanks!")
  await dialog.getByRole("button", { name: "Save transcript" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText("Send PostgreSQL to Benji.\nThanks!", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Copy", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("Send PostgreSQL to Benji.\nThanks!")
  await page.getByRole("button", { name: "Export text", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.exportedText)).toBe("Send PostgreSQL to Benji.\nThanks!")
  await page.getByLabel("Search transcripts").fill("Benji")
  await expect(page.getByText("Send PostgreSQL to Benji.\nThanks!", { exact: true })).toBeVisible()
  await page.getByLabel("Search transcripts").fill("um,")
  await page.getByText("Original transcript", { exact: true }).click()
  await expect(page.getByText("um, send postgres", { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe("um, send postgres")
})

test("editor retains its draft across refresh and failed saves, then saves with keyboard shortcut", async ({ page }) => {
  await page.addInitScript(() => { window.dictationTest.snapshot.history = [{ id: "edit", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "Original plain transcript.", finalTranscript: "Original plain transcript.", speechModel: "base", language: "en", audioPath: "" }] })
  await page.goto("/#/history")
  await page.getByRole("button", { name: /Original plain transcript/ }).click()
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Edit transcript" })
  const input = dialog.getByLabel("Transcript", { exact: true })
  await input.fill("My correction.")
  await page.evaluate(() => { window.dictationTest.failSave = true; window.dictationTest.history() })
  await settle(page)
  await expect(input).toHaveValue("My correction.")
  await dialog.getByRole("button", { name: "Save transcript" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Transcript save failed")
  await expect(input).toHaveValue("My correction.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("Original plain transcript.")
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await input.press("Control+Enter")
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText("My correction.", { exact: true })).toBeVisible()
})

test("cancel and Escape discard edits, empty edits cannot be saved, and outside clicks keep the draft", async ({ page }) => {
  await page.addInitScript(() => { window.dictationTest.snapshot.history = [{ id: "edit", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "Original plain transcript.", finalTranscript: "Original plain transcript.", speechModel: "base", language: "en", audioPath: "" }] })
  await page.goto("/#/history")
  await page.getByRole("button", { name: /Original plain transcript/ }).click()
  const edit = page.getByRole("button", { name: "Edit transcript", exact: true })
  await edit.click()
  const dialog = page.getByRole("dialog", { name: "Edit transcript" })
  const input = dialog.getByLabel("Transcript", { exact: true })
  await input.fill(" \n ")
  await expect(dialog.getByRole("button", { name: "Save transcript" })).toBeDisabled()
  await input.fill("Discard this.")
  await page.mouse.click(5, 5)
  await expect(input).toHaveValue("Discard this.")
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(edit).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("Original plain transcript.")
  await edit.click()
  await expect(input).toHaveValue("Original plain transcript.")
  await input.fill("Escape this.")
  await input.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(edit).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("Original plain transcript.")
})

test("deleted recordings fail safely without losing the editor draft", async ({ page }) => {
  await page.addInitScript(() => { window.dictationTest.snapshot.history = [{ id: "edit", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "Original plain transcript.", finalTranscript: "Original plain transcript.", speechModel: "base", language: "en", audioPath: "" }] })
  await page.goto("/#/history")
  await page.getByRole("button", { name: /Original plain transcript/ }).click()
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Edit transcript" })
  await dialog.getByLabel("Transcript", { exact: true }).fill("Keep my draft.")
  await page.evaluate(() => { window.dictationTest.snapshot.history = []; window.dictationTest.history() })
  await settle(page)
  await dialog.getByRole("button", { name: "Save transcript" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("This dictation no longer exists")
  await expect(dialog.getByLabel("Transcript", { exact: true })).toHaveValue("Keep my draft.")
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByRole("heading", { name: "No dictations yet", exact: true })).toBeVisible()
})

async function openCorrectionEditor(page: Page) {
  await page.addInitScript(() => { window.dictationTest.snapshot.history = [{ id: "correction", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "postgres connection ready.", finalTranscript: "postgres connection ready.", speechModel: "base", language: "en", audioPath: "" }] })
  await page.goto("/#/history")
  await page.getByRole("button", { name: /postgres connection ready/ }).click()
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click()
  const input = page.getByLabel("Transcript", { exact: true })
  await input.fill("PostgreSQL connection ready.")
  return input
}

test("a selected correction adds a confirmed term without saving the transcript draft", async ({ page }) => {
  const input = await openCorrectionEditor(page)
  const add = page.getByRole("button", { name: "Add to vocabulary", exact: true })
  await expect(add).toBeDisabled()
  await input.press("Home")
  await input.press("Control+Shift+ArrowRight")
  await expect(add).toBeEnabled()
  await add.click()
  const term = page.getByRole("dialog", { name: "Add to vocabulary", exact: true })
  await expect(term.getByLabel("Preferred spelling", { exact: true })).toHaveValue("PostgreSQL")
  await expect(term.getByLabel("Preferred spelling", { exact: true })).toBeFocused()
  await term.getByLabel("Aliases (comma-separated)").fill("postgres, post gre SQL")
  // A newer saved vocabulary must survive even if the editor's snapshot is older.
  await page.evaluate(() => { window.dictationTest.snapshot.vocabulary.push({ id: "newer", canonical: "SQLite", aliases: [], enabled: false }) })
  await term.getByRole("button", { name: "Save term", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "Edit transcript" })).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "Added to vocabulary" })).toBeVisible()
  await expect(input).toHaveValue("PostgreSQL connection ready.")
  await expect(input).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.map(entry => ({ ...entry, id: "" })))).toEqual([
    { id: "", canonical: "SQLite", aliases: [], enabled: false },
    { id: "", canonical: "PostgreSQL", aliases: ["postgres", "post gre SQL"], enabled: true },
  ])
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("postgres connection ready.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("")
  await input.press("Control+Enter")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("PostgreSQL connection ready.")
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Vocabulary", exact: true }).click()
  await expect(page.getByLabel("Preferred spelling", { exact: true }).last()).toHaveValue("PostgreSQL")
})

test("term save failures and conflicts preserve both drafts for retry", async ({ page }) => {
  const input = await openCorrectionEditor(page)
  await input.press("Home")
  await input.press("Control+Shift+ArrowRight")
  await page.getByRole("button", { name: "Add to vocabulary", exact: true }).click()
  const term = page.getByRole("dialog", { name: "Add to vocabulary" })
  const aliases = term.getByLabel("Aliases (comma-separated)")
  await aliases.fill("postgres")
  await page.evaluate(() => { window.dictationTest.failSave = true; window.dictationTest.history() })
  await term.getByRole("button", { name: "Save term", exact: true }).click()
  await expect(term.getByRole("alert")).toHaveText("Vocabulary save failed")
  await expect(aliases).toHaveValue("postgres")
  await page.evaluate(() => {
    window.dictationTest.failSave = false
    window.dictationTest.snapshot.vocabulary = [{ id: "taken", canonical: "Other", aliases: ["postgres"], enabled: true }]
  })
  await aliases.press("Control+Enter")
  await expect(term.getByRole("alert")).toHaveText('"postgres" is already assigned to another vocabulary term')
  await aliases.fill("post gre SQL")
  await aliases.press("Enter")
  await expect(input).toHaveValue("PostgreSQL connection ready.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length)).toBe(2)
})

test("Cancel and Escape return from vocabulary confirmation without losing edits", async ({ page }) => {
  const input = await openCorrectionEditor(page)
  for (const cancelWithEscape of [false, true]) {
    await input.press("Home")
    await input.press("Control+Shift+ArrowRight")
    await page.getByRole("button", { name: "Add to vocabulary", exact: true }).click()
    const term = page.getByRole("dialog", { name: "Add to vocabulary" })
    await term.getByLabel("Preferred spelling", { exact: true }).fill("Discarded")
    await page.mouse.click(5, 5)
    await expect(term).toBeVisible()
    if (cancelWithEscape) await term.getByLabel("Preferred spelling", { exact: true }).press("Escape")
    else await term.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(input).toHaveValue("PostgreSQL connection ready.")
    await expect(input).toBeFocused()
  }
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.vocabulary.length)).toBe(0)
  await input.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("postgres connection ready.")
})

test("vocabulary selection rejects multiline or oversized terms and respects active recording", async ({ page }) => {
  const input = await openCorrectionEditor(page)
  const add = page.getByRole("button", { name: "Add to vocabulary", exact: true })
  await input.fill("a".repeat(81))
  await input.press("Control+A")
  await expect(add).toBeDisabled()
  await input.fill("Two\nlines")
  await input.press("Control+A")
  await expect(add).toBeDisabled()
  await input.fill("PostgreSQL")
  await input.press("Control+A")
  await expect(add).toBeEnabled()
  await add.click()
  const term = page.getByRole("dialog", { name: "Add to vocabulary" })
  await term.getByLabel("Preferred spelling", { exact: true }).fill(" ")
  await expect(term.getByRole("button", { name: "Save term", exact: true })).toBeDisabled()
  await term.getByLabel("Preferred spelling", { exact: true }).fill("PostgreSQL")
  await page.evaluate(() => { window.dictationTest.status("recording") })
  await expect(term.getByRole("button", { name: "Save term", exact: true })).toBeDisabled()
  await expect(term.getByText("Finish the current operation before adding a term.", { exact: true })).toBeVisible()
  await page.evaluate(() => { window.dictationTest.status("idle") })
  await term.getByRole("button", { name: "Save term", exact: true }).click()
  await expect(input).toHaveValue("PostgreSQL")
})
