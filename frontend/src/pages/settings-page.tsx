import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { AudioSupportPanel } from "@/components/audio-support-panel";
import { AutoSaveStatus } from "@/components/auto-save-status";
import { BackupPanel } from "@/components/backup-panel";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ProfilesPanel } from "@/components/dictation-profiles";
import { useDictation } from "@/components/dictation-provider";
import { ProfileSettingIndicator } from "@/components/profile-setting-indicator";
import { SectionTabs } from "@/components/section-tabs";
import { SettingRow, SettingsSection, ToggleSetting } from "@/components/settings-section";
import { ShortcutInput } from "@/components/shortcut-input";
import { ShortcutStatus } from "@/components/shortcut-status";
import { useTheme } from "@/components/theme-provider";
import { languages as interfaceLanguages } from "@/i18n";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import { UpdatePanel } from "@/components/update-panel";
import { backend, isBusy, isDesktop, message, type Microphone } from "@/lib/backend";
import { useLanguages } from "@/lib/languages";
import { useAutoSave } from "@/lib/use-auto-save";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  FolderOpen,
  Keyboard,
  Mic,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Type,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

const shortcutKeys = (value: string) =>
  value
    .split("+")
    .map((key) => key.trim().toLowerCase())
    .sort()
    .join("+");
const sameShortcut = (left: string, right: string) =>
  !!left.trim() && shortcutKeys(left) === shortcutKeys(right);
export function SettingsPage() {
  const languages = useLanguages();
  const { t, i18n } = useTranslation();
  const sections = [
    { value: "dictation", label: t("historyEntryPage.dictation") },
    { value: "profiles", label: t("settingsPage.profiles") },
    { value: "general", label: t("settingsPage.general") },
    { value: "history", label: t("settingsPage.historyData") },
    { value: "advanced", label: t("settingsPage.advanced") },
  ];
  const themes = [
    { value: "light", label: t("settingsPage.light"), icon: Sun },
    { value: "dark", label: t("settingsPage.dark"), icon: Moon },
    { value: "system", label: t("settingsPage.system"), icon: Monitor },
  ] as const;
  const recordingModes = [
    { value: "hold", label: t("settingsPage.holdToTalk") },
    { value: "toggle", label: t("settingsPage.pressToStartPressToStop") },
  ];
  const retentionOptions = [
    { value: "0", label: t("settingsPage.keepForever") },
    { value: "7", label: t("settingsPage.7Days") },
    { value: "30", label: t("settingsPage.30Days") },
    { value: "90", label: t("settingsPage.90Days") },
  ];

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sections.some((item) => item.value === searchParams.get("section"))
    ? searchParams.get("section")!
    : "dictation";
  const { theme, setTheme } = useTheme();
  const { snapshot, run, refresh, clearError, loading } = useDictation();
  const [settings, setSettings, settingsDraft] = useSavedDraft("settings", snapshot.settings);
  const savedProfileShortcut = snapshot.profileShortcut ?? "";
  const [profileShortcut, setProfileShortcut, shortcutDraft] = useSavedDraft(
    "profile-shortcut",
    savedProfileShortcut,
  );
  const [editingText, setEditingText] = useState(false);
  const [confirmRetention, setConfirmRetention] = useState(false);
  const retentionApproved = useRef(false);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [loadingMicrophones, setLoadingMicrophones] = useState(false);
  const [microphoneError, setMicrophoneError] = useState("");
  const [microphonesLoaded, setMicrophonesLoaded] = useState(false);
  const microphoneRequest = useRef(0);
  const busy = isBusy(snapshot.status.phase);
  const controlsDisabled = !isDesktop || busy || loading;
  const focusedDesktopRequest = useRef<string | null>(null);
  useEffect(() => {
    const target = searchParams.get("focus");
    if (
      section !== "dictation" ||
      controlsDisabled ||
      !["shortcut", "profile-cycle-shortcut"].includes(target ?? "") ||
      focusedDesktopRequest.current === location.key
    )
      return;
    const frame = requestAnimationFrame(() => {
      const field = document.getElementById(target!);
      if (field) {
        field.focus();
        focusedDesktopRequest.current = location.key;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [section, controlsDisabled, searchParams, location.key]);
  const settingsDirty = settingsDraft.dirty;
  const profileShortcutDirty = shortcutDraft.dirty;
  const dirty = settingsDirty || profileShortcutDirty;
  const draftKey = JSON.stringify([settings, profileShortcut]);
  const retentionNeedsConfirm =
    settings.historyRetentionDays > 0 &&
    settings.historyRetentionDays !== snapshot.settings.historyRetentionDays;
  const selectedMicrophoneMissing =
    microphonesLoaded &&
    !microphoneError &&
    !!settings.microphoneId &&
    !microphones.some((mic) => mic.id === settings.microphoneId);
  const microphoneOptions = [
    { value: "", label: t("settingsPage.systemDefault") },
    ...microphones.map((mic) => ({ value: mic.id, label: mic.name })),
    ...(settings.microphoneId && !microphones.some((mic) => mic.id === settings.microphoneId)
      ? [
          {
            value: settings.microphoneId,
            label: selectedMicrophoneMissing
              ? t("settingsPage.selectedMicrophoneDisconnected")
              : t("settingsPage.selectedMicrophone"),
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
  async function save() {
    if (loading || busy) return false;
    if (!retentionApproved.current && retentionNeedsConfirm) {
      setConfirmRetention(true);
      return false;
    }
    retentionApproved.current = false;
    setConfirmRetention(false);
    clearError();
    toastManager.close("settings-save");
    const saveSettings = () => backend.settings(settings);
    const saveProfileShortcut = () =>
      backend.saveProfileAutomation(snapshot.appProfileRules ?? [], profileShortcut);
    // Each save rejects a shortcut the other one still holds, so free the
    // recording shortcut's new combination first when it was the profile one.
    const steps = !profileShortcutDirty
      ? [saveSettings]
      : !settingsDirty
        ? [saveProfileShortcut]
        : sameShortcut(settings.shortcut, savedProfileShortcut)
          ? [saveProfileShortcut, saveSettings]
          : [saveSettings, saveProfileShortcut];
    try {
      if (profileShortcut.trim() && sameShortcut(profileShortcut, settings.shortcut))
        throw new Error(t("settingsPage.recordingAndProfileCyclingMustUseDifferentShortcuts"));
      for (const step of steps) await step();
      settingsDraft.markSubmitted(settings);
      shortcutDraft.markSubmitted(profileShortcut);
      await refresh();
    } catch (cause) {
      await refresh().catch(() => {});
      toastManager.add({
        id: "settings-save",
        type: "error",
        title: message(cause),
        priority: "high",
        timeout: 8000,
      });
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    draftKey,
    dirty,
    canSave:
      isDesktop &&
      !loading &&
      !busy &&
      !(selectedMicrophoneMissing && settings.microphoneId !== snapshot.settings.microphoneId),
    save,
    delay: 400,
    waitForBlur: editingText,
  });
  const saving = autoSave.saving;
  function cancelRetention() {
    setConfirmRetention(false);
    setSettings((old) => ({
      ...old,
      historyRetentionDays: snapshot.settings.historyRetentionDays,
    }));
  }
  function discard() {
    setSettings(snapshot.settings);
    setProfileShortcut(savedProfileShortcut);
  }
  const textInput = (target: EventTarget): target is HTMLInputElement =>
    target instanceof HTMLInputElement && !["checkbox", "radio", "hidden"].includes(target.type);
  return (
    <div
      className={cn(
        "@container/settings space-y-6 [&_fieldset]:min-w-0",
        "[&_[data-slot=settings-section]]:min-w-0 [&_[data-slot=settings-section]]:p-5",
        "[&_[data-slot=settings-section-heading]]:border-b-0 [&_[data-slot=settings-section-heading]]:p-0 [&_[data-slot=settings-section-heading]]:pb-1.5",
        "[&_[data-slot=settings-section-content]]:px-0 [&_[data-slot=setting-row]]:items-center",
        "[&_[data-slot=select-trigger]]:h-auto [&_[data-slot=select-trigger]]:min-h-9 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:max-w-full [&_[data-slot=select-trigger]]:whitespace-normal",
        "[&_[data-slot=select-value]]:flex [&_[data-slot=select-value]]:whitespace-normal [&_[data-slot=select-value]]:[overflow-wrap:anywhere] [&_[data-slot=select-value]]:[-webkit-line-clamp:unset]",
        "[&_[data-slot=settings-profiles]>[data-slot=settings-section]]:border-0 [&_[data-slot=settings-profiles]>[data-slot=settings-section]]:bg-transparent [&_[data-slot=settings-profiles]>[data-slot=settings-section]]:p-0",
        "@max-[24rem]/settings:[&_[data-slot=settings-section]]:p-3 @max-[24rem]/settings:[&_[data-slot=settings-section]]:[overflow-wrap:anywhere]",
        "@max-[24rem]/settings:[&_[data-slot=button]]:h-auto @max-[24rem]/settings:[&_[data-slot=button]]:min-h-9 @max-[24rem]/settings:[&_[data-slot=button]]:max-w-full @max-[24rem]/settings:[&_[data-slot=button]]:whitespace-normal @max-[24rem]/settings:[&_[data-slot=button]]:[overflow-wrap:anywhere]",
      )}
      onFocusCapture={(event) => {
        if (textInput(event.target) && event.currentTarget.contains(event.target))
          setEditingText(true);
      }}
      onBlurCapture={(event) => {
        if (textInput(event.target)) setEditingText(false);
      }}
      onKeyDownCapture={(event) => {
        if (
          event.key === "Enter" &&
          textInput(event.target) &&
          event.currentTarget.contains(event.target)
        )
          event.target.blur();
      }}
    >
      <header
        aria-label={t("common.settings")}
        className="flex min-w-0 flex-wrap items-center justify-between gap-4"
      >
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold tracking-tight">{t("common.settings")}</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("settingsPage.configureDictationAppearanceAndLocalData")}
          </p>
        </div>
        <AutoSaveStatus
          status={autoSave.status}
          retry={autoSave.retry}
          discard={discard}
          disabled={controlsDisabled}
        />
      </header>
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
        <SectionTabs
          label={t("settingsPage.settingsSections")}
          sections={sections}
          className="@min-[42rem]/settings:sticky @min-[42rem]/settings:top-0 @min-[42rem]/settings:z-20"
        />
        <TabsContent value="dictation" keepMounted className="space-y-5">
          <fieldset disabled={controlsDisabled} className="space-y-5 disabled:opacity-60">
            <SettingsSection
              title={t("homePage.recording")}
              icon={<Mic aria-hidden="true" className="size-4 text-muted-foreground" />}
            >
              <SettingRow
                title={t("settingsPage.microphone")}
                htmlFor="microphone"
                description={t("settingsPage.chooseTheInputForYourNextDictation")}
              >
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
                    aria-label={t("settingsPage.refreshMicrophones")}
                  >
                    <RefreshCw
                      className={`size-4 ${loadingMicrophones ? "animate-spin motion-reduce:animate-none" : ""}`}
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
                      ? t("settingsPage.checkingMicrophones")
                      : selectedMicrophoneMissing
                        ? t("settingsPage.reconnectTheSelectedMicrophoneOrChooseAnother")
                        : microphonesLoaded && microphones.length === 0
                          ? t("settingsPage.noMicrophonesFoundConnectOneAndRefresh")
                          : t("settingsPage.systemDefaultFollowsYourComputerSInput"))}
                </p>
              </SettingRow>
              <SettingRow
                title={t("settingsPage.spokenLanguage")}
                htmlFor="language"
                description={t("settingsPage.chooseALanguageOrLetTheSpeech")}
                indicator={<ProfileSettingIndicator field="language" value={settings.language} />}
              >
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
            </SettingsSection>
            <SettingsSection
              title={t("settingsPage.shortcuts")}
              icon={<Keyboard aria-hidden="true" className="size-4 text-muted-foreground" />}
            >
              <SettingRow
                title={t("settingsPage.globalShortcut")}
                htmlFor="shortcut"
                description={t("settingsPage.startsDictationFromAnyAppUseCtrl")}
              >
                <ShortcutInput
                  id="shortcut"
                  value={settings.shortcut}
                  disabled={controlsDisabled}
                  onChange={(shortcut) => setSettings((old) => ({ ...old, shortcut }))}
                />
                <ShortcutStatus disabled={controlsDisabled} />
              </SettingRow>
              <SettingRow
                title={t("settingsPage.recordingMode")}
                htmlFor="interaction"
                description={t("settingsPage.howTheGlobalShortcutStartsAndStops")}
              >
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
              <SettingRow
                title={t("settingsPage.cycleProfilesShortcut")}
                htmlFor="profile-cycle-shortcut"
                description={t("settingsPage.optionalSwitchesToTheNextAvailableProfile")}
              >
                <ShortcutInput
                  id="profile-cycle-shortcut"
                  recordLabel={t("settingsPage.recordProfileShortcut")}
                  value={profileShortcut}
                  disabled={controlsDisabled}
                  onChange={setProfileShortcut}
                />
                <ShortcutStatus profile disabled={controlsDisabled} />
              </SettingRow>
            </SettingsSection>
            <SettingsSection
              title={t("settingsPage.textDelivery")}
              icon={<Type aria-hidden="true" className="size-4 text-muted-foreground" />}
            >
              <ToggleSetting
                title={t("settingsPage.lightCleanup")}
                indicator={<ProfileSettingIndicator field="cleanText" value={settings.cleanText} />}
                description={t("settingsPage.fixSpacingCapitalizationAndPunctuationRemoveCommon")}
                checked={settings.cleanText}
                disabled={controlsDisabled}
                onCheckedChange={(cleanText) => setSettings((old) => ({ ...old, cleanText }))}
              />
              <ToggleSetting
                title={t("settingsPage.copyAutomaticallyToClipboard")}
                description={t("settingsPage.copyCompletedDictationToTheClipboardWhen")}
                checked={settings.autoCopy}
                disabled={controlsDisabled}
                onCheckedChange={(autoCopy) => setSettings((old) => ({ ...old, autoCopy }))}
              />
              <ToggleSetting
                title={t("settingsPage.pasteAutomatically")}
                description={t("settingsPage.pasteIntoTheFocusedAppAfterShortcut")}
                checked={settings.autoPaste}
                disabled={controlsDisabled || !settings.autoCopy}
                onCheckedChange={(autoPaste) => setSettings((old) => ({ ...old, autoPaste }))}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <span className="text-sm text-muted-foreground">
                  {t("settingsPage.lLMInstructionsAndGeneratedOutputs")}
                </span>
                <Link
                  to="/prompts?section=prompts"
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  {t("settingsPage.managePrompts")}
                </Link>
              </div>
            </SettingsSection>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs leading-5 text-muted-foreground">
            <span>{t("settingsPage.saveDifferentChoicesForDifferentTasksOr")}</span>
            <Link
              to="/settings?section=profiles"
              className="inline-flex items-center gap-2 font-medium text-primary"
            >
              {t("settingsPage.manageDictationProfiles")}{" "}
              <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
            </Link>
          </div>
        </TabsContent>
        <TabsContent
          value="profiles"
          keepMounted
          data-slot="settings-profiles"
          className="space-y-5"
        >
          <ProfilesPanel disabled={controlsDisabled || saving || dirty} />
        </TabsContent>
        <TabsContent value="general" keepMounted className="space-y-5">
          <UpdatePanel />
          <SettingsSection title={t("settingsPage.appearance")}>
            <SettingRow
              title={t("settingsPage.interfaceLanguage")}
              htmlFor="interface-language"
              description={t("settingsPage.interfaceLanguageDescription")}
            >
              <Select
                items={interfaceLanguages.map(({ code, label }) => ({ value: code, label }))}
                value={i18n.resolvedLanguage ?? "en"}
                onValueChange={(value) => {
                  if (value) void i18n.changeLanguage(value);
                }}
              >
                <SelectTrigger id="interface-language" className="h-9 w-full min-w-0 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} align="start">
                  {interfaceLanguages.map(({ code, label }) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              title={t("settingsPage.colorTheme")}
              description={t("settingsPage.appliesImmediately")}
            >
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t("settingsPage.colorTheme")}
              >
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
            <SettingsSection title={t("settingsPage.startup")}>
              <ToggleSetting
                title={t("settingsPage.launchAtLogin")}
                checked={settings.launchAtLogin}
                disabled={controlsDisabled || !snapshot.launchAtLoginAvailable}
                onCheckedChange={(launchAtLogin) =>
                  setSettings((old) => ({ ...old, launchAtLogin }))
                }
              />
              <ToggleSetting
                title={t("settingsPage.startInTrayMenuBar")}
                description={t("settingsPage.keepTheMainWindowHiddenOnThe")}
                checked={settings.startInTray}
                disabled={
                  controlsDisabled || (!snapshot.startInTrayAvailable && !settings.startInTray)
                }
                onCheckedChange={(startInTray) => setSettings((old) => ({ ...old, startInTray }))}
              />
              {snapshot.status.startupError ? (
                <p role="alert" className="py-4 text-xs text-destructive">
                  {nativeText(snapshot.status.startupError)}
                </p>
              ) : (
                !snapshot.launchAtLoginAvailable &&
                !snapshot.startInTrayAvailable && (
                  <p className="py-4 text-xs text-muted-foreground">
                    {t("settingsPage.startupOptionsRequireAPackagedWindowsOr")}
                  </p>
                )
              )}
            </SettingsSection>
          </fieldset>
        </TabsContent>
        <TabsContent value="history" keepMounted className="space-y-5">
          <fieldset disabled={controlsDisabled} className="disabled:opacity-60">
            <SettingsSection title={t("common.history")}>
              <ToggleSetting
                title={t("settingsPage.saveDictationsToHistory")}
                description={t("settingsPage.keepTranscriptsAndGeneratedTextInHistory")}
                checked={settings.saveHistory}
                disabled={controlsDisabled}
                onCheckedChange={(saveHistory) => setSettings((old) => ({ ...old, saveHistory }))}
              />
              <ToggleSetting
                title={t("settingsPage.keepRecordings")}
                description={t("settingsPage.saveAudioForPlaybackWhenHistorySaving")}
                checked={settings.saveAudio}
                disabled={controlsDisabled || !settings.saveHistory}
                onCheckedChange={(saveAudio) => setSettings((old) => ({ ...old, saveAudio }))}
              />
              <SettingRow
                title={t("settingsPage.historyRetention")}
                htmlFor="history-retention"
                description={t("settingsPage.automaticallyDeleteOlderTranscriptsAndRetainedAudio")}
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
                  {nativeText(snapshot.status.historyError)}
                </p>
              )}
            </SettingsSection>
          </fieldset>
          <BackupPanel disabled={controlsDisabled || saving || dirty} unsaved={dirty} />
          {snapshot.dataDir && (
            <SettingsSection title={t("settingsPage.localStorage")}>
              <SettingRow title={t("settingsPage.dataFolder")}>
                <p className="break-all font-mono text-xs leading-5 text-muted-foreground">
                  {snapshot.dataDir}
                </p>
              </SettingRow>
            </SettingsSection>
          )}
        </TabsContent>
        <TabsContent value="advanced" keepMounted className="space-y-5">
          <SettingsSection title={t("settingsPage.performanceDetails")}>
            <ToggleSetting
              title={t("settingsPage.statsForNerds")}
              description={t("settingsPage.showTranscriptionTimingModelDetailsTokenUsage")}
              checked={settings.statsForNerds ?? false}
              disabled={controlsDisabled}
              onCheckedChange={(value) => setSettings((old) => ({ ...old, statsForNerds: value }))}
            />
          </SettingsSection>
          <fieldset disabled={controlsDisabled} className="disabled:opacity-60">
            <SettingsSection title={t("settingsPage.localSpeechFiles")}>
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <span className="text-sm text-muted-foreground">
                  {t("settingsPage.downloadAndSwitchSpeechModelsParakeetAnd")}
                </span>
                <Link
                  to="/models"
                  className="text-sm font-medium text-primary underline underline-offset-4"
                >
                  {t("settingsPage.manageModels")}
                </Link>
              </div>
              {(
                [
                  {
                    key: "whisperPath",
                    kind: "runtime",
                    title: t("settingsPage.whisperExecutable"),
                    placeholder: t("settingsPage.selectWhisperCli"),
                  },
                  {
                    key: "modelPath",
                    kind: "model",
                    title: t("common.speechModel"),
                    placeholder: t("settingsPage.selectAModelFileOrManagedModel"),
                  },
                ] as const
              ).map((field) => (
                <SettingRow
                  key={field.key}
                  title={field.title}
                  htmlFor={field.key}
                  indicator={
                    field.key === "modelPath" && (
                      <ProfileSettingIndicator field="modelPath" value={settings.modelPath} />
                    )
                  }
                >
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
                      aria-label={t("settingsPage.browse", { title: field.title })}
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
          <SettingsSection title={t("settingsPage.setup")}>
            <SettingRow
              title={t("settingsPage.runSetupAgain")}
              description={t("settingsPage.revisitModelInstallationMicrophoneTestingAndYour")}
            >
              <Button
                variant="outline"
                disabled={controlsDisabled || saving || dirty}
                onClick={() =>
                  void run(async () => {
                    await backend.restartSetup();
                    navigate("/");
                  })
                }
              >
                {t("settingsPage.runSetup")}
              </Button>
              {dirty && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("settingsPage.finishSavingSettingsBeforeRunningSetup")}
                </p>
              )}
            </SettingRow>
          </SettingsSection>
        </TabsContent>
      </Tabs>
      <Dialog
        open={confirmRetention}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) cancelRetention();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settingsPage.enableAutomaticDeletion")}</DialogTitle>
            <DialogDescription>
              {t("settingsPage.retentionDescription", { days: settings.historyRetentionDays })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelRetention}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || saving || loading}
              onClick={() => {
                retentionApproved.current = true;
                void autoSave.retry();
              }}
            >
              {t("settingsPage.saveAndDeleteOlderHistory")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
