import { useEffect, useRef, useState } from "react"
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { useDictation } from "@/components/dictation-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { backend, defaultTextProcessing, isBusy, isDesktop, type TextProcessing, type TextPrompt } from "@/lib/backend"
import { useTextRequest } from "@/lib/use-text-request"
import { useModelDiscovery } from "@/lib/use-model-discovery"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
export function PromptsPage() {
  const { snapshot, run, loading } = useDictation()
  const saved = snapshot.textProcessing
  const [draft, setDraft] = useState<TextProcessing>(saved)
  const [selected, setSelected] = useState(saved.prompts[0]?.id ?? "")
  const [saving, setSaving] = useState(false)
  const baseline = useRef(saved)
  const modelTest = useTextRequest()
  const discovery = useModelDiscovery(draft.endpoint, isDesktop && !loading)
  const [manualModel, setManualModel] = useState(false)
  const listed = discovery.models.includes(draft.model)
  const manual = manualModel || !listed
  const modelOptions = [...discovery.models.map(id => ({ value: `model:${id}`, label: id })), { value: "manual", label: "Enter model ID manually" }]
  useEffect(() => {
    const previous = baseline.current
    baseline.current = saved
    setDraft(old => JSON.stringify(old) === JSON.stringify(previous) ? saved : old)
  }, [saved])
  useEffect(() => { if (!draft.prompts.some(p => p.id === selected)) setSelected(draft.prompts[0]?.id ?? "") }, [draft.prompts, selected])
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const busy = isBusy(snapshot.status.phase) || saving || modelTest.pending
  const prompt = draft.prompts.find(p => p.id === selected)
  function update(value: Partial<TextProcessing>) { setDraft(old => ({ ...old, ...value })); modelTest.clear() }
  function updatePrompt(value: Partial<TextPrompt>) { update({ prompts: draft.prompts.map(p => p.id === selected ? { ...p, ...value } : p) }) }
  async function save() {
    setSaving(true)
    await run(async () => { const value = await backend.textProcessing(draft); setDraft(value); modelTest.clear() })
    setSaving(false)
  }
  return <div className="space-y-7">
    <header><h1 className="text-2xl font-semibold tracking-tight">Prompts</h1></header>
    <fieldset disabled={!isDesktop || busy || loading} className="space-y-6 disabled:opacity-60">
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Text model</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={event => update({ enabled: event.target.checked, autoPromptId: event.target.checked ? draft.autoPromptId : "" })} />Enable LLM processing</label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="llm-endpoint">Local server URL</Label><Input id="llm-endpoint" value={draft.endpoint} placeholder="http://127.0.0.1:11434/v1" onChange={event => update({ endpoint: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="llm-picker">Model</Label>
            <Select items={modelOptions} value={manual ? "manual" : `model:${draft.model}`} disabled={!isDesktop || busy || loading} onValueChange={value => {
              if (value === "manual") setManualModel(true)
              else if (value?.startsWith("model:")) { setManualModel(false); update({ model: value.slice(6) }) }
            }}>
              <SelectTrigger id="llm-picker" className="h-9 w-full min-w-0 rounded-md bg-background" aria-describedby="llm-discovery-status"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start"><div className="p-1">{modelOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</div></SelectContent>
            </Select>
            {manual && <div className="space-y-2"><Label htmlFor="llm-model">Model identifier</Label><Input id="llm-model" maxLength={200} value={draft.model} placeholder="Model ID from your server" onChange={event => { setManualModel(true); update({ model: event.target.value }) }} /></div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={discovery.phase === "checking"} onClick={() => void discovery.refresh()}><RefreshCw className={`size-3.5 ${discovery.phase === "checking" ? "animate-spin" : ""}`} />Refresh models</Button>
          <p id="llm-discovery-status" role={discovery.phase === "error" ? "alert" : "status"} className={`text-xs ${discovery.phase === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {discovery.phase === "checking" ? "Checking server…" : discovery.phase === "error" ? discovery.error : discovery.phase === "ready" ? discovery.models.length === 0 ? "Server responded. No models listed. Download or load a model in your server, then refresh." : draft.model && !listed ? "Server responded. This model is not listed. Load it in your server or choose another; Test model can check a manual ID." : `Server responded. ${discovery.models.length} ${discovery.models.length === 1 ? "model" : "models"} available.` : "Checking available models."}
          </p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Use Ollama (port 11434), LM Studio (1234), or llama-server (8080), with a /v1 URL and a downloaded model. Requests go to this computer; your server controls whether the model runs locally or forwards to a cloud service.</p>
        <Button variant="outline" disabled={dirty || !saved.enabled} onClick={() => void modelTest.request(backend.testTextModel)}>Test model</Button>
        {dirty && <span className="ml-3 text-xs text-muted-foreground">Save before testing.</span>}
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Saved prompts</h2><Button variant="outline" size="sm" disabled={draft.prompts.length >= 30} onClick={() => { const id = crypto.randomUUID(); update({ prompts: [...draft.prompts, { id, name: "New prompt", instruction: "" }] }); setSelected(id) }}><Plus className="size-4" />Add prompt</Button></div>
        {draft.prompts.length > 0 ? <>
          <div className="space-y-2"><Label htmlFor="saved-prompt">Prompt</Label><select id="saved-prompt" className={selectClass} value={selected} onChange={event => setSelected(event.target.value)}>{draft.prompts.map(p => <option key={p.id} value={p.id}>{p.name || "Untitled prompt"}</option>)}</select></div>
          {prompt && <>
            <div className="space-y-2"><Label htmlFor="prompt-name">Name</Label><Input id="prompt-name" value={prompt.name} maxLength={80} onChange={event => updatePrompt({ name: event.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="prompt-instruction">Instructions</Label><textarea id="prompt-instruction" rows={5} maxLength={8000} value={prompt.instruction} onChange={event => updatePrompt({ instruction: event.target.value })} className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-ring" /><p className="text-xs text-muted-foreground">The transcript is supplied separately. Describe how to transform it.</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => update({ prompts: draft.prompts.filter(p => p.id !== selected), autoPromptId: draft.autoPromptId === selected ? "" : draft.autoPromptId })}><Trash2 className="size-4" />Delete prompt</Button>{defaultTextProcessing.prompts.some(p => p.id === selected) && <Button variant="ghost" size="sm" onClick={() => updatePrompt(defaultTextProcessing.prompts.find(p => p.id === selected)!)}>Reset instructions</Button>}</div>
          </>}
        </> : <Button variant="outline" onClick={() => update({ prompts: defaultTextProcessing.prompts.map(p => ({ ...p })) })}>Restore default prompts</Button>}
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-5"><Label htmlFor="auto-prompt">After dictation</Label><select id="auto-prompt" disabled={!draft.enabled} className={selectClass} value={draft.autoPromptId} onChange={event => update({ autoPromptId: event.target.value })}><option value="">No automatic processing</option>{draft.prompts.map(p => <option key={p.id} value={p.id}>{p.name || "Untitled prompt"}</option>)}</select><p className="text-xs leading-5 text-muted-foreground">When enabled, the result is saved and copied or pasted automatically. If processing fails or is cancelled, the speech transcript stays in History and nothing is copied or pasted. You can also preview prompts from History.</p></section>
      <div className="flex items-center gap-3"><Button disabled={!dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save prompts"}</Button>{dirty && <Button variant="ghost" onClick={() => { setDraft(saved); setManualModel(false); modelTest.clear() }}>Discard changes</Button>}</div>
    </fieldset>
    {modelTest.pending && <div className="flex items-center gap-3" role="status"><span className="text-sm">Testing model…</span><Button variant="outline" size="sm" onClick={() => void modelTest.cancel()}>Cancel test</Button></div>}
    {modelTest.result && <p role="status" className="text-sm text-primary">Model responded successfully.</p>}
    {modelTest.error && <p role="alert" className="text-sm text-destructive">{modelTest.error}</p>}
  </div>
}
