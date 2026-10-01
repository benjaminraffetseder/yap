import { expect, test, type Page } from "@playwright/test"
import type { DiagnosticCheck, Settings, Snapshot, Status, VocabularyEntry, TextProcessing } from "../src/lib/backend"

declare global {
  interface Window {
    dictationTest: {
      snapshot: Snapshot
      callbacks: Record<string, (...args: unknown[]) => void>
      deferSnapshots: boolean
      pendingSnapshots: (() => void)[]
      deferHistory: boolean
      pendingHistory: { query: string; resolve: () => void }[]
      failHistory: boolean
      failSave: boolean
      captureToken: string
      captureEnded: number
      failCapture: boolean
      failRestore: boolean
      deferCapture: boolean
      resolveCapture: (() => void) | null
      occupiedShortcut: string
      processing: { id: string; input: string; prompt: string; resolve: (result: string) => void; reject: (error: Error) => void } | null
      failProcessing: boolean
      cancelledProcessing: string[]
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
        textProcessing: { enabled: false, endpoint: "http://127.0.0.1:11434/v1", model: "", autoPromptId: "", prompts: [{ id: "cleanup", name: "Cleanup", instruction: "Clean up text." }, { id: "summary", name: "Summary", instruction: "Summarize text." }] },
        settings: { microphoneId: "", whisperPath: "/whisper", modelPath: "/model", language: "auto", shortcut: "Ctrl+Alt+Space", interaction: "hold", autoPaste: true, saveAudio: false, launchAtLogin: false, startInTray: false, cleanText: false, setupComplete: true, historyRetentionDays: 0 },
        status: { phase: "idle", message: "Ready", startedAt: 0, transcript: "", progress: 0, shortcutError: "", indicatorError: "", trayError: "", startupError: "", historyError: "" },
        models: [], history: [], ready: true, dataDir: "", floatingIndicator: true, launchAtLoginAvailable: true, startInTrayAvailable: true, vocabulary: [], microphoneTested: false, shortcutTested: false, diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
      },
      callbacks: {}, deferSnapshots: false, pendingSnapshots: [], deferHistory: false, pendingHistory: [], failHistory: false, captureToken: "", captureEnded: 0, failCapture: false, failRestore: false, deferCapture: false, resolveCapture: null, occupiedShortcut: "", failSave: false, exportedText: "", checks: [{ id: "runtime", name: "Whisper runtime", ready: true, message: "Executable found" }, { id: "model", name: "Speech model", ready: true, message: "Model file readable" }, { id: "microphone", name: "Microphone", ready: true, message: "System default" }],
      status(phase: string) {
        state.snapshot.status = { ...state.snapshot.status, phase, message: phase === "transcribing" ? "Transcribing…" : "Ready", startedAt: Date.now() }
        state.callbacks["dictation:status"](structuredClone(state.snapshot.status))
      },
      processing: null, failProcessing: false, cancelledProcessing: [],
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
        GetHistory: async (query: string, page: number) => {
          if (state.failHistory) throw new Error("History load failed")
          const entries = state.snapshot.history.filter(entry => [entry.rawTranscript, entry.finalTranscript].some(text => text.toLowerCase().includes(query.toLowerCase())))
          const result = { entries: structuredClone(entries.slice(page * 50, (page + 1) * 50)), total: entries.length, page, pageSize: 50 }
          if (state.deferHistory) return new Promise(resolve => { state.pendingHistory.push({ query, resolve: () => resolve(result) }) })
          return result
        },
        DeleteSessions: async (ids: string[]) => {
          if (state.failSave) throw new Error("History deletion failed")
          state.snapshot.history = state.snapshot.history.filter(entry => !ids.includes(entry.id))
          state.history()
        },
        ExportSessions: async (ids: string[]) => { state.exportedText = state.snapshot.history.filter(entry => ids.includes(entry.id)).map(entry => entry.finalTranscript).join("\n") },
        RemoveModel: async (id: string) => {
          if (state.failSave) throw new Error("Model removal failed")
          const model = state.snapshot.models.find(model => model.id === id)!
          if (model.path === state.snapshot.settings.modelPath) throw new Error("switch to another model before removing the active model")
          model.installed = false; model.removable = false; model.diskBytes = 0; model.path = ""
          state.history()
        },
        GetMicrophones: async () => [{ id: "usb", name: "USB microphone" }],
        GetDiagnosticChecks: async () => structuredClone(state.checks),
        StartDiagnosticTest: async () => { state.snapshot.diagnostic = { phase: "recording", message: "Say a short sentence", details: "", transcript: "", durationMs: 0 }; state.status("diagnostic-recording"); state.callbacks["dictation:level"](.6) },
        StopDiagnosticTest: async () => { state.snapshot.diagnostic.phase = "transcribing"; state.snapshot.diagnostic.message = "Transcribing test…"; state.status("diagnostic-transcribing") },
        SaveSettings: async (settings: Settings) => {
          if (state.failSave) throw new Error("Settings save failed")
          if (settings.shortcut === state.occupiedShortcut) throw new Error("shortcut could not be registered: already in use; choose another combination; your saved shortcut is unchanged")
          if (settings.microphoneId !== state.snapshot.settings.microphoneId) state.snapshot.microphoneTested = false
          if (settings.shortcut !== state.snapshot.settings.shortcut) state.snapshot.shortcutTested = false
          state.snapshot.settings = structuredClone(settings)
          if (settings.historyRetentionDays > 0) {
            const cutoff = Date.now() - settings.historyRetentionDays * 86400000
            state.snapshot.history = state.snapshot.history.filter(entry => !(Date.parse(entry.createdAt) < cutoff))
            state.history()
          }
        },
        BeginShortcutCapture: async () => {
          if (state.failCapture) throw new Error("Could not start shortcut capture")
          if (state.captureToken) throw new Error("finish the current operation before recording a shortcut")
          const token = crypto.randomUUID()
          state.captureToken = token
          if (state.deferCapture) return new Promise(resolve => { state.resolveCapture = () => resolve(token) })
          return token
        },
        EndShortcutCapture: async (token: string) => {
          if (token !== state.captureToken) return
          state.captureToken = ""; state.captureEnded++
          state.callbacks["shortcut:capture-ended"]?.(token)
          if (state.failRestore) throw new Error("could not restore the saved shortcut; choose another combination and save settings")
        },
        SaveVocabulary: async (entries: VocabularyEntry[]) => {
          if (state.failSave) throw new Error("Vocabulary save failed")
          state.snapshot.vocabulary = structuredClone(entries.map(entry => ({ ...entry, canonical: entry.canonical.trim() })))
          return structuredClone(state.snapshot.vocabulary)
        },
        SaveTextProcessing: async (config: TextProcessing) => {
          if (state.failSave) throw new Error("Prompts save failed")
          state.snapshot.textProcessing = structuredClone(config)
          state.callbacks["setup:changed"]()
          return structuredClone(config)
        },
        ProcessText: async (id: string, input: string, prompt: string) => {
          if (state.failProcessing) throw new Error("Model unavailable")
          return new Promise<string>((resolve, reject) => { state.processing = { id, input, prompt, resolve: result => { state.processing = null; resolve(result) }, reject } })
        },
        CancelTextProcessing: async (id: string) => {
          state.cancelledProcessing.push(id)
          // Deliberately leave the reply pending to exercise late results.
        },
        TestTextModel: async () => { if (state.failProcessing) throw new Error("Model unavailable"); return "OK" },
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
    s.models = [{ id: "base", name: "Whisper Base", description: "Everyday dictation", size: 147000000, path: "/base", installed: false, diskBytes: 0, removable: false }]
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

test("History pages select and export only the current page, and recover after deleting its last entries", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 52 }, (_, i) => ({ id: `row-${i}`, createdAt: "2026-10-07", durationMs: 1000, rawTranscript: `Original ${i}`, finalTranscript: `Dictation ${i}`, speechModel: "base", language: "en", audioPath: "" }))
  })
  await page.goto("/#/history")
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible()
  await page.getByRole("checkbox", { name: "Select page", exact: true }).check()
  await expect(page.getByText("50 selected", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible()
  await expect(page.getByText("50 selected", { exact: true })).toHaveCount(0)
  await page.getByRole("checkbox", { name: "Select page", exact: true }).check()
  await page.getByRole("button", { name: "Export selected", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.exportedText)).toBe("Dictation 50\nDictation 51")
  await page.getByRole("button", { name: "Delete selected", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Delete 2 dictations?" })
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(52)
  await page.getByRole("button", { name: "Delete selected", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Delete 2 dictations?" })
  await page.evaluate(() => { window.dictationTest.failSave = true })
  await dialog.getByRole("button", { name: "Delete dictations", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText("History deletion failed")
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await dialog.getByRole("button", { name: "Delete dictations", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(50)
  await expect(page.getByText("50 dictations", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Dictation 0\b/ })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "History pages" })).toHaveCount(0)
})

test("History searches all entries beyond 500 and ignores older search replies", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.history = Array.from({ length: 501 }, (_, i) => ({ id: `row-${i}`, createdAt: "2026-10-07", durationMs: 1000, rawTranscript: i === 500 ? "Älterer Name" : "alpha", finalTranscript: i === 500 ? "beta correction" : "alpha", speechModel: "base", language: "en", audioPath: "" }))
  })
  await page.goto("/#/history")
  await expect(page.getByText("501 dictations", { exact: true })).toBeVisible()
  const search = page.getByLabel("Search transcripts")
  await search.fill("ÄLTERER")
  await expect(page.getByRole("button", { name: /beta correction/ })).toBeVisible()
  await page.evaluate(() => { window.dictationTest.deferHistory = true })
  await search.fill("alpha")
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(1)
  await search.fill("beta")
  await expect.poll(() => page.evaluate(() => window.dictationTest.pendingHistory.length)).toBe(2)
  await page.evaluate(() => { window.dictationTest.pendingHistory[1].resolve() })
  await expect(page.getByText("1 dictation", { exact: true })).toBeVisible()
  await page.evaluate(() => { window.dictationTest.pendingHistory[0].resolve() })
  await settle(page)
  await expect(page.getByRole("button", { name: /beta correction/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /^alpha/ })).toHaveCount(0)
  await page.evaluate(() => { window.dictationTest.deferHistory = false; window.dictationTest.failHistory = true })
  await search.fill("missing")
  await expect(page.getByRole("alert").filter({ hasText: "History load failed" })).toBeVisible()
  await expect(page.getByRole("checkbox", { name: "Select page", exact: true })).toBeDisabled()
  await page.evaluate(() => { window.dictationTest.failHistory = false })
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page.getByRole("heading", { name: "No matching transcripts", exact: true })).toBeVisible()
})

test("retention defaults to forever and requires confirmation before saving or deleting", async ({ page }) => {
  await page.addInitScript(() => { window.dictationTest.snapshot.history = [{ id: "old", createdAt: "2000-01-01T00:00:00Z", durationMs: 1000, rawTranscript: "Old", finalTranscript: "Edited old", speechModel: "base", language: "en", audioPath: "/audio.wav" }] })
  await page.goto("/#/settings")
  const retention = page.getByLabel("History retention", { exact: true })
  await expect(retention).toHaveValue("0")
  await retention.selectOption("30")
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Enable automatic deletion?" })
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays)).toBe(0)
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(1)
  await expect(retention).toHaveValue("30")
  await page.evaluate(() => { window.dictationTest.failSave = true })
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Enable automatic deletion?" })
  await dialog.getByRole("button", { name: "Save and delete older history", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Settings save failed" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(1)
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Save and delete older history", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays)).toBe(30)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(0)
  await retention.selectOption("0")
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.historyRetentionDays)).toBe(0)
})

test("Models shows actual disk usage and protects the active model during removal and retries", async ({ page }) => {
  await page.addInitScript(() => {
    window.dictationTest.snapshot.models = [
      { id: "base", name: "Whisper Base", description: "Balanced", size: 147000000, installed: true, path: "/model", diskBytes: 3000000, removable: true },
      { id: "tiny", name: "Whisper Tiny", description: "Fast", size: 77000000, installed: true, path: "/tiny", diskBytes: 2000000, removable: true },
    ]
  })
  await page.goto("/#/models")
  await expect(page.getByText("5 MB used by downloaded models", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Remove Whisper Base", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Remove Whisper Tiny", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Remove Whisper Tiny?" })
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(page.getByText("5 MB used by downloaded models", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Remove Whisper Tiny", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Remove Whisper Tiny?" })
  await page.evaluate(() => { window.dictationTest.status("recording") })
  await expect(dialog.getByRole("button", { name: "Remove model", exact: true })).toBeDisabled()
  await page.evaluate(() => { window.dictationTest.status("idle"); window.dictationTest.failSave = true })
  await dialog.getByRole("button", { name: "Remove model", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Model removal failed")
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await dialog.getByRole("button", { name: "Remove model", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText("3 MB used by downloaded models", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Remove Whisper Tiny", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Download & use", exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.modelPath)).toBe("/model")
})

async function recordShortcut(page: Page) {
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Record shortcut", exact: true })
  await expect(dialog.getByText("Press a key combination", { exact: true })).toBeVisible()
  return dialog
}

test("shortcut capture waits for key release, changes only the draft and preserves other settings edits", async ({ page }) => {
  await page.goto("/#/settings")
  await page.getByRole("checkbox", { name: /Keep recordings/ }).check()
  const dialog = await recordShortcut(page)
  const area = dialog.getByRole("group", { name: "Shortcut capture" })
  await expect(area).toBeFocused()
  await page.keyboard.down("Control"); await page.keyboard.down("Alt"); await page.keyboard.down("p")
  await expect(dialog.getByText("Ctrl+Alt+P", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeDisabled()
  await page.keyboard.up("p"); await page.keyboard.up("Alt"); await page.keyboard.up("Control")
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Record shortcut", exact: true })).toBeFocused()
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P")
  await page.evaluate(() => window.dictationTest.history())
  await settle(page)
  await expect(page.getByRole("checkbox", { name: /Keep recordings/ })).toBeChecked()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe("Ctrl+Alt+Space")
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("")
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureEnded)).toBe(1)
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe("Ctrl+Alt+P")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history.length)).toBe(0)
})

test("recorder accepts the existing Space shortcut and function keys without starting dictation", async ({ page }) => {
  await page.goto("/#/settings")
  let dialog = await recordShortcut(page)
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+Space")
  await expect(dialog.getByText("Ctrl+Alt+Space", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.phase)).toBe("idle")
  dialog = await recordShortcut(page)
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Shift+F12")
  await expect(dialog.getByText("Ctrl+Shift+F12", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click()
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Shift+F12")
})

test("recorder rejects unsupported keys and modifiers, ignores repeat, and leaves Tab accessible", async ({ page }) => {
  await page.goto("/#/settings")
  const dialog = await recordShortcut(page)
  const area = dialog.getByRole("group", { name: "Shortcut capture" })
  await area.press("a")
  await expect(dialog.getByRole("alert")).toHaveText("Include at least one modifier: Ctrl, Alt, or Shift.")
  await area.press("Control+1")
  await expect(dialog.getByRole("alert")).toHaveText("Use Space, A–Z, or F1–F12.")
  await area.press("Meta+a")
  await expect(dialog.getByRole("alert")).toHaveText("Use Ctrl, Alt, or Shift. Command, Windows, and AltGr are not supported.")
  await area.dispatchEvent("keydown", { key: "Process", code: "KeyA", ctrlKey: true, isComposing: true })
  await expect(dialog.getByRole("alert")).toHaveText("Finish composing text, then press a shortcut.")
  await area.dispatchEvent("keyup", { key: "Process", code: "KeyA" })
  await area.evaluate(element => {
    const event = new KeyboardEvent("keydown", { key: "x", code: "KeyX", ctrlKey: true, altKey: true, bubbles: true })
    Object.defineProperty(event, "getModifierState", { value: (name: string) => name === "AltGraph" })
    element.dispatchEvent(event)
  })
  await expect(dialog.getByRole("alert")).toHaveText("Use Ctrl, Alt, or Shift. Command, Windows, and AltGr are not supported.")
  await area.dispatchEvent("keyup", { key: "x", code: "KeyX" })
  await area.press("Control+Alt+p")
  await area.dispatchEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true, repeat: true })
  await expect(dialog.getByText("Ctrl+Alt+P", { exact: true })).toBeVisible()
  await area.press("Tab")
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Enter")
  await expect(dialog).toHaveCount(0)
})

test("Cancel, Escape and focus loss restore the saved shortcut and discard the candidate", async ({ page }) => {
  await page.goto("/#/settings")
  for (const action of ["cancel", "escape", "blur"]) {
    const dialog = await recordShortcut(page)
    await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+p")
    if (action === "cancel") await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    else if (action === "escape") await dialog.getByRole("group", { name: "Shortcut capture" }).press("Escape")
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")))
    await expect(dialog).toHaveCount(0)
    await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+Space")
    await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("")
  }
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureEnded)).toBe(3)
})

test("late capture replies and backend timeout cannot leave the shortcut suspended", async ({ page }) => {
  await page.goto("/#/settings")
  await page.evaluate(() => { window.dictationTest.deferCapture = true })
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Record shortcut", exact: true })
  await expect.poll(() => page.evaluate(() => !!window.dictationTest.resolveCapture)).toBe(true)
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(() => { window.dictationTest.resolveCapture!(); window.dictationTest.deferCapture = false })
  await expect.poll(() => page.evaluate(() => window.dictationTest.captureToken)).toBe("")
  dialog = await recordShortcut(page)
  await page.evaluate(() => {
    const state = window.dictationTest
    const token = state.captureToken
    state.captureToken = ""
    state.callbacks["shortcut:capture-ended"](token)
  })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole("alert").filter({ hasText: "Shortcut capture timed out" })).toBeVisible()
})

test("recorder reports start and restoration failures, and save conflicts keep the draft", async ({ page }) => {
  await page.goto("/#/settings")
  await page.evaluate(() => { window.dictationTest.failCapture = true })
  await page.getByRole("button", { name: "Record shortcut", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Record shortcut", exact: true })
  await expect(dialog.getByRole("alert")).toHaveText("Could not start shortcut capture")
  await expect(dialog.getByRole("button", { name: "Use shortcut", exact: true })).toBeDisabled()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.evaluate(() => { window.dictationTest.failCapture = false; window.dictationTest.failRestore = true })
  dialog = await recordShortcut(page)
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Control+Alt+p")
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "could not restore the saved shortcut" })).toBeVisible()
  await page.evaluate(() => { window.dictationTest.failRestore = false; window.dictationTest.occupiedShortcut = "Ctrl+Alt+P" })
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "your saved shortcut is unchanged" })).toBeVisible()
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Ctrl+Alt+P")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe("Ctrl+Alt+Space")
  await page.evaluate(() => { window.dictationTest.occupiedShortcut = "" })
  await page.getByRole("button", { name: "Save settings", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe("Ctrl+Alt+P")
})

test("shortcut recorder is disabled during active work and works in first-run setup", async ({ page }) => {
  await page.goto("/#/settings")
  for (const phase of ["recording", "transcribing", "downloading", "mic-test", "diagnostic-recording", "diagnostic-transcribing"]) {
    await page.evaluate(phase => window.dictationTest.status(phase), phase)
    await expect(page.getByRole("button", { name: "Record shortcut", exact: true })).toBeDisabled()
  }
  await page.evaluate(() => { const state = window.dictationTest; state.status("idle"); state.snapshot.settings.setupComplete = false; state.snapshot.microphoneTested = true; state.callbacks["setup:changed"]() })
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Dictate", exact: true }).click()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  const dialog = await recordShortcut(page)
  await dialog.getByRole("group", { name: "Shortcut capture" }).press("Shift+F8")
  await dialog.getByRole("button", { name: "Use shortcut", exact: true }).click()
  await expect(page.getByLabel("Global shortcut", { exact: true })).toHaveValue("Shift+F8")
  await page.getByRole("button", { name: "Apply shortcut", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.settings.shortcut)).toBe("Shift+F8")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.phase)).toBe("idle")
})


test("prompt drafts survive refresh and failed save; model testing uses saved config", async ({ page }, testInfo) => {
  await page.goto("/#/prompts")
  await page.getByRole("checkbox", { name: "Enable LLM processing" }).check()
  await page.getByLabel("Model identifier").fill("my-local-model")
  await page.getByLabel("Local server URL").fill("http://127.0.0.1:1234/v1")
  await page.getByRole("button", { name: "Add prompt" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Technical ticket")
  await page.getByLabel("Instructions").fill("Format the transcript as a bug report. Keep names unchanged.")
  await page.getByLabel("After dictation").selectOption({ label: "Technical ticket" })
  await expect(page.getByRole("button", { name: "Test model", exact: true })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.enabled)).toBe(false)
  await page.evaluate(() => { window.dictationTest.history(); window.dictationTest.failSave = true })
  await settle(page)
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Technical ticket")
  await page.getByRole("button", { name: "Save prompts", exact: true }).click()
  await expect(page.getByText("Prompts save failed", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Model identifier")).toHaveValue("my-local-model")
  await page.evaluate(() => { window.dictationTest.failSave = false })
  await page.getByRole("button", { name: "Save prompts", exact: true }).click()
  await expect(page.getByRole("button", { name: "Save prompts", exact: true })).toBeDisabled()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.prompts.length)).toBe(3)
  await page.getByRole("button", { name: "Test model", exact: true }).click()
  await expect(page.getByText("Model responded successfully.", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("prompts.png"), fullPage: true })
  await page.getByRole("button", { name: "Delete prompt", exact: true }).click()
  await expect(page.getByLabel("After dictation")).toHaveValue("")
  await page.getByRole("checkbox", { name: "Enable LLM processing" }).uncheck()
  await page.getByRole("button", { name: "Save prompts", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.textProcessing.enabled)).toBe(false)
  await expect(page.getByLabel("After dictation")).toBeDisabled()
})

async function openPromptEditor(page: Page) {
  await page.addInitScript(() => {
    const state = window.dictationTest
    state.snapshot.textProcessing.enabled = true
    state.snapshot.textProcessing.model = "custom-model"
    state.snapshot.history = [{ id: "prompt", createdAt: "2026-10-07", durationMs: 1000, rawTranscript: "Original speech.", finalTranscript: "Saved correction.", speechModel: "base", language: "en", audioPath: "" }]
  })
  await page.goto("/#/history")
  await page.getByRole("button", { name: /Saved correction/ }).click()
  await page.getByRole("button", { name: "Edit transcript", exact: true }).click()
  await page.getByLabel("Transcript", { exact: true }).fill("Unsaved draft for summary.")
  await page.getByRole("button", { name: "Process text", exact: true }).click()
}

test("prompt previews use the draft and change History only after apply and save", async ({ page }, testInfo) => {
  await openPromptEditor(page)
  await page.getByLabel("Prompt", { exact: true }).selectOption("summary")
  await page.getByRole("button", { name: "Generate preview", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.processing?.input)).toBe("Unsaved draft for summary.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.processing?.prompt)).toBe("summary")
  await page.evaluate(() => window.dictationTest.processing!.resolve("Concise summary."))
  await expect(page.getByLabel("Preview", { exact: true })).toHaveValue("Concise summary.")
  await page.screenshot({ path: testInfo.outputPath("preview.png") })
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("Saved correction.")
  await page.getByRole("button", { name: "Use result", exact: true }).click()
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveValue("Concise summary.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.status.transcript)).toBe("")
  await page.getByRole("button", { name: "Save transcript", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].finalTranscript)).toBe("Concise summary.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.snapshot.history[0].rawTranscript)).toBe("Original speech.")
})

test("failed and cancelled generation retain the draft and suppress late results", async ({ page }) => {
  await openPromptEditor(page)
  await page.evaluate(() => { window.dictationTest.failProcessing = true })
  await page.getByRole("button", { name: "Generate preview", exact: true }).click()
  await expect(page.getByText("Model unavailable", { exact: true })).toBeVisible()
  await page.evaluate(() => { window.dictationTest.failProcessing = false })
  await page.getByRole("button", { name: "Generate preview", exact: true }).click()
  await page.getByRole("button", { name: "Cancel processing", exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length)).toBe(1)
  await page.evaluate(() => window.dictationTest.processing!.resolve("Late unwanted replacement."))
  await expect(page.getByText("Processing cancelled", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Use result", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "Back to transcript", exact: true }).click()
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveValue("Unsaved draft for summary.")
  await page.getByRole("button", { name: "Process text", exact: true }).click()
  await page.getByRole("button", { name: "Generate preview", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveValue("Unsaved draft for summary.")
  await expect.poll(() => page.evaluate(() => window.dictationTest.cancelledProcessing.length)).toBe(2)
  await page.evaluate(() => window.dictationTest.processing!.resolve("Another late reply."))
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveValue("Unsaved draft for summary.")
})
