import { useEffect, useRef, useState } from "react"
import { AudioLines, ChevronRight, Download, FileText, History, Search, Trash2 } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDictation } from "@/components/dictation-provider"
import { backend, duration, isDesktop, message, type HistoryPageResult } from "@/lib/backend"

export function HistoryPage() {
  const { snapshot, run, refresh } = useDictation()
  const [params, setParams] = useSearchParams()
  const query = (params.get("q") ?? "").slice(0, 250)
  const requestedPage = Number(params.get("page") ?? 0)
  const page = Number.isInteger(requestedPage) && requestedPage >= 0 && requestedPage <= 1000000 ? requestedPage : 0
  function setPage(next: number) {
    setParams(old => { const value = new URLSearchParams(old); if (next) value.set("page", String(next)); else value.delete("page"); return value }, { replace: true })
  }
  const detailSearch = params.toString() ? `?${params.toString()}` : ""
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<HistoryPageResult>({ entries: [], total: 0, page: 0, pageSize: 50 })
  const [loading, setLoading] = useState(isDesktop)
  const [error, setError] = useState("")
  const request = useRef(0)
  const [selected, setSelected] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const [deletingNow, setDeletingNow] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [exporting, setExporting] = useState(false)

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
  function changePage(next: number) { setLoading(true); setSelected([]); setPage(next) }
  function confirmDelete(ids: string[]) { setDeleteError(""); setDeleting(ids) }
  async function remove() {
    if (!deleting || deletingNow) return
    setDeletingNow(true); setDeleteError("")
    try {
      await backend.removeSessions(deleting)
      setSelected([]); setDeleting(null); setReload(old => old + 1)
      await run(refresh, false)
    } catch (cause) { setDeleteError(message(cause)); setReload(old => old + 1) }
    finally { setDeletingNow(false) }
  }
  async function exportSelected() { setExporting(true); await run(() => backend.exportSessions(selected), false); setExporting(false) }
  return <div className="space-y-7">
    <header><h1 className="text-2xl font-semibold tracking-tight">History</h1></header>
    <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Search transcripts" maxLength={250} className="h-10 rounded-xl bg-card pl-10" placeholder="Search transcripts…" value={query} onChange={event => { setLoading(true); setSelected([]); setParams(event.target.value ? { q: event.target.value } : {}, { replace: true }) }} /></div>
    {snapshot.status.historyError && <p role="alert" className="text-sm text-destructive">{snapshot.status.historyError}</p>}
    {error && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={() => setReload(old => old + 1)}>Retry</Button></div>}
    <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="mr-auto text-xs text-muted-foreground">{loading ? "Loading History…" : `${total} ${total === 1 ? "dictation" : "dictations"}`}</p>
      {!!entries.length && <label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label="Select page" disabled={unavailable} checked={entries.every(entry => selected.includes(entry.id))} ref={element => { if (element) element.indeterminate = selected.length > 0 && selected.length < entries.length }} onChange={event => setSelected(event.target.checked ? entries.map(entry => entry.id) : [])} />Select page</label>}
      {!!selected.length && <><span className="text-xs text-muted-foreground">{selected.length} selected</span><Button size="sm" variant="outline" disabled={unavailable} onClick={() => void exportSelected()}><Download className="size-3.5" />Export selected</Button><Button size="sm" variant="outline" className="text-destructive" disabled={unavailable} onClick={() => confirmDelete(selected)}><Trash2 className="size-3.5" />Delete selected</Button></>}
    </div>
    {!entries.length && !loading && !error ? <div className="rounded-2xl border border-dashed py-12 text-center"><History className="mx-auto mb-4 size-7 text-muted-foreground/50" /><h2 className="text-sm font-medium">{query ? "No matching transcripts" : "No dictations yet"}</h2>{query && <p className="mt-2 text-xs text-muted-foreground">Try a different search.</p>}</div> : <div aria-busy={loading} className="space-y-3">{entries.map((entry, index) => {
      const text = entry.finalTranscript ?? entry.rawTranscript
      const changed = text !== entry.rawTranscript
      const Icon = changed ? FileText : AudioLines
      return <article key={entry.id} className="rounded-2xl border bg-card">
      <div className="flex items-start"><input type="checkbox" className="ml-5 mt-6 shrink-0 accent-[var(--primary)]" aria-label={`Select dictation ${page * pageSize + index + 1}`} checked={selected.includes(entry.id)} disabled={unavailable} onChange={event => setSelected(old => event.target.checked ? [...old, entry.id] : old.filter(id => id !== entry.id))} />
        <Link to={`/history/${encodeURIComponent(entry.id)}${detailSearch}`} aria-disabled={unavailable} onClick={event => { if (unavailable) event.preventDefault() }} className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-5 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"><div className="rounded-xl bg-primary/8 p-2.5"><Icon aria-hidden="true" className="size-4 text-primary" /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="text-xs font-semibold">{changed ? "Result" : "Transcription"}</span>{changed && <span className="text-xs text-muted-foreground">Original transcription included</span>}</div><p className="mt-1 text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {duration(entry.durationMs)} · {entry.speechModel}</p><p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-6">{text}</p></div><ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" /></Link>
      </div>
    </article>})}</div>}
    {total > pageSize && <nav aria-label="History pages" className="flex items-center justify-between gap-3"><Button variant="outline" disabled={unavailable || page === 0} onClick={() => changePage(page - 1)}>Previous</Button><span className="text-xs text-muted-foreground">Page {page + 1} of {pages}</span><Button variant="outline" disabled={unavailable || page + 1 >= pages} onClick={() => changePage(page + 1)}>Next</Button></nav>}
    <Dialog open={!!deleting} disablePointerDismissal onOpenChange={value => { if (!value && !deletingNow) setDeleting(null) }}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>{deleting?.length === 1 ? "Delete this dictation?" : `Delete ${deleting?.length ?? 0} dictations?`}</DialogTitle><DialogDescription>The selected transcripts and retained audio will be permanently removed from this device.</DialogDescription></DialogHeader>{deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}<DialogFooter><Button variant="outline" disabled={deletingNow} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="destructive" disabled={deletingNow} onClick={() => void remove()}>{deletingNow ? "Deleting…" : deleting?.length === 1 ? "Delete dictation" : "Delete dictations"}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
