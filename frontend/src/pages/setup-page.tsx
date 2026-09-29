import { useEffect, useState } from "react"
import { Check, RefreshCw } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { ShortcutInput } from "@/components/shortcut-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDictation } from "@/components/dictation-provider"
import { backend, isBusy, type Microphone } from "@/lib/backend"
import { ModelsPage } from "@/pages/models-page"

export function SetupPage() {
  const { snapshot, run, level } = useDictation()
  const [step, setStep] = useState(0)
  const [microphones, setMicrophones] = useState<Microphone[]>([])
  const [mic, setMic] = useState(snapshot.settings.microphoneId)
  const [shortcut, setShortcut] = useState(snapshot.settings.shortcut)
  const [pending, setPending] = useState(false)
  const testing = snapshot.status.phase === "mic-test"
  const busy = isBusy(snapshot.status.phase)
  useEffect(() => { if (step === 1) void run(async () => setMicrophones(await backend.microphones()), false) }, [step]) // Fetch only when this step opens.
  const options = [{ value: "", label: "System default" }, ...microphones.map(device => ({ value: device.id, label: device.name })), ...(mic && !microphones.some(device => device.id === mic) ? [{ value: mic, label: "Selected microphone (disconnected)" }] : [])]
  async function action(work: () => Promise<unknown>) { setPending(true); await run(work); setPending(false) }
  const micPassed = snapshot.microphoneTested && mic === snapshot.settings.microphoneId
  const shortcutPassed = snapshot.shortcutTested && shortcut === snapshot.settings.shortcut && !snapshot.status.shortcutError
  return <div className="space-y-7">
    <header><h1 className="text-2xl font-semibold tracking-tight">Set up Yap</h1></header>
    <ol aria-label="Setup steps" className="flex gap-5 text-sm">{["Speech model", "Microphone", "Shortcut"].map((title, index) => <li key={title} aria-current={index === step ? "step" : undefined} className={index === step ? "font-semibold text-primary" : "text-muted-foreground"}>{index + 1}. {title}</li>)}</ol>
    {step === 0 && <><ModelsPage embedded />{snapshot.ready && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Check className="size-4" />Speech model ready</p>}</>}
    {step === 1 && <section className="settings-section space-y-5">
      <h2 className="font-semibold">Test your microphone</h2>
      <div className="max-w-xl space-y-2"><Label htmlFor="setup-microphone">Microphone</Label><div className="flex gap-2">
        <Select items={options} value={mic} disabled={busy || pending} onValueChange={value => { if (value !== null) setMic(value) }}><SelectTrigger id="setup-microphone" className="w-full"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" size="icon" aria-label="Refresh microphones" disabled={busy || pending} onClick={() => void action(async () => setMicrophones(await backend.microphones()))}><RefreshCw className="size-4" /></Button>
      </div></div>
      <p className="text-sm text-muted-foreground">Speak for a few seconds. Test audio is deleted and never transcribed.</p>
      <p className="text-xs text-muted-foreground">To test transcription too, open <Link className="text-primary underline" to="/settings">dictation diagnostics in Settings</Link>.</p>
      {testing && <div className="space-y-2"><meter aria-label="Microphone level" className="h-4 w-full" min={0} max={1} value={level} /><p role="status" className="text-sm">{snapshot.status.message}</p></div>}
      {!testing && <p role="status" className={`text-sm ${micPassed ? "text-primary" : "text-muted-foreground"}`}>{micPassed ? "Microphone test passed" : snapshot.status.message !== "Ready when you are" ? snapshot.status.message : ""}</p>}
      <Button disabled={pending || (busy && !testing)} onClick={() => void action(async () => { if (testing) return backend.stopMicTest(); if (mic !== snapshot.settings.microphoneId) await backend.settings({ ...snapshot.settings, microphoneId: mic }); await backend.testMic() })}>{testing ? "Stop test" : "Test microphone"}</Button>
    </section>}
    {step === 2 && <section className="settings-section space-y-5">
      <h2 className="font-semibold">Test your shortcut</h2>
      <div className="max-w-lg space-y-2"><Label htmlFor="setup-shortcut">Global shortcut</Label><div className="flex gap-2"><ShortcutInput id="setup-shortcut" value={shortcut} disabled={busy || pending} onChange={setShortcut} /><Button variant="outline" disabled={busy || pending || shortcut === snapshot.settings.shortcut} onClick={() => void action(() => backend.settings({ ...snapshot.settings, shortcut }))}>Apply shortcut</Button></div></div>
      <p className="text-sm text-muted-foreground">Press <kbd className="rounded border px-2 py-1">{snapshot.settings.shortcut}</kbd> once. During setup, the shortcut confirms it works without starting a recording.</p>
      <p className="text-xs text-muted-foreground">Ctrl, Alt, Shift + Space, A–Z, or F1–F12. Change hold/toggle mode in <Link className="underline" to="/settings">Settings</Link>.</p>
      {snapshot.status.shortcutError && <p role="alert" className="text-sm text-destructive">{snapshot.status.shortcutError}</p>}
      {shortcutPassed && <p role="status" className="text-sm text-primary">Shortcut test passed</p>}
    </section>}
    <div className="flex flex-wrap items-center gap-3">
      {step > 0 && <Button variant="outline" disabled={busy || pending} onClick={() => setStep(step - 1)}>Back</Button>}
      {step < 2 ? <Button disabled={busy || pending || (step === 0 ? !snapshot.ready : !micPassed)} onClick={() => setStep(step + 1)}>Next</Button> : <Button disabled={busy || pending || !shortcutPassed} onClick={() => void action(() => backend.completeSetup(false))}>Finish setup</Button>}
      <Button variant="ghost" disabled={busy || pending} onClick={() => void action(() => backend.completeSetup(true))}>Skip setup</Button>
    </div>
  </div>
}
