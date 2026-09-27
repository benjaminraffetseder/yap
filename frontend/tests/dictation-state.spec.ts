import { expect, test, type Page } from "@playwright/test"
import type { Settings, Snapshot, Status } from "../src/lib/backend"

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
        settings: { microphoneId: "", whisperPath: "/whisper", modelPath: "/model", language: "auto", shortcut: "Ctrl+Alt+Space", interaction: "hold", autoPaste: true, saveAudio: false },
        status: { phase: "idle", message: "Ready", startedAt: 0, transcript: "", progress: 0, shortcutError: "", indicatorError: "" },
        models: [], history: [], ready: true, dataDir: "", floatingIndicator: true,
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
          state.snapshot.settings = structuredClone(settings)
        },
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
    state.snapshot.history = [{ id: "new", createdAt: new Date().toISOString(), durationMs: 1000, rawTranscript: "Fresh history entry", speechModel: "tiny", language: "en", audioPath: "" }]
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
