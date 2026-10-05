import { useCallback, useEffect, useRef, useState } from "react"
import { FolderOpen, Monitor, Moon, RefreshCw, Save, Sun } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTheme } from "@/components/theme-provider"
import { useDictation } from "@/components/dictation-provider"
import { backend, isBusy, isDesktop, message, type Microphone } from "@/lib/backend"
import { DiagnosticsPanel } from "@/components/diagnostics-panel"
import { BackupPanel } from "@/components/backup-panel"
import { ShortcutInput } from "@/components/shortcut-input"
const themes = [{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "System", icon: Monitor }] as const
const recordingModes = [{ value: "hold", label: "Hold to talk" }, { value: "toggle", label: "Press to start / press to stop" }]
const languages = [{ value: "auto", label: "Detect automatically" }, { value: "en", label: "English" }, { value: "de", label: "German" }, { value: "fr", label: "French" }, { value: "es", label: "Spanish" }, { value: "it", label: "Italian" }, { value: "pt", label: "Portuguese" }, { value: "nl", label: "Dutch" }, { value: "pl", label: "Polish" }, { value: "ja", label: "Japanese" }, { value: "zh", label: "Chinese" }, { value: "uk", label: "Ukrainian" }]
const retentionOptions = [{ value: "0", label: "Keep forever" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]
export function SettingsPage() {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { snapshot, run, loading } = useDictation()
  const [settings, setSettings] = useState(snapshot.settings)
  const savedSettings = useRef(snapshot.settings)
  const [saving, setSaving] = useState(false)
  const [confirmRetention, setConfirmRetention] = useState(false)
  const [microphones, setMicrophones] = useState<Microphone[]>([])
  const [loadingMicrophones, setLoadingMicrophones] = useState(false)
  const [microphoneError, setMicrophoneError] = useState("")
  const [microphonesLoaded, setMicrophonesLoaded] = useState(false)
  const microphoneRequest = useRef(0)
  const busy = isBusy(snapshot.status.phase)
  const controlsDisabled = !isDesktop || busy || saving || loading
  const dirty = JSON.stringify(settings) !== JSON.stringify(snapshot.settings)
  const selectedMicrophoneMissing = microphonesLoaded && !microphoneError && !!settings.microphoneId && !microphones.some(mic => mic.id === settings.microphoneId)
  const microphoneOptions = [
    { value: "", label: "System default" },
    ...microphones.map(mic => ({ value: mic.id, label: mic.name })),
    ...(settings.microphoneId && !microphones.some(mic => mic.id === settings.microphoneId) ? [{ value: settings.microphoneId, label: selectedMicrophoneMissing ? "Selected microphone (disconnected)" : "Selected microphone" }] : []),
  ]
  const refreshMicrophones = useCallback(async () => {
    if (!isDesktop) return
    const request = ++microphoneRequest.current
    setLoadingMicrophones(true)
    setMicrophoneError("")
    try {
      const devices = await backend.microphones()
      if (request === microphoneRequest.current) { setMicrophones(devices); setMicrophonesLoaded(true) }
    } catch (cause) {
      if (request === microphoneRequest.current) setMicrophoneError(message(cause))
    } finally {
      if (request === microphoneRequest.current) setLoadingMicrophones(false)
    }
  }, [])
  useEffect(() => {
    void refreshMicrophones()
    const refresh = () => { void refreshMicrophones() }
    window.addEventListener("focus", refresh)
    return () => { microphoneRequest.current++; window.removeEventListener("focus", refresh) }
  }, [refreshMicrophones])
  useEffect(() => {
    const previous = savedSettings.current
    savedSettings.current = snapshot.settings
    // Adopt backend changes only while the draft still matches its saved baseline.
    setSettings(draft => JSON.stringify(draft) === JSON.stringify(previous) ? snapshot.settings : draft)
  }, [snapshot.settings])
  async function browse(kind: "model" | "runtime") {
    await run(async () => { const path = await backend.selectFile(kind); if (path) setSettings(old => ({ ...old, [kind === "model" ? "modelPath" : "whisperPath"]: path })) }, false)
  }
  async function save(confirmed = false) {
    if (loading || saving || busy) return
    if (!confirmed && settings.historyRetentionDays > 0 && settings.historyRetentionDays !== snapshot.settings.historyRetentionDays) { setConfirmRetention(true); return }
    setSaving(true); setConfirmRetention(false); await run(() => backend.settings(settings)); setSaving(false)
  }
  return <div className="space-y-7">
    <header><h1 className="text-2xl font-semibold tracking-tight">Settings</h1></header>
    <DiagnosticsPanel disabled={dirty || saving || loading} />
    <fieldset disabled={controlsDisabled} className="space-y-6 disabled:opacity-60">
      <section className="settings-section"><h2 className="font-semibold">Text processing</h2><label className="mt-5 flex cursor-pointer items-start gap-3"><Checkbox className="mt-1" disabled={controlsDisabled} checked={settings.cleanText} onCheckedChange={checked => setSettings({ ...settings, cleanText: checked })} /><span className="text-sm">Light cleanup<span className="mt-1 block text-xs text-muted-foreground">Apply local spacing, capitalization, and punctuation rules; remove common English/German filler words. Original transcripts stay in History.</span></span></label></section>
      <section className="settings-section"><h2 className="font-semibold">Startup</h2>
        <label className={`mt-5 flex items-start gap-3 ${snapshot.launchAtLoginAvailable ? "cursor-pointer" : "opacity-60"}`}><Checkbox className="mt-1" disabled={controlsDisabled || !snapshot.launchAtLoginAvailable} checked={settings.launchAtLogin} onCheckedChange={checked => setSettings({ ...settings, launchAtLogin: checked })} /><span className="text-sm">Launch at login</span></label>
        <label className={`mt-5 flex items-start gap-3 ${snapshot.startInTrayAvailable || settings.startInTray ? "cursor-pointer" : "opacity-60"}`}><Checkbox className="mt-1" disabled={controlsDisabled || (!snapshot.startInTrayAvailable && !settings.startInTray)} checked={settings.startInTray} onCheckedChange={checked => setSettings({ ...settings, startInTray: checked })} /><span className="text-sm">Start in tray / menu bar<span className="mt-1 block text-xs text-muted-foreground">Keep the main window hidden on the next launch.</span></span></label>
        {snapshot.status.startupError ? <p role="alert" className="mt-4 text-xs text-destructive">{snapshot.status.startupError}</p> : !snapshot.launchAtLoginAvailable && !snapshot.startInTrayAvailable && <p className="mt-4 text-xs text-muted-foreground">Startup options require a packaged Windows or macOS app.</p>}
      </section>
      <section className="settings-section"><h2 className="font-semibold">Audio input</h2>
        <div className="mt-5 max-w-xl space-y-2"><Label htmlFor="microphone">Microphone</Label>
          <div className="flex gap-2">
            <Select items={microphoneOptions} value={settings.microphoneId} disabled={!isDesktop || busy || saving || loading} onValueChange={value => { if (value !== null) setSettings(old => ({ ...old, microphoneId: value })) }}>
              <SelectTrigger id="microphone" className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background px-3" aria-describedby="microphone-status"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start"><div className="p-1">{microphoneOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</div></SelectContent>
            </Select>
            <Button variant="outline" size="icon" disabled={loadingMicrophones} onClick={() => void refreshMicrophones()} aria-label="Refresh microphones"><RefreshCw className={`size-4 ${loadingMicrophones ? "animate-spin" : ""}`} aria-hidden="true" /></Button>
          </div>
          <p id="microphone-status" role={microphoneError || selectedMicrophoneMissing ? "status" : undefined} className={`text-xs ${microphoneError || selectedMicrophoneMissing ? "text-destructive" : "text-muted-foreground"}`}>
            {microphoneError || (loadingMicrophones ? "Checking microphones…" : selectedMicrophoneMissing ? "Reconnect the selected microphone or choose another input." : microphonesLoaded && microphones.length === 0 ? "No microphones found. Connect one and refresh." : "System default follows your computer’s input setting.")}
          </p>
        </div>
      </section>
      <section className="settings-section"><h2 className="font-semibold">Keyboard & delivery</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="shortcut">Global shortcut</Label><ShortcutInput id="shortcut" value={settings.shortcut} disabled={controlsDisabled} onChange={shortcut => setSettings(old => ({ ...old, shortcut }))} /><p className="text-xs text-muted-foreground">Ctrl, Alt, Shift + Space, A–Z, or F1–F12.</p></div><div className="space-y-2"><Label htmlFor="interaction">Recording mode</Label>
          <Select items={recordingModes} value={settings.interaction} disabled={controlsDisabled} onValueChange={value => { if (value !== null) setSettings(old => ({ ...old, interaction: value })) }}>
            <SelectTrigger id="interaction" className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"><SelectValue /></SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">{recordingModes.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div></div>
        <label className="mt-6 flex cursor-pointer items-start gap-3"><Checkbox className="mt-1" disabled={controlsDisabled} checked={settings.autoPaste} onCheckedChange={checked => setSettings({ ...settings, autoPaste: checked })} /><span className="text-sm">Paste automatically<span className="mt-1 block text-xs text-muted-foreground">Paste into the focused app after shortcut dictation. Otherwise, copy only.</span></span></label>
        {snapshot.status.shortcutError && <p role="alert" className="mt-4 text-xs text-destructive">{snapshot.status.shortcutError}</p>}
      </section>
      <section className="settings-section"><h2 className="font-semibold">Speech recognition</h2><p className="mt-1 text-xs text-muted-foreground">Manage downloads in <Link to="/models" className="text-primary underline">Models</Link>, or select local files below.</p>
        <div className="mt-6 space-y-5">{([{ key: "whisperPath", kind: "runtime", title: "Whisper executable", placeholder: "Select whisper-cli" }, { key: "modelPath", kind: "model", title: "Speech model", placeholder: "Select a ggml Whisper .bin model" }] as const).map(field => <div key={field.key} className="space-y-2"><Label htmlFor={field.key}>{field.title}</Label><div className="flex gap-2"><Input id={field.key} placeholder={field.placeholder} value={settings[field.key]} onChange={event => setSettings({ ...settings, [field.key]: event.target.value })} /><Button variant="outline" aria-label={`Browse ${field.title}`} onClick={() => void browse(field.kind)}><FolderOpen className="size-4" /></Button></div></div>)}
          <div className="max-w-sm space-y-2"><Label htmlFor="language">Spoken language</Label>
            <Select items={languages} value={settings.language} disabled={controlsDisabled} onValueChange={value => { if (value !== null) setSettings(old => ({ ...old, language: value })) }}>
              <SelectTrigger id="language" className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">{languages.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </section>
      <section className="settings-section"><h2 className="font-semibold">History & storage</h2><label className="mt-5 flex cursor-pointer items-start gap-3"><Checkbox className="mt-1" disabled={controlsDisabled} checked={settings.saveAudio} onCheckedChange={checked => setSettings({ ...settings, saveAudio: checked })} /><span className="text-sm">Keep recordings<span className="mt-1 block text-xs text-muted-foreground">Save audio for playback in History. Otherwise, delete it after processing.</span></span></label>
        <div className="mt-5 max-w-sm space-y-2"><Label htmlFor="history-retention">History retention</Label>
          <Select items={retentionOptions} value={String(settings.historyRetentionDays ?? 0)} disabled={controlsDisabled} onValueChange={value => { if (value !== null) setSettings(old => ({ ...old, historyRetentionDays: Number(value) })) }}>
            <SelectTrigger id="history-retention" className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"><SelectValue /></SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">{retentionOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Automatically delete older transcripts and retained audio on startup, after dictation, and when saving settings.</p></div>
        {snapshot.status.historyError && <p role="alert" className="mt-3 text-xs text-destructive">{snapshot.status.historyError}</p>}
        {snapshot.dataDir && <p className="mt-5 break-all text-xs leading-5 text-muted-foreground">Data folder: <span className="font-mono">{snapshot.dataDir}</span></p>}</section>
      <div className="flex items-center gap-4"><Button disabled={(!dirty && !(settings.launchAtLogin && snapshot.launchAtLoginAvailable)) || saving || (selectedMicrophoneMissing && settings.microphoneId !== snapshot.settings.microphoneId)} className="rounded-lg" onClick={() => void save()}><Save className="size-4" />{saving ? "Saving…" : "Save settings"}</Button>{dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}</div>
    </fieldset>
    <BackupPanel disabled={controlsDisabled || dirty} unsaved={dirty} />
    <section className="settings-section"><h2 className="mb-4 font-semibold">Setup</h2><Button variant="outline" disabled={!isDesktop || busy || saving || dirty} onClick={() => void run(async () => { await backend.restartSetup(); navigate("/") })}>Run setup</Button>{dirty && <p className="mt-2 text-xs text-muted-foreground">Save settings before running setup.</p>}</section>
    <section className="settings-section"><h2 className="mb-4 font-semibold">Appearance</h2><div className="flex gap-3" role="group" aria-label="Color theme">{themes.map(({ value, label, icon: Icon }) => <Button key={value} variant={theme === value ? "default" : "outline"} onClick={() => setTheme(value)} aria-pressed={theme === value}><Icon className="size-4" />{label}</Button>)}</div></section>
    <Dialog open={confirmRetention} disablePointerDismissal onOpenChange={setConfirmRetention}><DialogContent><DialogHeader><DialogTitle>Enable automatic deletion?</DialogTitle><DialogDescription>Saving removes transcripts and retained audio older than {settings.historyRetentionDays} days now and during future cleanup. Deletion is permanent.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmRetention(false)}>Cancel</Button><Button variant="destructive" disabled={busy || saving} onClick={() => void save(true)}>Save and delete older history</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
