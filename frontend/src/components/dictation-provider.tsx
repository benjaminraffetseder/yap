import { toastManager } from "@/components/ui/toast";
import {
  backend,
  defaultTextProcessing,
  isBusy,
  isDesktop,
  message,
  type Model,
  type Snapshot,
  type Status,
} from "@/lib/backend";
import { EventsOn } from "@wails/runtime/runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
const empty: Snapshot = {
  textProcessing: defaultTextProcessing,
  settings: {
    microphoneId: "",
    whisperPath: "",
    modelPath: "",
    language: "auto",
    shortcut: "Ctrl+Alt+Space",
    interaction: "hold",
    autoCopy: true,
    autoPaste: true,
    saveAudio: false,
    launchAtLogin: false,
    startInTray: false,
    cleanText: false,
    setupComplete: false,
    historyRetentionDays: 0,
  },
  status: {
    phase: "idle",
    message: "Ready when you are",
    startedAt: 0,
    transcript: "",
    progress: 0,
    shortcutError: "",
    indicatorError: "",
    trayError: "",
    startupError: "",
    historyError: "",
  },
  models: [
    {
      id: "tiny",
      name: "Whisper Tiny",
      size: 77691713,
      description: "Fastest · short dictation",
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "base",
      name: "Whisper Base",
      size: 147951465,
      description: "Lightweight · everyday dictation",
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "small",
      name: "Whisper Small",
      size: 487601967,
      description: "Balanced · better accuracy",
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
  ],
  history: [],
  dataDir: "",
  ready: false,
  floatingIndicator: false,
  launchAtLoginAvailable: false,
  startInTrayAvailable: false,
  vocabulary: [],
  microphoneTested: false,
  shortcutTested: false,
  diagnostic: {
    phase: "",
    message: "",
    details: "",
    transcript: "",
    durationMs: 0,
  },
};
type Context = {
  snapshot: Snapshot;
  level: number;
  error: string;
  loading: boolean;
  downloadingModelId: string | null;
  refresh: () => Promise<void>;
  run: (action: () => Promise<unknown>, reload?: boolean) => Promise<void>;
  installModel: (model: Model) => Promise<void>;
  clearError: () => void;
};
const DictationContext = createContext<Context | null>(null);
export function DictationProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(empty);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(isDesktop);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const snapshotRequest = useRef(0);
  const statusRevision = useRef(0);
  const modelDownload = useRef<{ model: Model; started: boolean } | null>(null);
  const refresh = useCallback(async () => {
    if (!isDesktop) return;
    const request = ++snapshotRequest.current;
    const revision = statusRevision.current;
    let value: Snapshot;
    try {
      value = await backend.snapshot();
    } catch (cause) {
      // An obsolete failure is as stale as an obsolete successful snapshot.
      if (request !== snapshotRequest.current) return;
      throw cause;
    }
    if (request !== snapshotRequest.current) return;
    // Bridge replies may arrive out of order or after a newer status event.
    setSnapshot((old) =>
      request !== snapshotRequest.current
        ? old
        : {
            ...value,
            status: revision === statusRevision.current ? value.status : old.status,
          },
    );
    setLoading(false);
  }, []);
  async function run(action: () => Promise<unknown>, reload = true) {
    setError("");
    try {
      await action();
      if (reload) await refresh();
    } catch (cause) {
      setError(message(cause));
    }
  }
  async function installModel(model: Model) {
    if (!isDesktop || loading || isBusy(snapshot.status.phase) || modelDownload.current) return;
    modelDownload.current = { model, started: false };
    setDownloadingModelId(model.id);
    setError("");
    toastManager.close("speech-model-download");
    try {
      await backend.install(model.id);
    } catch (cause) {
      modelDownload.current = null;
      setDownloadingModelId(null);
      toastManager.add({
        id: "speech-model-download",
        type: "error",
        title: message(cause),
        priority: "high",
        timeout: 8000,
      });
      return;
    }
    await refresh().catch((cause) => setError(message(cause)));
  }
  useEffect(() => {
    if (!isDesktop || !snapshot.status.shortcutError || isBusy(snapshot.status.phase)) return;
    let pending = false;
    const retry = () => {
      if (pending) return;
      pending = true;
      // Returning from macOS Settings should recover without a restart. The
      // backend protects recording/capture and preserves registration errors.
      void backend
        .retryShortcut()
        .then(refresh)
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    window.addEventListener("focus", retry);
    return () => window.removeEventListener("focus", retry);
  }, [snapshot.status.shortcutError, snapshot.status.phase, refresh]);
  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    const offStatus = EventsOn("dictation:status", (status: Status) => {
      if (!active) return;
      statusRevision.current++;
      setSnapshot((old) => ({ ...old, status }));
      const download = modelDownload.current;
      if (!download) return;
      if (status.phase === "downloading") download.started = true;
      else if (download.started && (status.phase === "idle" || status.phase === "error")) {
        modelDownload.current = null;
        setDownloadingModelId(null);
        // InstallModel ends with idle on success or cancellation, and error on failure.
        if (status.phase === "error")
          toastManager.add({
            id: "speech-model-download",
            type: "error",
            title: status.message,
            priority: "high",
            timeout: 8000,
          });
        else if (status.message === "Model installed. Ready to dictate.")
          toastManager.add({
            id: "speech-model-download",
            type: "success",
            title: `${download.model.name} downloaded and ready to use.`,
          });
      }
    });
    const offLevel = EventsOn("dictation:level", (value: number) => {
      if (active) setLevel(value);
    });
    const offHistory = EventsOn("dictation:history", () => {
      void refresh().catch((cause) => {
        if (active) setError(message(cause));
      });
    });
    const offSetup = EventsOn("setup:changed", () => {
      void refresh().catch((cause) => {
        if (active) setError(message(cause));
      });
    });
    void refresh().catch((cause) => {
      if (active) setError(message(cause));
    });
    return () => {
      active = false;
      snapshotRequest.current++;
      offStatus();
      offLevel();
      offHistory();
      offSetup();
    };
  }, [refresh]);
  return (
    <DictationContext.Provider
      value={{
        snapshot,
        level,
        error,
        loading,
        downloadingModelId,
        refresh,
        run,
        installModel,
        clearError: () => setError(""),
      }}
    >
      {children}
    </DictationContext.Provider>
  );
}
export function useDictation() {
  const value = useContext(DictationContext);
  if (!value) throw new Error("DictationProvider is missing");
  return value;
}
