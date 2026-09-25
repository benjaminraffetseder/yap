import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { EventsOn } from "@wails/runtime/runtime"
import { backend, isDesktop, message, type Snapshot, type Status } from "@/lib/backend"
const empty: Snapshot = {
  settings: { whisperPath: "", modelPath: "", language: "auto", shortcut: "Ctrl+Alt+Space", interaction: "hold", autoPaste: true, saveAudio: false },
  status: { phase: "idle", message: "Ready when you are", startedAt: 0, transcript: "", progress: 0, shortcutError: "" },
  models: [
    { id: "tiny", name: "Whisper Tiny", size: 77691713, description: "Fastest · short dictation", installed: false, path: "" },
    { id: "base", name: "Whisper Base", size: 147951465, description: "Lightweight · everyday dictation", installed: false, path: "" },
    { id: "small", name: "Whisper Small", size: 487601967, description: "Balanced · better accuracy", installed: false, path: "" },
  ], history: [], dataDir: "", ready: false,
}
type Context = { snapshot: Snapshot; level: number; error: string; loading: boolean; refresh: () => Promise<void>; run: (action: () => Promise<unknown>, reload?: boolean) => Promise<void>; clearError: () => void }
const DictationContext = createContext<Context | null>(null)
export function DictationProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(empty)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(isDesktop)
  async function refresh() { if (isDesktop) setSnapshot(await backend.snapshot()) }
  async function run(action: () => Promise<unknown>, reload = true) {
    setError(""); try { await action(); if (reload) await refresh() } catch (cause) { setError(message(cause)) }
  }
  useEffect(() => {
    if (!isDesktop) return
    let active = true
    const offStatus = EventsOn("dictation:status", (status: Status) => { if (active) setSnapshot(old => ({ ...old, status })) })
    const offLevel = EventsOn("dictation:level", (value: number) => { if (active) setLevel(value) })
    const offHistory = EventsOn("dictation:history", () => { backend.snapshot().then(value => { if (active) setSnapshot(value) }).catch(cause => { if (active) setError(message(cause)) }) })
    backend.snapshot().then(value => { if (active) setSnapshot(value) }).catch(cause => { if (active) setError(message(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; offStatus(); offLevel(); offHistory() }
  }, [])
  return <DictationContext.Provider value={{ snapshot, level, error, loading, refresh, run, clearError: () => setError("") }}>{children}</DictationContext.Provider>
}
export function useDictation() { const value = useContext(DictationContext); if (!value) throw new Error("DictationProvider is missing"); return value }
