import { useRef, useState, type RefObject } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { backend, message, type Session } from "@/lib/backend"

export function TranscriptEditor({ session, returnFocus, onClose, onSaved }: { session: Session; returnFocus: RefObject<HTMLButtonElement | null>; onClose: () => void; onSaved: () => void }) {
  const initial = session.finalTranscript ?? session.rawTranscript
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const input = useRef<HTMLTextAreaElement>(null)
  const dirty = text !== initial
  const canSave = dirty && !!text.trim() && !saving
  async function save() {
    if (!canSave) return
    setSaving(true); setError("")
    try { await backend.saveTranscript(session.id, text); onSaved() }
    catch (cause) { setError(message(cause)); setSaving(false) }
  }
  return <Dialog open disablePointerDismissal onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent showCloseButton={false} initialFocus={input} finalFocus={returnFocus} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Edit transcript</DialogTitle><DialogDescription>Your original transcript is preserved.</DialogDescription></DialogHeader>
      <div className="space-y-2"><Label htmlFor="transcript-editor">Transcript</Label><textarea ref={input} id="transcript-editor" value={text} disabled={saving} maxLength={100000} rows={9} aria-invalid={!!error} aria-describedby={error ? "transcript-save-error" : undefined} className="min-h-40 max-h-[45vh] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-7 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60" onChange={event => setText(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save() } }} /></div>
      {session.finalTranscript !== session.rawTranscript && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Original transcript</summary><p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap leading-7">{session.rawTranscript}</p></details>}
      {error && <p id="transcript-save-error" role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={!canSave} onClick={() => void save()}>{saving ? "Saving…" : "Save transcript"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
