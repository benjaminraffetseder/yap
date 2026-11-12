import { useDictation } from "@/components/dictation-provider";
import { useTheme } from "@/components/theme-provider";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import i18n from "@/i18n";
import { backend, isBusy, isDesktop, type Session } from "@/lib/backend";
import {
  Activity,
  BookOpen,
  Copy,
  Download,
  HardDriveDownload,
  History,
  Mic,
  Monitor,
  Moon,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Upload,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

type CommandAction = {
  label: string;
  icon: LucideIcon;
  keywords: string[];
  action: () => void | Promise<void>;
  disabled?: boolean;
  checked?: boolean;
  shortcut?: string;
};
type RunAction = (action: () => Promise<unknown>, reload?: boolean) => Promise<void>;

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { run } = useDictation();
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "k" ||
        document.querySelector("[data-shortcut-capture]")
      )
        return;
      event.preventDefault();
      onOpenChange(!open);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open, onOpenChange]);

  // Keep the pending guard across closing and reopening the palette.
  async function runAction(action: () => Promise<unknown>, reload = true) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await run(action, reload);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <CommandDialog
      title={t("commandMenu.commandPalette")}
      description={t("commandMenu.navigateYapRunActionsOrSearchDictation")}
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandMenuContent
        open={open}
        close={() => onOpenChange(false)}
        pending={pending}
        runAction={runAction}
      />
    </CommandDialog>
  );
}

function CommandMenuContent({
  open,
  close,
  pending,
  runAction,
}: {
  open: boolean;
  close: () => void;
  pending: boolean;
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    snapshot,
    loading,
    run,
    update,
    checkingUpdates,
    installingUpdate,
    checkUpdates,
    installUpdate,
    setProcessingPanelOpen,
  } = useDictation();
  const { theme, setTheme } = useTheme();
  const { settings, status, latestResult } = snapshot;
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const search = query.trim();
  const [result, setResult] = useState<{
    query: string;
    entries: Session[];
    failed?: boolean;
  } | null>(null);
  const historyRequest = useRef(0);
  const currentRun = useRef(run);
  currentRun.current = run;
  const unavailable = !isDesktop || loading || pending;
  const busy = isBusy(status.phase);
  const recording = status.phase === "recording";
  const native =
    (action: () => Promise<unknown>, reload = true) =>
    () =>
      runAction(action, reload);

  useEffect(() => {
    // A quick reopen can retain focus on cmdk's root from the previous selection.
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    const request = historyRequest.current + 1;
    historyRequest.current = request;
    if (!open) {
      setQuery("");
      setResult(null);
      return;
    }
    if (!isDesktop || loading || search.length < 2) return;
    const timer = setTimeout(() => {
      void currentRun.current(async () => {
        try {
          // History uses zero-based pages, just like the History page.
          const value = await backend.history(search, 0);
          if (request !== historyRequest.current) return;
          setResult({ query: search, entries: value.entries.slice(0, 8) });
        } catch (cause) {
          if (request !== historyRequest.current) return;
          setResult({ query: search, entries: [], failed: true });
          throw cause;
        }
      }, false);
    }, 200);
    return () => {
      clearTimeout(timer);
      historyRequest.current++;
    };
  }, [search, loading, open]);

  const groups: { heading: string; items: CommandAction[] }[] = [
    {
      heading: t("commandMenu.navigate"),
      items: [
        {
          label: t("processing.activity"),
          icon: Activity,
          keywords: ["activity", "processing", "queue", "jobs", "imports"],
          action: () => setProcessingPanelOpen(true),
        },
        ...[
          { label: t("appLayout.dictate"), to: "/", icon: Mic, keywords: ["home", "record"] },
          {
            label: t("common.history"),
            to: "/history",
            icon: History,
            keywords: ["transcripts", "dictations"],
          },
          {
            label: t("commandMenu.recentlyDeleted"),
            to: "/history?view=deleted",
            icon: History,
            keywords: ["trash", "restore"],
          },
          {
            label: t("modelsPage.models"),
            to: "/models",
            icon: HardDriveDownload,
            keywords: ["speech", "whisper"],
          },
          {
            label: t("common.vocabulary"),
            to: "/vocabulary",
            icon: BookOpen,
            keywords: ["dictionary", "words"],
          },
          {
            label: t("promptsPage.prompts"),
            to: "/prompts?section=prompts",
            icon: Sparkles,
            keywords: ["instructions"],
          },
          {
            label: t("promptsPage.chains"),
            to: "/prompts?section=chains",
            icon: Workflow,
            keywords: ["prompts", "steps"],
          },
          {
            label: t("promptsPage.textModel"),
            to: "/prompts?section=models",
            icon: Sparkles,
            keywords: ["llm", "ollama"],
          },
          {
            label: t("commandMenu.settingsDictation"),
            to: "/settings?section=dictation",
            icon: Settings2,
            keywords: ["microphone", "shortcut", "profiles"],
          },
          {
            label: t("commandMenu.settingsGeneral"),
            to: "/settings?section=general",
            icon: Settings2,
            keywords: ["updates", "startup"],
          },
          {
            label: t("commandMenu.settingsHistoryData"),
            to: "/settings?section=history",
            icon: Settings2,
            keywords: ["backup", "retention", "storage"],
          },
          {
            label: t("commandMenu.settingsAdvanced"),
            to: "/settings?section=advanced",
            icon: Settings2,
            keywords: ["diagnostics", "audio support"],
          },
        ].map(({ to, ...item }) => ({ ...item, action: () => navigate(to) })),
      ],
    },
    {
      heading: t("historyEntryPage.dictation"),
      items: [
        {
          label: recording ? t("homePage.stopRecording") : t("homePage.startRecording"),
          icon: recording ? Square : Mic,
          keywords: ["record", "dictate", "microphone"],
          shortcut: recording ? undefined : settings.shortcut,
          disabled: unavailable || !snapshot.ready || (busy && !recording),
          action: native(recording ? backend.stop : backend.start),
        },
        ...(status.phase === "downloading"
          ? [
              {
                label: t("homePage.cancelDownload"),
                icon: X,
                keywords: ["stop", "download"],
                disabled: unavailable,
                action: native(backend.cancel, false),
              },
            ]
          : []),
        {
          label: t("commandMenu.importAudioFiles"),
          icon: Upload,
          keywords: ["transcribe", "file", "wav", "mp3"],
          disabled: unavailable || !snapshot.ready,
          action: native(backend.importAudio),
        },
        {
          label: t("commandMenu.turnSaveToHistory", {
            on: (settings.saveHistory ? t("common.off") : t("common.on")).toLowerCase(),
          }),
          icon: Save,
          keywords: ["save", "history", "privacy"],
          disabled: unavailable || status.phase === "backup",
          action: native(() => backend.setSaveHistory(!settings.saveHistory)),
        },
        ...(latestResult && !busy
          ? [
              {
                label: t("commandMenu.copyLatestResult"),
                icon: Copy,
                keywords: ["clipboard", "transcript"],
                disabled: unavailable,
                action: native(() => backend.copy(latestResult.text), false),
              },
              {
                label: t("commandMenu.saveLatestResultToHistory"),
                icon: Save,
                keywords: ["keep", "transcript"],
                disabled: unavailable,
                action: native(() => backend.saveLatestResult(latestResult.session.id)),
              },
            ]
          : []),
      ],
    },
    {
      heading: t("commandMenu.profilesAndModel"),
      items: [
        ...(snapshot.dictationProfiles ?? []).map((profile) => ({
          label: t("commandMenu.switchToProfile", { name: profile.name }),
          icon: Workflow,
          keywords: ["profile", "dictation"],
          checked: snapshot.activeProfileId === profile.id,
          disabled: unavailable || busy,
          action: native(() => backend.applyProfile(profile.id)),
        })),
        ...snapshot.models
          .filter((model) => model.installed)
          .map((model) => ({
            label: t("commandMenu.useSpeechModel", { name: model.name }),
            icon: HardDriveDownload,
            keywords: ["speech", "model"],
            checked: settings.modelPath === model.path,
            disabled: unavailable || busy,
            action: native(() => backend.settings({ ...settings, modelPath: model.path })),
          })),
        {
          label: t("commandMenu.downloadASpeechModel"),
          icon: Download,
          keywords: ["install", "whisper", "models"],
          action: () => navigate("/models"),
        },
      ],
    },
    {
      heading: t("settingsPage.appearance"),
      items: [
        ...(
          [
            { value: "light", label: t("settingsPage.light"), icon: Sun },
            { value: "dark", label: t("settingsPage.dark"), icon: Moon },
            { value: "system", label: t("settingsPage.system"), icon: Monitor },
          ] as const
        ).map(({ value, label, icon }) => ({
          label: t("commandMenu.theme", { label: label }),
          icon,
          keywords: [value, "appearance", "theme"],
          checked: theme === value,
          action: () => setTheme(value),
        })),
      ],
    },
    {
      heading: t("commandMenu.app"),
      items: [
        ...(!update || (update.supported && update.configured)
          ? [
              {
                label: t("commandMenu.checkForUpdates"),
                icon: RefreshCw,
                keywords: ["version", "upgrade"],
                disabled:
                  unavailable || busy || checkingUpdates || installingUpdate || update?.ready,
                action: native(() => checkUpdates(true), false),
              },
            ]
          : []),
        ...(update?.available
          ? [
              {
                label: t(update.ready ? "appLayout.restartUpdate" : "appLayout.installUpdate"),
                icon: Download,
                keywords: ["version", "upgrade"],
                disabled: unavailable || busy || checkingUpdates || installingUpdate,
                action: native(installUpdate, false),
              },
            ]
          : []),
      ],
    },
  ];

  function select(action: CommandAction["action"]) {
    close();
    void action();
  }

  const entries = !search
    ? snapshot.history.filter((entry) => !entry.deletedAt).slice(0, 5)
    : result?.query === search
      ? result.entries
      : [];
  const searchingHistory = isDesktop && search.length >= 2;

  return (
    <Command label={t("commandMenu.yapCommands")} vimBindings={false}>
      <CommandInput
        ref={input}
        placeholder={t("commandMenu.searchCommandsOrDictationHistory")}
        aria-label={t("commandMenu.searchCommandsOrDictationHistory2")}
        value={query}
        onValueChange={setQuery}
        maxLength={250}
      />
      <CommandList className="max-h-[min(24rem,60dvh)]">
        {groups.map(({ heading, items }) => (
          <CommandGroup key={heading} heading={heading}>
            {items.map(({ label, icon: Icon, keywords, action, disabled, checked, shortcut }) => (
              <CommandItem
                key={label}
                value={label}
                keywords={keywords}
                disabled={disabled}
                data-checked={checked}
                onSelect={() => select(action)}
              >
                <Icon aria-hidden="true" />
                <span className="min-w-0 truncate">{label}</span>
                {checked && <span className="sr-only"> {t("commandMenu.current")}</span>}
                {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {(!search || searchingHistory) && (
          <CommandGroup
            heading={search ? t("commandMenu.historyMatches") : t("homePage.recentDictations")}
            forceMount
          >
            {searchingHistory && (
              <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                {result?.query !== search
                  ? t("commandMenu.searchingHistory")
                  : result.failed
                    ? t("commandMenu.historySearchFailed")
                    : !entries.length
                      ? t("commandMenu.noMatchingDictations")
                      : t("commandMenu.matchingDictations", { length: entries.length })}
              </p>
            )}
            {entries.map((entry) => (
              <CommandItem
                key={entry.id}
                value={`history:${entry.id}`}
                forceMount
                keywords={["history", "transcript"]}
                onSelect={() => select(() => navigate(`/history/${encodeURIComponent(entry.id)}`))}
              >
                <History aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  {(entry.finalTranscript || entry.rawTranscript)
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 120) || t("commandMenu.untitledDictation")}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleDateString(i18n.resolvedLanguage, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {search && (
          <CommandGroup heading={t("commandMenu.searchHistory")} forceMount>
            <CommandItem
              value="search-all-history"
              keywords={["history", "search", search]}
              forceMount
              onSelect={() => select(() => navigate(`/history?q=${encodeURIComponent(search)}`))}
            >
              <Search aria-hidden="true" />
              <span className="truncate">
                {t("commandMenu.searchAllHistoryFor")}
                {search}
                {t("commandMenu.text")}
              </span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
