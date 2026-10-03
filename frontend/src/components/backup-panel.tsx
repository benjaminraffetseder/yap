import { useEffect, useRef, useState } from "react"
import { Download, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDictation } from "@/components/dictation-provider"
import { backend, message, type BackupPreview, type BackupSummary } from "@/lib/backend"

function restoredMessage(summary: BackupSummary) {
  const skipped = summary.duplicateSessions + summary.duplicateOutputs + summary.skippedPrompts + summary.skippedVocabulary
  return `Restored ${summary.sessions} dictations, ${summary.outputs} outputs, ${summary.prompts} prompts, and ${summary.vocabulary} terms.${skipped ? ` ${skipped} existing or conflicting entries kept.` : ""}`
}

export function BackupPanel({ disabled, unsaved }: { disabled: boolean; unsaved: boolean }) {
  const { refresh, snapshot } = useDictation()
  const [audio, setAudio] = useState(false)
  const [preferences, setPreferences] = useState(false)
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [working, setWorking] = useState<"export" | "preview" | "restore" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const active = useRef(true)
  const previewID = useRef("")
  useEffect(() => {
    active.current = true
    return () => { active.current = false; if (previewID.current) void backend.discardBackup(previewID.current).catch(() => {}) }
  }, [])
  async function exportBackup() {
    setWorking("export"); setError(""); setNotice("")
    try {
      const result = await backend.exportBackup(audio)
      if (active.current && result) setNotice(`Backup saved: ${result.sessions} dictations, ${result.outputs} outputs, and ${result.recordings} recordings.${result.missingRecordings ? ` ${result.missingRecordings} unavailable recordings omitted.` : ""}`)
    } catch (cause) { if (active.current) setError(message(cause)) }
    finally { if (active.current) setWorking(null) }
  }
  async function chooseBackup() {
    setWorking("preview"); setError(""); setNotice(""); setPreferences(false)
    try {
      const value = await backend.previewBackup()
      if (!active.current) { if (value) await backend.discardBackup(value.id); return }
      previewID.current = value?.id ?? ""
      setPreview(value)
    } catch (cause) { if (active.current) setError(message(cause)) }
    finally { if (active.current) setWorking(null) }
  }
  async function dismiss() {
    if (working) return
    const id = previewID.current
    previewID.current = ""; setPreview(null); setError("")
    if (id) { try { await backend.discardBackup(id) } catch (cause) { if (active.current) setError(message(cause)) } }
  }
  async function restore() {
    if (!preview || disabled || working) return
    setWorking("restore"); setError("")
    try {
      const result = await backend.restoreBackup(preview.id, preferences)
      // Restoration is committed even if refreshing the interface then fails.
      previewID.current = ""
      if (active.current) { setPreview(null); setNotice(restoredMessage(result)); await refresh() }
    } catch (cause) { if (active.current) setError(message(cause)) }
    finally { if (active.current) setWorking(null) }
  }
  const backupRunning = snapshot.status.phase === "backup"
  const operationMessage = backupRunning ? snapshot.status.message : working === "export" ? "Creating backup…" : working === "preview" ? "Checking backup…" : "Restoring backup…"
  const blocked = disabled || !!working || backupRunning
  return <section className="settings-section space-y-4" aria-labelledby="backup-heading">
    <h2 id="backup-heading" className="font-semibold">Backup & restore</h2>
    <p className="text-xs text-muted-foreground">Save History, generated outputs, prompts, vocabulary, and portable preferences in one file.</p>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={audio} disabled={blocked} onCheckedChange={setAudio} />Include retained recordings</label>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={blocked} onClick={() => void exportBackup()}>{working === "export" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Export backup</Button>
      <Button variant="outline" disabled={blocked} onClick={() => void chooseBackup()}>{working === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}Restore backup</Button>
    </div>
    {unsaved && <p className="text-xs text-muted-foreground">Save your settings before using backups.</p>}
    {(working || backupRunning) && <div role="status" className="flex items-center gap-3 text-sm"><span>{operationMessage}</span>{backupRunning && <Button size="sm" variant="outline" onClick={() => void backend.cancel().catch(cause => setError(message(cause)))}>Cancel operation</Button>}</div>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {error && !preview && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={!!preview} disablePointerDismissal onOpenChange={open => { if (!open) void dismiss() }}>
      <DialogContent showCloseButton={!working} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Restore backup?</DialogTitle><DialogDescription>New entries will be added. Existing dictations, outputs, and conflicting prompts or terms will be kept.</DialogDescription></DialogHeader>
        {preview && <>
          <div className="min-w-0 space-y-1"><p className="break-all text-sm font-medium">{preview.filename}</p><p className="text-xs text-muted-foreground">{new Date(preview.createdAt).toLocaleString()}</p></div>
          <dl className="divide-y rounded-lg border px-4">{[
            ["Dictations", preview.summary.sessions, preview.summary.duplicateSessions],
            ["Generated outputs", preview.summary.outputs, preview.summary.duplicateOutputs],
            ["Prompts", preview.summary.prompts, preview.summary.skippedPrompts],
            ["Vocabulary terms", preview.summary.vocabulary, preview.summary.skippedVocabulary],
            ["Recordings", preview.summary.recordings, 0],
          ].map(([label, added, kept]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><dt>{label}</dt><dd className="text-muted-foreground">{added} to add{Number(kept) > 0 && <span> · {kept} kept / skipped</span>}</dd></div>)}</dl>
          <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={preferences} disabled={blocked} onCheckedChange={setPreferences} />Restore portable preferences</label><p className="text-xs leading-5 text-muted-foreground">Language ({preview.preferences.language}), recording mode, cleanup, automatic paste, and Keep recordings. Microphone, shortcuts, models, startup, local server, and History retention stay unchanged.</p></div>
        </>}
        {working === "restore" && <div className="flex items-center gap-3" role="status"><Loader2 className="size-4 animate-spin" /><span className="text-sm">Restoring backup…</span><Button size="sm" variant="outline" onClick={() => void backend.cancel().catch(cause => setError(message(cause)))}>Cancel operation</Button></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={!!working} onClick={() => void dismiss()}>Cancel</Button><Button disabled={blocked || !preview} onClick={() => void restore()}>Restore backup</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
