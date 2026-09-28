import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { EventsOn } from "@wails/runtime/runtime"
import { backend, isDesktop, message, type Snapshot, type Status } from "@/lib/backend"
const empty: Snapshot = {
  settings: { microphoneId: "", whisperPath: "", modelPath: "", language: "auto", shortcut: "Ctrl+Alt+Space", interaction: "hold", autoPaste: true, saveAudio: false, launchAtLogin: false, startInTray: false, cleanText: false, setupComplete: false },
  status: { phase: "idle", message: "Ready when you are", startedAt: 0, transcript: "", progress: 0, shortcutError: "", indicatorError: "", trayError: "", startupError: "" },
  models: [
    { id: "tiny", name: "Whisper Tiny", size: 77691713, description: "Fastest · short dictation", installed: false, path: "" },
    { id: "base", name: "Whisper Base", size: 147951465, description: "Lightweight · everyday dictation", installed: false, path: "" },
    { id: "small", name: "Whisper Small", size: 487601967, description: "Balanced · better accuracy", installed: false, path: "" },
  ], history: [], dataDir: "", ready: false, floatingIndicator: false, launchAtLoginAvailable: false, startInTrayAvailable: false, vocabulary: [], microphoneTested: false, shortcutTested: false, diagnostic: { phase: "", message: "", details: "", transcript: "", durationMs: 0 },
}
type Context = { snapshot: Snapshot; level: number; error: string; loading: boolean; refresh: () => Promise<void>; run: (action: () => Promise<unknown>, reload?: boolean) => Promise<void>; clearError: () => void }
const DictationContext = createContext<Context | null>(null)
export function DictationProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(isDesktop)
  const snapshotRequest = useRef(0)
  const statusRevision = useRef(0)
  const refresh = useCallback(async () => {
    if (!isDesktop) return
    const request = ++snapshotRequest.current
    const revision = statusRevision.current
    const value = await backend.snapshot()
    // Bridge replies may arrive out of order or after a newer status event.
    setSnapshot(old => request !== snapshotRequest.current ? old : {
      ...value, status: revision === statusRevision.current ? value.status : old.status,
    })
  }, [])
  async function run(action: () => Promise<unknown>, reload = true) {
    setError(""); try { await action(); if (reload) await refresh() } catch (cause) { setError(message(cause)) }
  }
  useEffect(() => {
    if (!isDesktop) return
    let active = true
    const offStatus = EventsOn("dictation:status", (status: Status) => { if (active) { statusRevision.current++; setSnapshot(old => ({ ...old, status })) } })
    const offLevel = EventsOn("dictation:level", (value: number) => { if (active) setLevel(value) })
    const offHistory = EventsOn("dictation:history", () => { void refresh().catch(cause => { if (active) setError(message(cause)) }) })
    const offSetup = EventsOn("setup:changed", () => { void refresh().catch(cause => { if (active) setError(message(cause)) }) })
    void refresh().catch(cause => { if (active) setError(message(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; snapshotRequest.current++; offStatus(); offLevel(); offHistory(); offSetup() }
  }, [refresh])
  return <DictationContext.Provider value={{ snapshot, level, error, loading, refresh, run, clearError: () => setError("") }}>{children}</DictationContext.Provider>
}
export function useDictation() { const value = useContext(DictationContext); if (!value) throw new Error("DictationProvider is missing"); return value }
