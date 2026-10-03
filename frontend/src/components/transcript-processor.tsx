import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDictation } from "@/components/dictation-provider"
import { backend, isBusy } from "@/lib/backend"
import { useTextRequest } from "@/lib/use-text-request"
import { TextPanel } from "@/components/text-panel"

export function TranscriptProcessor({ input, onCancel, onUse }: { input: string; onCancel: () => void; onUse: (result: string) => void }) {
  const { snapshot } = useDictation()
  const { prompts } = snapshot.textProcessing
  const [selected, setSelected] = useState(prompts[0]?.id ?? "")
  const generation = useTextRequest()
  const select = useRef<HTMLButtonElement>(null)
  const options = prompts.map(prompt => ({ value: prompt.id, label: prompt.name }))
  useEffect(() => { select.current?.focus() }, [])
  return <>
    <DialogHeader><DialogTitle>Process transcript</DialogTitle><DialogDescription>Review the generated result before replacing your editable text.</DialogDescription></DialogHeader>
    <div className="space-y-2"><Label htmlFor="process-prompt">Prompt</Label>
      <Select items={options} value={selected || null} disabled={generation.pending} onValueChange={value => { if (value !== null) { setSelected(value); generation.clear() } }}>
        <SelectTrigger ref={select} id="process-prompt" className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"><SelectValue placeholder="Choose a prompt" /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {generation.pending ? <div className="flex items-center gap-3" role="status"><span className="text-sm">Processing…</span><Button variant="outline" onClick={() => void generation.cancel()}>Cancel processing</Button></div> : <Button variant="outline" disabled={!selected || isBusy(snapshot.status.phase)} onClick={() => void generation.request(id => backend.processText(id, input, selected))}>{generation.result ? "Generate again" : "Generate preview"}</Button>}
    <div className="grid items-start gap-4 md:grid-cols-2">
      <TextPanel title="Input text" kind="source" description="Current draft"><p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7">{input}</p></TextPanel>
      <TextPanel title="Generated result" kind="result" description={prompts.find(prompt => prompt.id === selected)?.name}>
        {generation.result ? <><Label htmlFor="processing-preview" className="sr-only">Generated result</Label><textarea id="processing-preview" readOnly rows={8} value={generation.result} className="max-h-[40vh] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-7" /></> : <p className="text-sm text-muted-foreground">{generation.pending ? "Generating result…" : "Generate a preview to see the result."}</p>}
      </TextPanel>
    </div>
    {generation.error && <p role="alert" className="text-sm text-destructive">{generation.error}</p>}
    <DialogFooter><Button variant="outline" onClick={onCancel}>Back to transcript</Button><Button disabled={!generation.result || generation.pending} onClick={() => onUse(generation.result)}>Replace draft</Button></DialogFooter>
  </>
}
