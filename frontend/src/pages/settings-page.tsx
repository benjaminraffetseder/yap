import { AudioSupportPanel } from "@/components/audio-support-panel";
import { BackupPanel } from "@/components/backup-panel";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { useDictation } from "@/components/dictation-provider";
import { SettingRow, SettingsSection, ToggleSetting } from "@/components/settings-section";
import { ShortcutInput } from "@/components/shortcut-input";
import { ShortcutStatus } from "@/components/shortcut-status";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import { backend, isBusy, isDesktop, message, type Microphone } from "@/lib/backend";
import { FolderOpen, Monitor, Moon, RefreshCw, Save, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
const sections = [
  { value: "dictation", label: "Dictation" },
  { value: "general", label: "General" },
  { value: "history", label: "History & data" },
  { value: "advanced", label: "Advanced" },
];
const themes = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;
const recordingModes = [
  { value: "hold", label: "Hold to talk" },
  { value: "toggle", label: "Press to start / press to stop" },
];
const languages = [
  { value: "auto", label: "Detect automatically" },
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
  { value: "uk", label: "Ukrainian" },
];
const retentionOptions = [
  { value: "0", label: "Keep forever" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];
export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sections.some((item) => item.value === searchParams.get("section"))
    ? searchParams.get("section")!
    : "dictation";
  const { theme, setTheme } = useTheme();
  const { snapshot, run, refresh, clearError, loading } = useDictation();
  const [settings, setSettings] = useState(snapshot.settings);
  const savedSettings = useRef(snapshot.settings);
  const [saving, setSaving] = useState(false);
  const [confirmRetention, setConfirmRetention] = useState(false);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [loadingMicrophones, setLoadingMicrophones] = useState(false);
  const [microphoneError, setMicrophoneError] = useState("");
  const [microphonesLoaded, setMicrophonesLoaded] = useState(false);
  const microphoneRequest = useRef(0);
  const busy = isBusy(snapshot.status.phase);
  const controlsDisabled = !isDesktop || busy || saving || loading;
  const dirty = JSON.stringify(settings) !== JSON.stringify(snapshot.settings);
  const selectedMicrophoneMissing =
    microphonesLoaded &&
    !microphoneError &&
    !!settings.microphoneId &&
    !microphones.some((mic) => mic.id === settings.microphoneId);
  const microphoneOptions = [
    { value: "", label: "System default" },
    ...microphones.map((mic) => ({ value: mic.id, label: mic.name })),
    ...(settings.microphoneId && !microphones.some((mic) => mic.id === settings.microphoneId)
      ? [
          {
            value: settings.microphoneId,
            label: selectedMicrophoneMissing
              ? "Selected microphone (disconnected)"
              : "Selected microphone",
          },
        ]
      : []),
  ];
  const refreshMicrophones = useCallback(async () => {
    if (!isDesktop) return;
    const request = ++microphoneRequest.current;
    setLoadingMicrophones(true);
    setMicrophoneError("");
    try {
      const devices = await backend.microphones();
      if (request === microphoneRequest.current) {
        setMicrophones(devices);
        setMicrophonesLoaded(true);
      }
    } catch (cause) {
      if (request === microphoneRequest.current) setMicrophoneError(message(cause));
    } finally {
      if (request === microphoneRequest.current) setLoadingMicrophones(false);
    }
  }, []);
  useEffect(() => {
    void refreshMicrophones();
    const refresh = () => {
      void refreshMicrophones();
    };
    window.addEventListener("focus", refresh);
    return () => {
      microphoneRequest.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [refreshMicrophones]);
  useEffect(() => {
    const previous = savedSettings.current;
    savedSettings.current = snapshot.settings;
    // Adopt backend changes only while the draft still matches its saved baseline.
    setSettings((draft) =>
      JSON.stringify(draft) === JSON.stringify(previous) ? snapshot.settings : draft,
    );
  }, [snapshot.settings]);
  async function browse(kind: "model" | "runtime") {
    await run(async () => {
      const path = await backend.selectFile(kind);
      if (path)
        setSettings((old) => ({
          ...old,
          [kind === "model" ? "modelPath" : "whisperPath"]: path,
        }));
    }, false);
  }
  async function save(confirmed = false) {
    if (loading || saving || busy) return;
    if (
      !confirmed &&
      settings.historyRetentionDays > 0 &&
      settings.historyRetentionDays !== snapshot.settings.historyRetentionDays
    ) {
      setConfirmRetention(true);
      return;
    }
    setSaving(true);
    setConfirmRetention(false);
    clearError();
    toastManager.close("settings-save");
    try {
      await backend.settings(settings);
      await refresh();
      toastManager.add({
        id: "settings-save",
        type: "success",
        title: "Settings saved.",
      });
    } catch (cause) {
      toastManager.add({
        id: "settings-save",
        type: "error",
        title: message(cause),
        priority: "high",
        timeout: 8000,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="@container space-y-5">
      <Tabs
        value={section}
        onValueChange={(value) => {
          if (typeof value === "string")
            setSearchParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("section", value);
                return next;
              },
              { replace: true },
            );
        }}
        className="gap-5"
      >
        <header
          aria-label="Settings"
          className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 bg-background py-2"
        >
          <TabsList
            aria-label="Settings sections"
            className="max-w-full group-data-[orientation=horizontal]/tabs:h-10"
          >
            {sections.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="px-2.5">
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {dirty && (
              <>
                <span role="status" className="text-xs text-muted-foreground">
                  Unsaved changes
                </span>
                <Button
                  variant="ghost"
                  disabled={controlsDisabled}
                  onClick={() => setSettings(snapshot.settings)}
                >
                  Discard changes
                </Button>
              </>
            )}
            <Button
              disabled={
                controlsDisabled ||
                (!dirty && !(settings.launchAtLogin && snapshot.launchAtLoginAvailable)) ||
                (selectedMicrophoneMissing &&
                  settings.microphoneId !== snapshot.settings.microphoneId)
              }
              onClick={() => void save()}
            >
              <Save aria-hidden="true" className="size-4" />
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </header>
        <TabsContent value="dictation" keepMounted>
          <fieldset disabled={controlsDisabled} className="space-y-5 disabled:opacity-60">
            <SettingsSection title="Recording">
              <SettingRow title="Microphone" htmlFor="microphone">
                <div className="flex gap-2">
                  <Select
                    items={microphoneOptions}
                    value={settings.microphoneId}
                    disabled={controlsDisabled}
                    onValueChange={(value) => {
                      if (value !== null) setSettings((old) => ({ ...old, microphoneId: value }));
                    }}
                  >
                    <SelectTrigger
                      id="microphone"
                      className="h-9 w-full min-w-0 bg-background"
                      aria-describedby="microphone-status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} align="start">
                      {microphoneOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={loadingMicrophones}
                    onClick={() => void refreshMicrophones()}
                    aria-label="Refresh microphones"
                  >
                    <RefreshCw
                      className={`size-4 ${loadingMicrophones ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                  </Button>
                </div>
                <p
                  id="microphone-status"
                  role={microphoneError || selectedMicrophoneMissing ? "status" : undefined}
                  className={`mt-2 text-xs ${microphoneError || selectedMicrophoneMissing ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {microphoneError ||
                    (loadingMicrophones
                      ? "Checking microphones…"
                      : selectedMicrophoneMissing
                        ? "Reconnect the selected microphone or choose another input."
                        : microphonesLoaded && microphones.length === 0
                          ? "No microphones found. Connect one and refresh."
                          : "System default follows your computer’s input setting.")}
                </p>
              </SettingRow>
              <SettingRow title="Spoken language" htmlFor="language">
                <Select
                  items={languages}
                  value={settings.language}
                  disabled={controlsDisabled}
                  onValueChange={(value) => {
                    if (value !== null) setSettings((old) => ({ ...old, language: value }));
                  }}
                >
                  <SelectTrigger id="language" className="h-9 w-full min-w-0 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    {languages.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow
                title="Global shortcut"
                htmlFor="shortcut"
                description="Use Ctrl, Alt, or Shift with Space, a letter, or F1–F12."
              >
                <ShortcutInput
                  id="shortcut"
                  value={settings.shortcut}
                  disabled={controlsDisabled}
                  onChange={(shortcut) => setSettings((old) => ({ ...old, shortcut }))}
                />
                <ShortcutStatus disabled={controlsDisabled} />
              </SettingRow>
              <SettingRow title="Recording mode" htmlFor="interaction">
                <Select
                  items={recordingModes}
                  value={settings.interaction}
                  disabled={controlsDisabled}
                  onValueChange={(value) => {
                    if (value !== null) setSettings((old) => ({ ...old, interaction: value }));
                  }}
                >
                  <SelectTrigger id="interaction" className="h-9 w-full min-w-0 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    {recordingModes.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </SettingsSection>
            <SettingsSection title="Text & delivery">
              <ToggleSetting
                title="Light cleanup"
                description="Fix spacing, capitalization, and punctuation; remove common English/German fillers. Keep the original in History."
                checked={settings.cleanText}
                disabled={controlsDisabled}
                onCheckedChange={(cleanText) => setSettings((old) => ({ ...old, cleanText }))}
              />
              <ToggleSetting
                title="Paste automatically"
                description="Paste into the focused app after shortcut dictation. Otherwise, copy only."
                checked={settings.autoPaste}
                disabled={controlsDisabled}
                onCheckedChange={(autoPaste) => setSettings((old) => ({ ...old, autoPaste }))}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <span className="text-sm text-muted-foreground">
                  LLM instructions and generated outputs
                </span>
                <Link
                  to="/prompts?section=prompts"
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  Manage prompts
                </Link>
              </div>
            </SettingsSection>
          </fieldset>
        </TabsContent>
        <TabsContent value="general" keepMounted className="space-y-5">
          <SettingsSection title="Appearance">
            <SettingRow title="Color theme" description="Applies immediately.">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Color theme">
                {themes.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant={theme === value ? "default" : "outline"}
                    onClick={() => setTheme(value)}
                    aria-pressed={theme === value}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </SettingRow>
          </SettingsSection>
          <fieldset disabled={controlsDisabled} className="disabled:opacity-60">
            <SettingsSection title="Startup">
              <ToggleSetting
                title="Launch at login"
                checked={settings.launchAtLogin}
                disabled={controlsDisabled || !snapshot.launchAtLoginAvailable}
                onCheckedChange={(launchAtLogin) =>
                  setSettings((old) => ({ ...old, launchAtLogin }))
                }
              />
              <ToggleSetting
                title="Start in tray / menu bar"
                description="Keep the main window hidden on the next launch."
                checked={settings.startInTray}
                disabled={
                  controlsDisabled || (!snapshot.startInTrayAvailable && !settings.startInTray)
                }
                onCheckedChange={(startInTray) => setSettings((old) => ({ ...old, startInTray }))}
              />
              {snapshot.status.startupError ? (
                <p role="alert" className="py-4 text-xs text-destructive">
                  {snapshot.status.startupError}
                </p>
              ) : (
                !snapshot.launchAtLoginAvailable &&
                !snapshot.startInTrayAvailable && (
                  <p className="py-4 text-xs text-muted-foreground">
                    Startup options require a packaged Windows or macOS app.
                  </p>
                )
              )}
            </SettingsSection>
          </fieldset>
        </TabsContent>
        <TabsContent value="history" keepMounted className="space-y-5">
          <fieldset disabled={controlsDisabled} className="disabled:opacity-60">
            <SettingsSection title="History">
              <ToggleSetting
                title="Keep recordings"
                description="Save audio for playback in History. Otherwise, delete it after processing."
                checked={settings.saveAudio}
                disabled={controlsDisabled}
                onCheckedChange={(saveAudio) => setSettings((old) => ({ ...old, saveAudio }))}
              />
              <SettingRow
                title="History retention"
                htmlFor="history-retention"
                description="Automatically delete older transcripts and retained audio."
              >
                <Select
                  items={retentionOptions}
                  value={String(settings.historyRetentionDays ?? 0)}
                  disabled={controlsDisabled}
                  onValueChange={(value) => {
                    if (value !== null)
                      setSettings((old) => ({
                        ...old,
                        historyRetentionDays: Number(value),
                      }));
                  }}
                >
                  <SelectTrigger
                    id="history-retention"
                    className="h-9 w-full min-w-0 bg-background"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    {retentionOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              {snapshot.status.historyError && (
                <p role="alert" className="py-4 text-xs text-destructive">
                  {snapshot.status.historyError}
                </p>
              )}
            </SettingsSection>
          </fieldset>
          <BackupPanel disabled={controlsDisabled || dirty} unsaved={dirty} />
          {snapshot.dataDir && (
            <SettingsSection title="Local storage">
              <SettingRow title="Data folder">
                <p className="break-all font-mono text-xs leading-5 text-muted-foreground">
                  {snapshot.dataDir}
                </p>
              </SettingRow>
            </SettingsSection>
          )}
        </TabsContent>
        <TabsContent value="advanced" keepMounted className="space-y-5">
          <fieldset disabled={controlsDisabled} className="disabled:opacity-60">
            <SettingsSection title="Local speech files">
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <span className="text-sm text-muted-foreground">
                  Download and switch speech models
                </span>
                <Link
                  to="/models"
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  Manage models
                </Link>
              </div>
              {(
                [
                  {
                    key: "whisperPath",
                    kind: "runtime",
                    title: "Whisper executable",
                    placeholder: "Select whisper-cli",
                  },
                  {
                    key: "modelPath",
                    kind: "model",
                    title: "Speech model",
                    placeholder: "Select a ggml Whisper .bin model",
                  },
                ] as const
              ).map((field) => (
                <SettingRow key={field.key} title={field.title} htmlFor={field.key}>
                  <div className="flex gap-2">
                    <Input
                      id={field.key}
                      placeholder={field.placeholder}
                      value={settings[field.key]}
                      onChange={(event) =>
                        setSettings((old) => ({
                          ...old,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Browse ${field.title}`}
                      onClick={() => void browse(field.kind)}
                    >
                      <FolderOpen aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </SettingRow>
              ))}
            </SettingsSection>
          </fieldset>
          <AudioSupportPanel active={section === "advanced"} disabled={saving || loading} />
          <DiagnosticsPanel disabled={dirty || saving || loading} />
          <SettingsSection title="Setup">
            <SettingRow
              title="Run setup again"
              description="Revisit model installation, microphone testing, and your shortcut."
            >
              <Button
                variant="outline"
                disabled={controlsDisabled || dirty}
                onClick={() =>
                  void run(async () => {
                    await backend.restartSetup();
                    navigate("/");
                  })
                }
              >
                Run setup
              </Button>
              {dirty && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Save settings before running setup.
                </p>
              )}
            </SettingRow>
          </SettingsSection>
        </TabsContent>
      </Tabs>
      <Dialog open={confirmRetention} disablePointerDismissal onOpenChange={setConfirmRetention}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable automatic deletion?</DialogTitle>
            <DialogDescription>
              Saving removes transcripts and retained audio older than{" "}
              {settings.historyRetentionDays} days now and during future cleanup. Deletion is
              permanent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRetention(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || saving || loading}
              onClick={() => void save(true)}
            >
              Save and delete older history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
