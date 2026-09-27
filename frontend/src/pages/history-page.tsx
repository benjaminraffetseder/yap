import { useState } from "react"
import { AudioLines, ChevronDown, Copy, Download, History, Loader2, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDictation } from "@/components/dictation-provider"
import { backend, duration, type Session } from "@/lib/backend"
export function HistoryPage() {
  const { snapshot, run } = useDictation()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const [audio, setAudio] = useState<Record<string, string>>({})
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null)
  const entries = snapshot.history.filter(entry => `${entry.finalTranscript ?? entry.rawTranscript} ${entry.rawTranscript}`.toLowerCase().includes(query.toLowerCase()))
  async function play(id: string) { setLoadingAudio(id); await run(async () => { const src = await backend.audio(id); setAudio(old => ({ ...old, [id]: src })) }, false); setLoadingAudio(null) }
  return <div className="space-y-7">
    <header><h1 className="text-2xl font-semibold tracking-tight">History</h1></header>
    <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search transcripts" className="h-10 rounded-xl bg-card pl-10" placeholder="Search transcripts…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <p className="text-xs text-muted-foreground">{entries.length} {entries.length === 1 ? "dictation" : "dictations"}{snapshot.history.length === 500 && " · showing the latest 500"}</p>
    {!entries.length ? <div className="rounded-2xl border border-dashed py-12 text-center"><History className="mx-auto mb-4 size-7 text-muted-foreground/50" /><h2 className="text-sm font-medium">{query ? "No matching transcripts" : "No dictations yet"}</h2>{query && <p className="mt-2 text-xs text-muted-foreground">Try a different search.</p>}</div> : <div className="space-y-3">{entries.map(entry => <article key={entry.id} className="rounded-2xl border bg-card">
      <button onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id} className="flex w-full items-start gap-4 p-5 text-left"><div className="rounded-xl bg-primary/8 p-2.5"><AudioLines className="size-4 text-primary" /></div><div className="min-w-0 flex-1"><p className={open === entry.id ? "whitespace-pre-wrap text-sm leading-7" : "line-clamp-2 text-sm leading-6"}>{entry.finalTranscript ?? entry.rawTranscript}</p><p className="mt-3 text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {duration(entry.durationMs)} · {entry.speechModel}</p></div><ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground ${open === entry.id ? "rotate-180" : ""}`} /></button>
      {open === entry.id && <div className="border-t px-5 py-4">{entry.finalTranscript && entry.finalTranscript !== entry.rawTranscript && <details className="mb-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Original transcript</summary><p className="mt-3 whitespace-pre-wrap leading-7">{entry.rawTranscript}</p></details>}<div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => void run(() => backend.copy(entry.finalTranscript ?? entry.rawTranscript), false)}><Copy className="size-3.5" />Copy</Button><Button size="sm" variant="outline" onClick={() => void run(() => backend.export(entry.id), false)}><Download className="size-3.5" />Export text</Button>{entry.audioPath && !audio[entry.id] && <Button size="sm" variant="outline" disabled={loadingAudio === entry.id} onClick={() => void play(entry.id)}>{loadingAudio === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />}Play recording</Button>}<Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setDeleting(entry)}><Trash2 className="size-3.5" />Delete</Button></div>{audio[entry.id] && <audio controls autoPlay src={audio[entry.id]} className="mt-4 h-10 w-full" />}</div>}
    </article>)}</div>}
    <Dialog open={!!deleting} onOpenChange={value => { if (!value) setDeleting(null) }}><DialogContent><DialogHeader><DialogTitle>Delete this dictation?</DialogTitle><DialogDescription>The transcript and any retained audio will be removed from this device.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" onClick={() => { if (deleting) { const id = deleting.id; void run(() => backend.remove(id)); setAudio(old => { const next = { ...old }; delete next[id]; return next }); setDeleting(null) } }}>Delete dictation</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
