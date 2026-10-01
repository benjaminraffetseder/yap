import { useEffect, useState } from "react"
import { AudioLines, Loader2, Square, X } from "lucide-react"
import { useDictation } from "@/components/dictation-provider"
import { backend, duration } from "@/lib/backend"
export function RecordingStatus() {
  const { snapshot: { status, floatingIndicator }, level, run } = useDictation()
  const [now, setNow] = useState(Date.now())
  const recording = status.phase === "recording"
  const diagnostic = status.phase.startsWith("diagnostic-")
  const testing = status.phase === "mic-test" || diagnostic
  const capturing = recording || status.phase === "mic-test" || status.phase === "diagnostic-recording"
  useEffect(() => { if (!capturing) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [capturing])
  if ((!testing && floatingIndicator) || (!capturing && status.phase !== "transcribing" && status.phase !== "diagnostic-transcribing")) return null
  return <div className="pointer-events-none fixed bottom-6 left-[var(--sidebar-width)] right-0 z-50 flex justify-center px-4 transition-[left] duration-200 motion-reduce:transition-none"><div role="status" aria-live="polite" className="pointer-events-auto flex max-w-full items-center gap-4 rounded-2xl border bg-card px-5 py-3 shadow-xl">
    {capturing ? <AudioLines className="size-5 text-primary" style={{ opacity: .4 + level * .6 }} /> : <Loader2 className="size-5 animate-spin text-primary" />}<span className="text-sm font-medium">{capturing ? `${diagnostic ? "Dictation test" : testing ? "Microphone test" : "Recording"} · ${duration(Math.max(0, now - status.startedAt))}` : diagnostic ? "Transcribing test…" : status.message}</span>
    {capturing && <button aria-label={diagnostic ? "Stop test recording" : testing ? "Stop microphone test" : "Stop recording"} className="rounded-lg p-2 hover:bg-accent" onClick={() => void run(diagnostic ? backend.stopDictationTest : testing ? backend.stopMicTest : backend.stop)}><Square className="size-3.5 fill-current" /></button>}<button aria-label="Cancel" className="rounded-lg p-2 hover:bg-accent" onClick={() => void run(backend.cancel)}><X className="size-4" /></button>
  </div></div>
}
