import { AudioSupportPanel } from "@/components/audio-support-panel";
import { AutoSaveStatus } from "@/components/auto-save-status";
import { BackupPanel } from "@/components/backup-panel";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ProfilesPanel } from "@/components/dictation-profiles";
import { useDictation } from "@/components/dictation-provider";
import { ProfileSettingIndicator } from "@/components/profile-setting-indicator";
import { RecordingStatus } from "@/components/recording-status";
import { RecoveryActions } from "@/components/recovery-actions";
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
import { UpdatePanel } from "@/components/update-panel";
import { languages as interfaceLanguages } from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  backendVersionMismatchMessage,
  isBusy,
  isDesktop,
  message,
  type Microphone,
} from "@/lib/backend";
import { useLanguages } from "@/lib/languages";
import { useAutoSave } from "@/lib/use-auto-save";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ChevronRight,
  FolderOpen,
  Keyboard,
  Mic,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Sun,
  Type,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { version } from "../../package.json";

const shortcutKeys = (value: string) =>
  value
    .split("+")
    .map((key) => key.trim().toLowerCase())
    .sort()
    .join("+");
const sameShortcut = (left: string, right: string) =>
  !!left.trim() && shortcutKeys(left) === shortcutKeys(right);
export function SettingsPage({
  beforeClose,
  saveNoticeRef,
}: {
  beforeClose: RefObject<(() => Promise<boolean>) | null>;
  saveNoticeRef: (node: HTMLDivElement | null) => void;
}) {
  const languages = useLanguages();
  const { t, i18n } = useTranslation();
  const sections = [
    { value: "dictation", label: t("historyEntryPage.dictation"), icon: Mic },
    { value: "profiles", label: t("settingsPage.profiles"), icon: Users },
    { value: "general", label: t("settingsPage.general"), icon: Monitor },
    { value: "history", label: t("settingsPage.historyData"), icon: Shield },
    { value: "advanced", label: t("settingsPage.advanced"), icon: Settings2 },
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
  const {
    snapshot,
    run,
    refresh,
    clearError,
    loading,
    error: connectionError,
    update: appUpdate,
  } = useDictation();
  const connectionFailure =
    !!connectionError && (loading || connectionError === backendVersionMismatchMessage);
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
  const focusedTargetRequest = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const profileBeforeClose = useRef<(() => Promise<boolean>) | null>(null);
  const targetFocusEpoch = useRef(0);
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState<
    {
      id: string;
      section: string;
      title: string;
      description: string;
      terms: string;
      path?: string;
    }[]
  >([]);
  const [highlight, setHighlight] = useState("");
  const normalizeSearch = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase();
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const entries: typeof searchIndex = [];
    root.querySelectorAll<HTMLElement>("[data-settings-category]").forEach((panel) => {
      const category = panel.dataset.settingsCategory!;
      panel
        .querySelectorAll<HTMLElement>(
          '[data-slot="setting-row"], [data-slot="toggle-setting"], [data-slot="settings-section"], [data-slot="profile-card"], section[aria-labelledby]',
        )
        .forEach((node, index) => {
          if (
            node.matches('[data-slot="settings-section"], section[aria-labelledby]') &&
            node.querySelector(
              '[data-slot="setting-row"], [data-slot="toggle-setting"], [data-slot="profile-card"]',
            )
          )
            return;
          if (!node.id) node.id = `settings-${category}-${index}`;
          const title = node.querySelector("h2, h3, label, p")?.textContent?.trim() ?? "";
          if (!title) return;
          const description =
            [...node.querySelectorAll("p")]
              .map((p) => p.textContent?.trim() ?? "")
              .find((text) => text && text !== title)
              ?.slice(0, 180) ?? "";
          const sectionTitle =
            node.parentElement
              ?.closest('[data-slot="settings-section"], section[aria-labelledby], details')
              ?.querySelector("h2, summary")?.textContent ?? "";
          const extra = /shortcut|tastenk|tastatur/i.test(title)
            ? "hotkey keybinding shortcut keyboard tastatur tastenkürzel"
            : /microphone|mikrofon/i.test(title)
              ? "mic microphone input audio mikrofon eingang"
              : /retention|aufbewahrung/i.test(title)
                ? "retention delete cleanup history aufbewahrung löschen"
                : /theme|farb|appearance|darstellung/i.test(title)
                  ? "theme dark light appearance farbe dunkel hell"
                  : /statistics|nerds|statistik/i.test(title)
                    ? "performance timing speed stats nerds statistics tokens leistung geschwindigkeit"
                    : /whisper|executable|ausführbar/i.test(title)
                      ? "runtime executable path custom files laufzeit pfad dateien"
                      : "";
          if (!entries.some((entry) => entry.title === title && entry.section === category))
            entries.push({
              id: node.id,
              section: category,
              title,
              description,
              terms: normalizeSearch(
                `${title} ${description} ${sectionTitle} ${extra} ${node.textContent ?? ""}`,
              ),
            });
        });
    });
    entries.push({
      id: "text-model",
      section: "advanced",
      title: t("promptsPage.textModel"),
      description: t("promptsPage.modelsAreListedForTheSelectedServer"),
      terms: normalizeSearch(
        `${t("promptsPage.textModel")} ollama llm endpoint server text processing sprachmodell textmodell`,
      ),
      path: "/prompts?section=models",
    });
    setSearchIndex(entries);
  }, [i18n.resolvedLanguage, loading, snapshot.dictationProfiles, t]);
  const searchWords = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  const matches = searchWords.length
    ? searchIndex
        .filter((entry) => searchWords.every((word) => entry.terms.includes(word)))
        .sort(
          (a, b) =>
            Number(normalizeSearch(b.title).includes(normalizeSearch(query))) -
            Number(normalizeSearch(a.title).includes(normalizeSearch(query))),
        )
    : [];
  useEffect(() => {
    const target = searchParams.get("focus");
    if (!target || query || !contentRef.current) return;
    const request = `${location.key}:${target}`;
    if (focusedTargetRequest.current === request) return;
    const epoch = targetFocusEpoch.current;
    const frame = requestAnimationFrame(() => {
      if (epoch !== targetFocusEpoch.current) return;
      const node = document.getElementById(target);
      if (!node || !contentRef.current?.contains(node)) return;
      for (
        let parent = node.parentElement;
        parent && parent !== contentRef.current;
        parent = parent.parentElement
      ) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      node.scrollIntoView({ block: "center", behavior: "instant" });
      const control = node.matches("input,button,[tabindex]")
        ? node
        : node.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not(:disabled),button:not(:disabled),[tabindex="0"]',
          );
      if (control && !control.matches(":disabled")) {
        control.focus({ preventScroll: true });
        if (document.activeElement === control) focusedTargetRequest.current = request;
      } else if (!control) focusedTargetRequest.current = request;
      setHighlight(target);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [section, query, searchParams, controlsDisabled, location.key]);
  useEffect(() => {
    if (!highlight) return;
    const node = document.getElementById(highlight);
    node?.setAttribute("data-settings-highlight", "true");
    const timer = setTimeout(() => setHighlight(""), 2500);
    return () => {
      clearTimeout(timer);
      node?.removeAttribute("data-settings-highlight");
    };
  }, [highlight]);
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
        title: t("uiPolish.settingsNotSaved"),
        description: message(cause),
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
  useEffect(() => {
    beforeClose.current = async () => {
      if (profileBeforeClose.current && !(await profileBeforeClose.current())) return false;
      if (dirty && retentionNeedsConfirm) {
        setConfirmRetention(true);
        return false;
      }
      // Flush focused fields on Escape too. Failed drafts remain in DraftProvider
      // when the user leaves, with the existing save-error toast and retry on return.
      await autoSave.retry();
      return true;
    };
    return () => {
      beforeClose.current = null;
    };
  }, [beforeClose, autoSave, dirty, retentionNeedsConfirm]);
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
    toastManager.close("settings-save");
  }
  function selectSection(value: string, focus?: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("section", value);
        if (focus) next.set("focus", focus);
        else next.delete("focus");
        return next;
      },
      { replace: true },
    );
  }
  const textInput = (target: EventTarget): target is HTMLInputElement =>
    target instanceof HTMLInputElement && !["checkbox", "radio", "hidden"].includes(target.type);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={query.trim() ? null : section}
        orientation="vertical"
        onValueChange={(value) => {
          if (typeof value === "string") {
            setQuery("");
            selectSection(value);
          }
        }}
        className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-0 @min-[42rem]/settings-dialog:grid-cols-[10.5rem_minmax(0,1fr)] @min-[42rem]/settings-dialog:grid-rows-1"
      >
        <aside className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[8px] border-b bg-sidebar/60 p-[8px] @min-[42rem]/settings-dialog:flex @min-[42rem]/settings-dialog:flex-col @min-[42rem]/settings-dialog:items-stretch @min-[42rem]/settings-dialog:gap-0 @min-[42rem]/settings-dialog:overflow-y-auto @min-[42rem]/settings-dialog:border-r @min-[42rem]/settings-dialog:border-b-0 @min-[42rem]/settings-dialog:px-3 @min-[42rem]/settings-dialog:py-5">
          <DialogTitle className="sr-only text-lg leading-7 font-semibold @min-[42rem]/settings-dialog:not-sr-only @min-[42rem]/settings-dialog:px-2">
            {t("common.settings")}
          </DialogTitle>
          <div className="col-span-2 pr-[52px] @min-[42rem]/settings-dialog:hidden">
            <Select
              items={sections.map(({ value, label }) => ({ value, label }))}
              value={section}
              onValueChange={(value) => {
                if (value !== null) {
                  setQuery("");
                  selectSection(value);
                }
              }}
            >
              <SelectTrigger
                aria-label={t("settingsPage.settingsSections")}
                className="h-auto min-h-[44px] w-full whitespace-normal py-[4px] data-[size=default]:h-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                {sections.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative col-start-1 row-start-2 @min-[42rem]/settings-dialog:mt-5 @min-[42rem]/settings-dialog:mb-4">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              data-settings-search="true"
              aria-label={t("uiPolish.searchSettings")}
              placeholder={t("uiPolish.search")}
              value={query}
              onFocus={() => {
                // Returning to search cancels a still-pending jump to a setting.
                targetFocusEpoch.current++;
                if (searchParams.has("focus"))
                  setSearchParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      next.delete("focus");
                      return next;
                    },
                    { replace: true },
                  );
              }}
              onChange={(event) => setQuery(event.target.value)}
              className="h-auto min-h-[44px] py-[4px] pr-8 pl-8 text-sm @min-[42rem]/settings-dialog:h-9 @min-[42rem]/settings-dialog:min-h-0 @min-[42rem]/settings-dialog:py-1"
            />
            {query && (
              <button
                type="button"
                aria-label={t("uiPolish.clearSearch")}
                className="absolute top-0 right-0 flex h-full w-[44px] items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring @min-[42rem]/settings-dialog:w-8"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>
          <div
            data-slot="settings-save-state"
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-[8px]",
              "@max-[42rem]/settings-dialog:[&_[data-slot=auto-save-status]]:gap-[8px] @max-[42rem]/settings-dialog:[&_[data-slot=save-recovery-actions]]:gap-[8px] @max-[42rem]/settings-dialog:[&_[data-slot=button]]:h-auto @max-[42rem]/settings-dialog:[&_[data-slot=button]]:min-h-[44px] @max-[42rem]/settings-dialog:[&_[data-slot=button]]:px-[8px] @max-[42rem]/settings-dialog:[&_[data-slot=button]]:py-[4px] @min-[42rem]/settings-dialog:absolute @min-[42rem]/settings-dialog:col-auto @min-[42rem]/settings-dialog:row-auto @min-[42rem]/settings-dialog:top-5 @min-[42rem]/settings-dialog:right-12 @min-[42rem]/settings-dialog:z-10",
              autoSave.status === "saved"
                ? "col-start-2 row-start-2 @max-[400px]/settings-dialog:[&_[data-slot=saved-state-label]]:sr-only"
                : "col-span-2 row-start-3 @min-[42rem]/settings-dialog:max-w-[60cqw]",
            )}
          >
            <AutoSaveStatus
              compact
              status={autoSave.status}
              retry={autoSave.retry}
              discard={discard}
              disabled={controlsDisabled}
            />
            <div
              ref={saveNoticeRef}
              data-slot="settings-save-notice-host"
              className="max-w-full shrink-0 empty:hidden"
            />
          </div>
          <TabsList
            aria-label={t("settingsPage.settingsSections")}
            className="hidden w-full shrink-0 items-stretch justify-start gap-1 bg-transparent p-0 @min-[42rem]/settings-dialog:flex"
          >
            {sections.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-auto min-h-10 flex-none justify-start gap-2.5 px-2.5 py-2 whitespace-normal text-left text-sm data-active:bg-primary/10 data-active:text-primary dark:data-active:bg-primary/10 dark:data-active:text-primary"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <p className="mt-auto hidden flex-wrap items-baseline gap-x-1.5 px-2 pt-6 text-xs text-muted-foreground @min-[42rem]/settings-dialog:flex">
            <span>Yap</span>
            <span className="tabular-nums">v{appUpdate?.currentVersion || version}</span>
          </p>
        </aside>
        <div className="relative flex min-h-0 min-w-0 flex-col">
          <header
            aria-label={t("common.settings")}
            className="hidden min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-4 pr-12 @min-[42rem]/settings-dialog:flex sm:px-6 sm:pr-12"
          >
            <h1 className="text-lg font-semibold tracking-tight">
              {query.trim()
                ? t("uiPolish.searchSettings")
                : sections.find((item) => item.value === section)?.label}
            </h1>
          </header>
          <RecordingStatus inline />
          {(loading || connectionFailure) && (
            <section
              aria-label={t("appLayout.connectionRecovery")}
              className="mx-5 mt-4 space-y-3 rounded-lg border border-destructive/30 p-4 sm:mx-7"
            >
              <p role={connectionError ? "alert" : "status"} className="text-sm">
                {connectionError ? nativeText(connectionError) : t("appLayout.loadingApp")}
              </p>
              <RecoveryActions
                source={t("appLayout.backendConnection")}
                details={connectionError}
                retryLabel={t("appLayout.retryLoading")}
                onRetry={() => void run(refresh, false)}
              />
            </section>
          )}
          <div
            ref={contentRef}
            data-slot="settings-scroll-pane"
            className={cn(
              "@container/settings min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4 [&_fieldset]:min-w-0",
              "[&_[data-slot=settings-section]]:min-w-0 [&_[data-slot=settings-section]]:p-4 [&_[data-slot=setting-row]]:py-3 [&_[data-slot=toggle-setting]]:py-3",
              "[&_[data-slot=settings-section-heading]]:border-b-0 [&_[data-slot=settings-section-heading]]:p-0 [&_[data-slot=settings-section-heading]]:pb-1.5",
              "[&_[data-slot=settings-section-content]]:px-0 [&_[data-slot=setting-row]]:items-center",
              "[&_[data-slot=select-trigger]]:h-auto [&_[data-slot=select-trigger]]:min-h-9 [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-trigger]]:max-w-full [&_[data-slot=select-trigger]]:whitespace-normal",
              "[&_[data-slot=select-value]]:flex [&_[data-slot=select-value]]:whitespace-normal [&_[data-slot=select-value]]:[overflow-wrap:anywhere] [&_[data-slot=select-value]]:[-webkit-line-clamp:unset]",
              "[&_[data-slot=profile-list]>[data-slot=settings-section]]:border-0 [&_[data-slot=profile-list]>[data-slot=settings-section]]:bg-transparent [&_[data-slot=profile-list]>[data-slot=settings-section]]:p-0",
              "@max-[24rem]/settings:[&_[data-slot=settings-section]]:p-2 @max-[24rem]/settings:[&_[data-slot=setting-row]]:py-2 @max-[24rem]/settings:[&_[data-slot=toggle-setting]]:py-2 @max-[24rem]/settings:[&_[data-slot=settings-section]]:[overflow-wrap:anywhere]",
              "@max-[24rem]/settings:[&_[data-slot=button]]:h-auto @max-[24rem]/settings:[&_[data-slot=button]]:min-h-9 @max-[24rem]/settings:[&_[data-slot=button]]:max-w-full @max-[24rem]/settings:[&_[data-slot=button]]:whitespace-normal @max-[24rem]/settings:[&_[data-slot=button]]:[overflow-wrap:anywhere]",
            )}
            onFocusCapture={(event) => {
              if (textInput(event.target) && event.currentTarget.contains(event.target))
                setEditingText(true);
              const pane = event.currentTarget;
              const label = Array.from(pane.querySelectorAll("label")).find(
                (item) => item.control === event.target,
              );
              if (!label) return;
              const viewport = pane.getBoundingClientRect();
              const field = event.target.getBoundingClientRect();
              const caption = label.getBoundingClientRect();
              // Keep a focused control's context in the same reading window.
              // Large rows still scroll normally when both cannot fit together.
              const top = Math.min(caption.top, field.top);
              const bottom = Math.max(caption.bottom, field.bottom);
              if (bottom - top <= pane.clientHeight - 16) {
                if (top < viewport.top + 8) pane.scrollTop += top - viewport.top - 8;
                else if (bottom > viewport.bottom - 8)
                  pane.scrollTop += bottom - viewport.bottom + 8;
              }
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
            {query.trim() && (
              <section aria-label={t("uiPolish.searchSettings")} className="space-y-2">
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                  {t("uiPolish.settingResults", { count: matches.length })}
                </p>
                {matches.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      setQuery("");
                      if (entry.path) navigate(entry.path);
                      else selectSection(entry.section, entry.id);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <p className="text-sm font-medium">{entry.title}</p>
                        <span className="text-xs text-muted-foreground">
                          {sections.find((item) => item.value === entry.section)?.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {entry.description ||
                          sections.find((item) => item.value === entry.section)?.label}
                      </p>
                    </div>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                ))}
                {!matches.length && (
                  <div className="py-12 text-center">
                    <h2 className="text-sm font-medium">{t("uiPolish.noSettingsFound")}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("uiPolish.tryAnotherSetting")}
                    </p>
                  </div>
                )}
              </section>
            )}
            <div hidden={!!query.trim()}>
              <TabsContent
                data-settings-category="dictation"
                value="dictation"
                keepMounted
                className="space-y-5"
              >
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
                      <div className="flex items-start gap-2">
                        <Select
                          items={microphoneOptions}
                          value={settings.microphoneId}
                          disabled={controlsDisabled}
                          onValueChange={(value) => {
                            if (value !== null)
                              setSettings((old) => ({ ...old, microphoneId: value }));
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
                      indicator={
                        <ProfileSettingIndicator field="language" value={settings.language} />
                      }
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
                      description={t("uiPolish.shortcutHelp")}
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
                          if (value !== null)
                            setSettings((old) => ({ ...old, interaction: value }));
                        }}
                      >
                        <SelectTrigger
                          id="interaction"
                          className="h-9 w-full min-w-0 bg-background"
                        >
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
                      description={t("uiPolish.profileShortcutHelp")}
                    >
                      <ShortcutInput
                        id="profile-cycle-shortcut"
                        recordLabel={t("settingsPage.recordProfileShortcut")}
                        value={profileShortcut}
                        disabled={controlsDisabled}
                        onChange={setProfileShortcut}
                      />
                      <ShortcutStatus profile disabled={controlsDisabled} />
                      <details className="mt-2 text-xs leading-5 text-muted-foreground">
                        <summary className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t("uiPolish.profileCyclingDetails")}
                        </summary>
                        <p className="mt-2">
                          {t("settingsPage.optionalSwitchesToTheNextAvailableProfile")}
                        </p>
                      </details>
                    </SettingRow>
                  </SettingsSection>
                  <SettingsSection
                    title={t("settingsPage.textDelivery")}
                    icon={<Type aria-hidden="true" className="size-4 text-muted-foreground" />}
                  >
                    <ToggleSetting
                      title={t("settingsPage.lightCleanup")}
                      indicator={
                        <ProfileSettingIndicator field="cleanText" value={settings.cleanText} />
                      }
                      description={t(
                        "settingsPage.fixSpacingCapitalizationAndPunctuationRemoveCommon",
                      )}
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
                data-settings-category="profiles"
                value="profiles"
                keepMounted
                data-slot="settings-profiles"
                className="space-y-5"
              >
                <ProfilesPanel
                  disabled={controlsDisabled || saving || dirty}
                  beforeClose={profileBeforeClose}
                />
              </TabsContent>
              <TabsContent
                data-settings-category="general"
                value="general"
                keepMounted
                className="space-y-5"
              >
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
                      <SelectTrigger
                        id="interface-language"
                        className="h-9 w-full min-w-0 bg-background"
                      >
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
                        controlsDisabled ||
                        (!snapshot.startInTrayAvailable && !settings.startInTray)
                      }
                      onCheckedChange={(startInTray) =>
                        setSettings((old) => ({ ...old, startInTray }))
                      }
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
                <UpdatePanel />
              </TabsContent>
              <TabsContent
                data-settings-category="history"
                value="history"
                keepMounted
                className="space-y-5"
              >
                <fieldset disabled={controlsDisabled} className="disabled:opacity-60">
                  <SettingsSection title={t("common.history")}>
                    <ToggleSetting
                      title={t("settingsPage.saveDictationsToHistory")}
                      description={t("settingsPage.keepTranscriptsAndGeneratedTextInHistory")}
                      checked={settings.saveHistory}
                      disabled={controlsDisabled}
                      onCheckedChange={(saveHistory) =>
                        setSettings((old) => ({ ...old, saveHistory }))
                      }
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
                      description={t(
                        "settingsPage.automaticallyDeleteOlderTranscriptsAndRetainedAudio",
                      )}
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
                    <div data-slot="setting-row" className="space-y-2 py-3">
                      <p className="text-sm font-medium">{t("settingsPage.dataFolder")}</p>
                      <p className="break-all font-mono text-xs leading-5 text-muted-foreground">
                        {snapshot.dataDir}
                      </p>
                    </div>
                  </SettingsSection>
                )}
              </TabsContent>
              <TabsContent
                data-settings-category="advanced"
                value="advanced"
                keepMounted
                className="space-y-5"
              >
                <SettingsSection title={t("settingsPage.performanceDetails")}>
                  <ToggleSetting
                    title={t("uiPolish.performanceStatistics")}
                    description={t("settingsPage.showTranscriptionTimingModelDetailsTokenUsage")}
                    checked={settings.statsForNerds ?? false}
                    disabled={controlsDisabled}
                    onCheckedChange={(value) =>
                      setSettings((old) => ({ ...old, statsForNerds: value }))
                    }
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
                    <details className="py-3">
                      <summary className="cursor-pointer rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t("uiPolish.customModelFiles")}
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {t("uiPolish.customModelHelp")}
                      </p>
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
                            title: t("uiPolish.speechModelFile"),
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
                              <ProfileSettingIndicator
                                field="modelPath"
                                value={settings.modelPath}
                              />
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
                    </details>
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
            </div>
          </div>
        </div>
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
      </Tabs>
    </div>
  );
}
