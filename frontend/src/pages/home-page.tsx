import { useEffect, useState } from "react"
import { ArrowRight, Check, Copy, Download, Keyboard, Loader2, Mic, Square } from "lucide-react"
import { Link } from "react-router"
import { Button, buttonVariants } from "@/components/ui/button"
import { useDictation } from "@/components/dictation-provider"
import { backend, duration, isBusy, isDesktop } from "@/lib/backend"
import { SetupPage } from "@/pages/setup-page"
import { AudioImportButton } from "@/components/audio-import-button"
export function HomePage() {
  const { snapshot, loading, level, run } = useDictation()
  const { status, settings, history, ready } = snapshot
  const [now, setNow] = useState(Date.now())
  const [pending, setPending] = useState(false)
  const recording = status.phase === "recording"
  const working = isBusy(status.phase) && !recording
  const modelName = snapshot.models.find(model => model.path === settings.modelPath && model.installed)?.name ?? settings.modelPath.split(/[\\/]/).pop()
  useEffect(() => { if (!recording) return; const timer = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(timer) }, [recording])
  async function record() { setPending(true); await run(recording ? backend.stop : backend.start); setPending(false) }
  if (isDesktop && !loading && !settings.setupComplete) return <SetupPage />
  return <div className="space-y-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold tracking-tight">Dictate</h1><AudioImportButton /></header>
    <section className="rounded-2xl border bg-card px-6 py-6 text-center">
      <div className="my-7 flex justify-center"><button disabled={!isDesktop || !ready || working || loading || pending} onClick={() => void record()} aria-label={recording ? "Stop recording" : "Start recording"} className="relative flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/15 transition-transform hover:scale-105 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50">
        {recording && <span className="absolute inset-[-10px] rounded-full border-2 border-primary/25" style={{ transform: `scale(${1 + level * .15})` }} />}{working || pending ? <Loader2 className="size-8 animate-spin" /> : recording ? <Square className="size-7 fill-current" /> : <Mic className="size-9" />}
      </button></div>
      <h2 className="text-lg font-medium">{loading ? "Connecting…" : recording ? "Recording" : working ? status.message : ready ? "Ready to record" : "Install a speech model"}</h2>
      {recording ? <div className="mt-4 font-mono text-primary">{duration(Math.max(0, now - status.startedAt))}</div> : !ready && !working && !loading ? <Link to="/models" className={buttonVariants({ className: "mt-5 rounded-lg" })}><Download className="size-4" />Download model</Link> : ready && !working && !loading && <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground"><Keyboard className="size-4" aria-hidden="true" />{settings.interaction === "hold" ? "Hold" : "Press"}{settings.shortcut.split("+").map(key => <kbd key={key} className="rounded-md border bg-background px-2 py-1 font-mono text-[11px]">{key}</kbd>)}</div>}
      {ready && !recording && !working && <Link to="/models" className="mt-5 inline-block text-xs text-muted-foreground hover:text-primary">{modelName}</Link>}
    </section>
    {status.shortcutError && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">Global shortcut unavailable: {status.shortcutError} <Link to="/settings" className="underline">Change shortcut</Link></p>}
    {status.indicatorError && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">{status.indicatorError}</p>}
    {status.trayError && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">{status.trayError}</p>}
    {(status.phase === "done" || status.phase === "error") && <section aria-live="polite" className="rounded-2xl border bg-card p-5"><p className={`flex items-center gap-2 text-sm ${status.phase === "error" ? "text-destructive" : "text-primary"}`}>{status.phase === "done" && <Check className="size-4" />}{status.message}</p>{status.transcript && <><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{status.transcript}</p><Button variant="outline" size="sm" className="mt-4" onClick={() => void run(() => backend.copy(status.transcript), false)}><Copy className="size-3" />Copy</Button></>}</section>}
    <section><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent dictations</h2><Link to="/history" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">View all<ArrowRight className="size-3" /></Link></div>{history.length ? <div className="divide-y rounded-2xl border bg-card">{history.slice(0, 3).map(entry => <Link to={`/history/${encodeURIComponent(entry.id)}`} key={entry.id} className="block px-5 py-4 hover:bg-accent/50"><p className="truncate text-sm">{entry.finalTranscript ?? entry.rawTranscript}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {duration(entry.durationMs)}</p></Link>)}</div> : <div className="rounded-xl border border-dashed px-6 py-7 text-center text-sm text-muted-foreground">No dictations yet.</div>}</section>
  </div>
}
