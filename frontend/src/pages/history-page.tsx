import { useEffect, useRef, useState } from "react"
import { AudioLines, ChevronDown, Copy, Download, History, Loader2, Pencil, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDictation } from "@/components/dictation-provider"
import { backend, duration, isDesktop, message, type HistoryPageResult, type Session } from "@/lib/backend"
import { TranscriptEditor } from "@/components/transcript-editor"

export function HistoryPage() {
  const { snapshot, run, refresh } = useDictation()
  const [editing, setEditing] = useState<Session | null>(null)
  const editTrigger = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<HistoryPageResult>({ entries: [], total: 0, page: 0, pageSize: 50 })
  const [loading, setLoading] = useState(isDesktop)
  const [error, setError] = useState("")
  const request = useRef(0)
  const [open, setOpen] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const [deletingNow, setDeletingNow] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [exporting, setExporting] = useState(false)
  const [audio, setAudio] = useState<Record<string, string>>({})
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    const revision = ++request.current
    setLoading(true); setError("")
    const timer = setTimeout(() => {
      void backend.history(query, page).then(value => {
        if (revision !== request.current) return
        const last = Math.max(0, Math.ceil(value.total / value.pageSize) - 1)
        if (page > last) { setPage(last); return }
        setResult(value)
        const ids = new Set(value.entries.map(entry => entry.id))
        setSelected(old => old.filter(id => ids.has(id)))
        setLoading(false)
      }).catch(cause => { if (revision === request.current) { setError(message(cause)); setLoading(false) } })
    }, 150)
    return () => { clearTimeout(timer); request.current++ }
  }, [query, page, reload, snapshot.history])

  const { entries, total, pageSize } = result
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const unavailable = !isDesktop || loading || !!error || deletingNow || exporting
  function changePage(next: number) { setLoading(true); setSelected([]); setOpen(null); setAudio({}); setPage(next) }
  function confirmDelete(ids: string[]) { setDeleteError(""); setDeleting(ids) }
  async function remove() {
    if (!deleting || deletingNow) return
    setDeletingNow(true); setDeleteError("")
    try {
      await backend.removeSessions(deleting)
      setSelected([]); setAudio({}); setDeleting(null); setReload(old => old + 1)
      await run(refresh, false)
    } catch (cause) { setDeleteError(message(cause)); setReload(old => old + 1) }
    finally { setDeletingNow(false) }
  }
  async function exportSelected() { setExporting(true); await run(() => backend.exportSessions(selected), false); setExporting(false) }
  async function play(id: string) { setLoadingAudio(id); await run(async () => { const src = await backend.audio(id); setAudio(old => ({ ...old, [id]: src })) }, false); setLoadingAudio(null) }
  return <div className="space-y-7">
    <header><h1 className="text-2xl font-semibold tracking-tight">History</h1></header>
    <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search transcripts" maxLength={250} className="h-10 rounded-xl bg-card pl-10" placeholder="Search transcripts…" value={query} onChange={event => { setLoading(true); setSelected([]); setAudio({}); setQuery(event.target.value); setPage(0) }} /></div>
    {snapshot.status.historyError && <p role="alert" className="text-sm text-destructive">{snapshot.status.historyError}</p>}
    {error && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={() => setReload(old => old + 1)}>Retry</Button></div>}
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="mr-auto text-xs text-muted-foreground">{loading ? "Loading History…" : `${total} ${total === 1 ? "dictation" : "dictations"}`}</p>
      {!!entries.length && <label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label="Select page" disabled={unavailable} checked={entries.every(entry => selected.includes(entry.id))} ref={element => { if (element) element.indeterminate = selected.length > 0 && selected.length < entries.length }} onChange={event => setSelected(event.target.checked ? entries.map(entry => entry.id) : [])} />Select page</label>}
      {!!selected.length && <><span className="text-xs text-muted-foreground">{selected.length} selected</span><Button size="sm" variant="outline" disabled={unavailable} onClick={() => void exportSelected()}><Download className="size-3.5" />Export selected</Button><Button size="sm" variant="outline" className="text-destructive" disabled={unavailable} onClick={() => confirmDelete(selected)}><Trash2 className="size-3.5" />Delete selected</Button></>}
    </div>
    {!entries.length && !loading && !error ? <div className="rounded-2xl border border-dashed py-12 text-center"><History className="mx-auto mb-4 size-7 text-muted-foreground/50" /><h2 className="text-sm font-medium">{query ? "No matching transcripts" : "No dictations yet"}</h2>{query && <p className="mt-2 text-xs text-muted-foreground">Try a different search.</p>}</div> : <div aria-busy={loading} className="space-y-3">{entries.map((entry, index) => <article key={entry.id} className="rounded-2xl border bg-card">
      <div className="flex items-start"><input type="checkbox" className="ml-5 mt-6 shrink-0 accent-[var(--primary)]" aria-label={`Select dictation ${page * pageSize + index + 1}`} checked={selected.includes(entry.id)} disabled={unavailable} onChange={event => setSelected(old => event.target.checked ? [...old, entry.id] : old.filter(id => id !== entry.id))} />
        <button disabled={unavailable} onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id} className="flex min-w-0 flex-1 items-start gap-4 p-5 text-left"><div className="rounded-xl bg-primary/8 p-2.5"><AudioLines className="size-4 text-primary" /></div><div className="min-w-0 flex-1"><p className={open === entry.id ? "whitespace-pre-wrap text-sm leading-7" : "line-clamp-2 text-sm leading-6"}>{entry.finalTranscript ?? entry.rawTranscript}</p><p className="mt-3 text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {duration(entry.durationMs)} · {entry.speechModel}</p></div><ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground ${open === entry.id ? "rotate-180" : ""}`} /></button>
      </div>
      {open === entry.id && <div className="border-t px-5 py-4">{entry.finalTranscript && entry.finalTranscript !== entry.rawTranscript && <details className="mb-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Original transcript</summary><p className="mt-3 whitespace-pre-wrap leading-7">{entry.rawTranscript}</p></details>}<div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={unavailable} onClick={event => { editTrigger.current = event.currentTarget; setEditing(entry) }}><Pencil className="size-3.5" />Edit transcript</Button><Button size="sm" variant="outline" disabled={unavailable} onClick={() => void run(() => backend.copy(entry.finalTranscript ?? entry.rawTranscript), false)}><Copy className="size-3.5" />Copy</Button><Button size="sm" variant="outline" disabled={unavailable} onClick={() => void run(() => backend.export(entry.id), false)}><Download className="size-3.5" />Export text</Button>{entry.audioPath && !audio[entry.id] && <Button size="sm" variant="outline" disabled={unavailable || loadingAudio === entry.id} onClick={() => void play(entry.id)}>{loadingAudio === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />}Play recording</Button>}<Button size="sm" variant="ghost" disabled={unavailable} className="ml-auto text-destructive" onClick={() => confirmDelete([entry.id])}><Trash2 className="size-3.5" />Delete</Button></div>{audio[entry.id] && <audio controls autoPlay src={audio[entry.id]} className="mt-4 h-10 w-full" />}</div>}
    </article>)}</div>}
    {total > pageSize && <nav aria-label="History pages" className="flex items-center justify-between gap-3"><Button variant="outline" disabled={unavailable || page === 0} onClick={() => changePage(page - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page + 1} of {pages}</span><Button variant="outline" disabled={unavailable || page + 1 >= pages} onClick={() => changePage(page + 1)}>Next</Button></nav>}
    {editing && <TranscriptEditor session={editing} returnFocus={editTrigger} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void run(refresh, false) }} />}
    <Dialog open={!!deleting} disablePointerDismissal onOpenChange={value => { if (!value && !deletingNow) setDeleting(null) }}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>{deleting?.length === 1 ? "Delete this dictation?" : `Delete ${deleting?.length ?? 0} dictations?`}</DialogTitle><DialogDescription>The selected transcripts and retained audio will be permanently removed from this device.</DialogDescription></DialogHeader>{deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}<DialogFooter><Button variant="outline" disabled={deletingNow} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={deletingNow} onClick={() => void remove()}>{deletingNow ? "Deleting…" : deleting?.length === 1 ? "Delete dictation" : "Delete dictations"}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
