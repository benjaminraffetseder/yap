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
import { backend, isBusy, isDesktop, type Session } from "@/lib/backend";
import {
  BookOpen,
  Copy,
  Download,
  HardDriveDownload,
  History,
  Mic,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
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
  collapsed,
  toggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collapsed: boolean;
  toggleSidebar: () => void;
}) {
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
      title="Command palette"
      description="Navigate Yap, run actions, or search dictation history."
      open={open}
      onOpenChange={onOpenChange}
    >
      <CommandMenuContent
        open={open}
        close={() => onOpenChange(false)}
        collapsed={collapsed}
        toggleSidebar={toggleSidebar}
        pending={pending}
        runAction={runAction}
      />
    </CommandDialog>
  );
}

function CommandMenuContent({
  open,
  close,
  collapsed,
  toggleSidebar,
  pending,
  runAction,
}: {
  open: boolean;
  close: () => void;
  collapsed: boolean;
  toggleSidebar: () => void;
  pending: boolean;
  runAction: RunAction;
}) {
  const navigate = useNavigate();
  const { snapshot, loading, run, update, checkingUpdates, checkUpdates } = useDictation();
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
      heading: "Navigate",
      items: [
        { label: "Dictate", to: "/", icon: Mic, keywords: ["home", "record"] },
        {
          label: "History",
          to: "/history",
          icon: History,
          keywords: ["transcripts", "dictations"],
        },
        {
          label: "Recently deleted",
          to: "/history?view=deleted",
          icon: History,
          keywords: ["trash", "restore"],
        },
        {
          label: "Models",
          to: "/models",
          icon: HardDriveDownload,
          keywords: ["speech", "whisper"],
        },
        {
          label: "Vocabulary",
          to: "/vocabulary",
          icon: BookOpen,
          keywords: ["dictionary", "words"],
        },
        {
          label: "Prompts",
          to: "/prompts?section=prompts",
          icon: Sparkles,
          keywords: ["instructions"],
        },
        {
          label: "Chains",
          to: "/prompts?section=chains",
          icon: Workflow,
          keywords: ["prompts", "steps"],
        },
        {
          label: "Text model",
          to: "/prompts?section=models",
          icon: Sparkles,
          keywords: ["llm", "ollama"],
        },
        {
          label: "Settings: Dictation",
          to: "/settings?section=dictation",
          icon: Settings2,
          keywords: ["microphone", "shortcut", "profiles"],
        },
        {
          label: "Settings: General",
          to: "/settings?section=general",
          icon: Settings2,
          keywords: ["updates", "startup"],
        },
        {
          label: "Settings: History & data",
          to: "/settings?section=history",
          icon: Settings2,
          keywords: ["backup", "retention", "storage"],
        },
        {
          label: "Settings: Advanced",
          to: "/settings?section=advanced",
          icon: Settings2,
          keywords: ["diagnostics", "audio support"],
        },
      ].map(({ to, ...item }) => ({ ...item, action: () => navigate(to) })),
    },
    {
      heading: "Dictation",
      items: [
        {
          label: recording ? "Stop recording" : "Start recording",
          icon: recording ? Square : Mic,
          keywords: ["record", "dictate", "microphone"],
          shortcut: recording ? undefined : settings.shortcut,
          disabled: unavailable || !snapshot.ready || (busy && !recording),
          action: native(recording ? backend.stop : backend.start),
        },
        ...(status.phase === "downloading"
          ? [
              {
                label: "Cancel download",
                icon: X,
                keywords: ["stop", "download"],
                disabled: unavailable,
                action: native(backend.cancel, false),
              },
            ]
          : []),
        {
          label: "Import audio file…",
          icon: Upload,
          keywords: ["transcribe", "file", "wav", "mp3"],
          disabled: unavailable || !snapshot.ready || busy,
          action: native(backend.importAudio),
        },
        {
          label: `Turn Save to history ${settings.saveHistory ? "off" : "on"}`,
          icon: Save,
          keywords: ["save", "history", "privacy"],
          disabled: unavailable || status.phase === "backup",
          action: native(() => backend.setSaveHistory(!settings.saveHistory)),
        },
        ...(latestResult && !busy
          ? [
              {
                label: "Copy latest result",
                icon: Copy,
                keywords: ["clipboard", "transcript"],
                disabled: unavailable,
                action: native(() => backend.copy(latestResult.text), false),
              },
              {
                label: "Save latest result to history",
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
      heading: "Profiles and model",
      items: [
        ...(snapshot.dictationProfiles ?? []).map((profile) => ({
          label: `Switch to profile: ${profile.name}`,
          icon: Workflow,
          keywords: ["profile", "dictation"],
          checked: snapshot.activeProfileId === profile.id,
          disabled: unavailable || busy,
          action: native(() => backend.applyProfile(profile.id)),
        })),
        ...snapshot.models
          .filter((model) => model.installed)
          .map((model) => ({
            label: `Use speech model: ${model.name}`,
            icon: HardDriveDownload,
            keywords: ["speech", "model"],
            checked: settings.modelPath === model.path,
            disabled: unavailable || busy,
            action: native(() => backend.settings({ ...settings, modelPath: model.path })),
          })),
        {
          label: "Download a speech model…",
          icon: Download,
          keywords: ["install", "whisper", "models"],
          action: () => navigate("/models"),
        },
      ],
    },
    {
      heading: "Appearance",
      items: [
        ...(
          [
            { value: "light", label: "Light", icon: Sun },
            { value: "dark", label: "Dark", icon: Moon },
            { value: "system", label: "System", icon: Monitor },
          ] as const
        ).map(({ value, label, icon }) => ({
          label: `Theme: ${label}`,
          icon,
          keywords: [value, "appearance", "theme"],
          checked: theme === value,
          action: () => setTheme(value),
        })),
        {
          label: collapsed ? "Expand sidebar" : "Collapse sidebar",
          icon: collapsed ? PanelLeftOpen : PanelLeftClose,
          keywords: ["sidebar", "navigation", "appearance"],
          action: toggleSidebar,
        },
      ],
    },
    {
      heading: "App",
      items: [
        ...(!update || (update.supported && update.configured)
          ? [
              {
                label: "Check for updates",
                icon: RefreshCw,
                keywords: ["version", "upgrade"],
                disabled: unavailable || busy || checkingUpdates,
                action: native(() => checkUpdates(true), false),
              },
            ]
          : []),
        ...(update?.available
          ? [
              {
                label: "Download update",
                icon: Download,
                keywords: ["version", "upgrade"],
                disabled: unavailable || busy,
                action: native(backend.downloadUpdate, false),
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
    <Command label="Yap commands" vimBindings={false}>
      <CommandInput
        ref={input}
        placeholder="Search commands or dictation history…"
        aria-label="Search commands or dictation history"
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
                {checked && <span className="sr-only"> (current)</span>}
                {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {(!search || searchingHistory) && (
          <CommandGroup heading={search ? "History matches" : "Recent dictations"} forceMount>
            {searchingHistory && (
              <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
                {result?.query !== search
                  ? "Searching history…"
                  : result.failed
                    ? "History search failed."
                    : !entries.length
                      ? "No matching dictations."
                      : `${entries.length} matching dictations`}
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
                    .slice(0, 120) || "Untitled dictation"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleDateString(undefined, {
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
          <CommandGroup heading="Search history" forceMount>
            <CommandItem
              value="search-all-history"
              keywords={["history", "search", search]}
              forceMount
              onSelect={() => select(() => navigate(`/history?q=${encodeURIComponent(search)}`))}
            >
              <Search aria-hidden="true" />
              <span className="truncate">Search all history for &quot;{search}&quot;</span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}
