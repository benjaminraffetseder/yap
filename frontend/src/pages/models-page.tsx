import { Check, Download, HardDrive, Loader2, X } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { useDictation } from "@/components/dictation-provider"
import { backend, isBusy, isDesktop } from "@/lib/backend"
export function ModelsPage({ embedded = false }: { embedded?: boolean }) {
  const { snapshot, run } = useDictation()
  const { status, settings, models } = snapshot
  const downloading = status.phase === "downloading"
  const busy = isBusy(status.phase)
  return <div className="space-y-8">
    {!embedded && <header><h1 className="text-2xl font-semibold tracking-tight">Models</h1></header>}
    {downloading && <section aria-live="polite" className="rounded-2xl border bg-card p-5"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin text-primary" />{status.message}</span><Button size="sm" variant="ghost" onClick={() => void run(backend.cancel)}><X className="size-3" />Cancel</Button></div><progress className="mt-4 h-2 w-full accent-[var(--primary)]" max={1} value={status.progress} /><p className="mt-2 text-xs text-muted-foreground">{Math.round(status.progress * 100)}%</p></section>}
    {status.phase === "error" && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm whitespace-pre-wrap text-destructive">{status.message}</p>}
    <div className="grid gap-4 lg:grid-cols-3">{models.map(model => {
      const selected = settings.modelPath === model.path && model.installed
      return <section key={model.id} className={`flex flex-col rounded-2xl border bg-card p-5 ${selected ? "border-primary/40 ring-1 ring-primary/15" : ""}`}>
        <HardDrive className="mb-5 size-6 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">{model.name}</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">{model.description}</p><p className="my-5 text-xs text-muted-foreground">{Math.round(model.size / 1_000_000)} MB</p>
        <Button className="mt-auto rounded-lg" variant={selected ? "outline" : "default"} disabled={!isDesktop || busy || selected} onClick={() => void run(() => model.installed ? backend.settings({ ...settings, modelPath: model.path }) : backend.install(model.id))}>{selected ? <><Check className="size-4" />Active</> : model.installed ? "Use model" : <><Download className="size-4" />Download & use</>}</Button>
      </section>
    })}</div>
    <p className="text-xs text-muted-foreground">For custom models or an existing installation, select local files in <Link className="text-primary underline" to="/settings">Settings</Link>.</p>
  </div>
}
