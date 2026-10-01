import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDictation } from "@/components/dictation-provider"
import { backend, isBusy } from "@/lib/backend"
import { useTextRequest } from "@/lib/use-text-request"

export function TranscriptProcessor({ input, onCancel, onUse }: { input: string; onCancel: () => void; onUse: (result: string) => void }) {
  const { snapshot } = useDictation()
  const { prompts } = snapshot.textProcessing
  const [selected, setSelected] = useState(prompts[0]?.id ?? "")
  const generation = useTextRequest()
  const select = useRef<HTMLSelectElement>(null)
  useEffect(() => { select.current?.focus() }, [])
  return <>
    <DialogHeader><DialogTitle>Process transcript</DialogTitle><DialogDescription>Preview a result before applying it to your draft.</DialogDescription></DialogHeader>
    <div className="space-y-2"><Label htmlFor="process-prompt">Prompt</Label><select ref={select} id="process-prompt" value={selected} disabled={generation.pending} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" onChange={event => { setSelected(event.target.value); generation.clear() }}>{prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    {generation.pending ? <div className="flex items-center gap-3" role="status"><span className="text-sm">Processing…</span><Button variant="outline" onClick={() => void generation.cancel()}>Cancel processing</Button></div> : <Button variant="outline" disabled={!selected || isBusy(snapshot.status.phase)} onClick={() => void generation.request(id => backend.processText(id, input, selected))}>{generation.result ? "Generate again" : "Generate preview"}</Button>}
    {generation.result && <div className="space-y-2"><Label htmlFor="processing-preview">Preview</Label><textarea id="processing-preview" readOnly rows={8} value={generation.result} className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-7" /></div>}
    {generation.error && <p role="alert" className="text-sm text-destructive">{generation.error}</p>}
    <DialogFooter><Button variant="outline" onClick={onCancel}>Back to transcript</Button><Button disabled={!generation.result || generation.pending} onClick={() => onUse(generation.result)}>Use result</Button></DialogFooter>
  </>
}
