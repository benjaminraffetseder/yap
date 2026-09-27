import { expect, test, type Page } from "@playwright/test"
import type { Settings, Snapshot, Status, VocabularyEntry } from "../src/lib/backend"

declare global {
  interface Window {
    dictationTest: {
      snapshot: Snapshot
      callbacks: Record<string, (...args: unknown[]) => void>
      deferSnapshots: boolean
      pendingSnapshots: (() => void)[]
      failSave: boolean
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
        models: [], history: [], ready: true, dataDir: "", floatingIndicator: true, launchAtLoginAvailable: true, startInTrayAvailable: true, vocabulary: [], microphoneTested: false, shortcutTested: false,
      },
      callbacks: {}, deferSnapshots: false, pendingSnapshots: [], failSave: false,
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
        StartMicrophoneTest: async () => { state.snapshot.microphoneTested = false; state.status("mic-test"); state.callbacks["dictation:level"](.6) },
        StopMicrophoneTest: async () => { state.snapshot.microphoneTested = true; state.status("idle") },
        Cancel: async () => { state.snapshot.microphoneTested = false; state.status("idle") },
        CompleteSetup: async () => { state.snapshot.settings.setupComplete = true },
        RestartSetup: async () => { state.snapshot.settings.setupComplete = false; state.snapshot.microphoneTested = false; state.snapshot.shortcutTested = false },
        InstallModel: async (id: string) => { state.status("downloading"); state.snapshot.settings.modelPath = `/${id}`; state.snapshot.settings.whisperPath = "/whisper" },
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
