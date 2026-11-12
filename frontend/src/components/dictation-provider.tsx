import { toastManager } from "@/components/ui/toast";
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  defaultTextProcessing,
  importPending,
  isBusy,
  isDesktop,
  message,
  type ImportJob,
  type Model,
  type Snapshot,
  type Status,
  type UpdateStatus,
} from "@/lib/backend";
import { processingActivity } from "@/lib/processing-activity";
import { Events } from "@wailsio/runtime";
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
    saveHistory: true,
    saveAudio: false,
    launchAtLogin: false,
    startInTray: false,
    cleanText: false,
    setupComplete: false,
    historyRetentionDays: 0,
    statsForNerds: false,
  },
  status: {
    phase: "idle",
    message: i18n.t("dictationProvider.readyWhenYouAre"),
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
      description: i18n.t("dictationProvider.fastestShortDictation"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "base",
      name: "Whisper Base",
      size: 147951465,
      description: i18n.t("dictationProvider.lightweightEverydayDictation"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "small",
      name: "Whisper Small",
      size: 487601967,
      description: i18n.t("dictationProvider.balancedBetterAccuracy"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "medium",
      name: "Whisper Medium",
      size: 1533763059,
      description: i18n.t("dictationProvider.higherAccuracyMoreMemory"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "large-v3",
      name: "Whisper Large v3",
      size: 3095033483,
      description: i18n.t("dictationProvider.largeV3HighestMemoryUse"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "parakeet-tdt-0.6b-v3",
      name: "NVIDIA Parakeet TDT v3",
      size: 713975456,
      description: i18n.t("dictationProvider.25EuropeanLanguagesAutomaticDetection"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "moonshine-v2-tiny",
      name: "Moonshine V2 Tiny",
      size: 45233659,
      description: i18n.t("dictationProvider.englishOnlyFastest"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "moonshine-v2-small",
      name: "Moonshine V2 Small",
      size: 142300974,
      description: i18n.t("dictationProvider.englishOnlyVeryFast"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "moonshine-v2-medium",
      name: "Moonshine V2 Medium",
      size: 269141623,
      description: i18n.t("dictationProvider.englishOnlyBetterAccuracy"),
      installed: false,
      path: "",
      diskBytes: 0,
      removable: false,
    },
    {
      id: "moonshine-base",
      name: "Moonshine Base",
      size: 141001190,
      description: i18n.t("dictationProvider.englishOnlyLightweight"),
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
  importQueue: ImportJob[];
  processingPanelOpen: boolean;
  setProcessingPanelOpen: (open: boolean) => void;
  update: UpdateStatus | null;
  checkingUpdates: boolean;
  installingUpdate: boolean;
  updateError: string;
  checkUpdates: (manual?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  snapshot: Snapshot;
  level: number;
  error: string;
  loading: boolean;
  downloadingModelId: string | null;
  microphoneTestVisible: boolean;
  setMicrophoneTestVisible: (visible: boolean) => void;
  refresh: () => Promise<void>;
  run: (action: () => Promise<unknown>, reload?: boolean) => Promise<void>;
  installModel: (model: Model) => Promise<void>;
  clearError: () => void;
};
const DictationContext = createContext<Context | null>(null);
export function DictationProvider({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const updateRequest = useRef(false);
  const [snapshot, setSnapshot] = useState(empty);
  // Follow activity until the user chooses visibility. New work never overrides
  // an explicit minimization, even across page changes or completed batches.
  const [processingPanelPreference, setProcessingPanelOpen] = useState<boolean | null>(null);
  const processingPanelOpen = processingPanelPreference ?? processingActivity(snapshot).hasActivity;
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(isDesktop);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [microphoneTestVisible, setMicrophoneTestVisible] = useState(false);
  const snapshotRequest = useRef(0);
  const statusRevision = useRef(0);
  const queueRevision = useRef(0);
  const textQueueRevision = useRef(0);
  const importQueueMinimized = useRef(false);
  importQueueMinimized.current = !processingPanelOpen;
  const queueWasPending = useRef(false);
  const knownImportIDs = useRef(new Set<string>());
  const importBatch = useRef(new Map<string, ImportJob>());
  const latestStatus = useRef(empty.status);
  const modelDownload = useRef<{ model: Model; started: boolean } | null>(null);
  const checkUpdates = useCallback(async (manual = true) => {
    if (!isDesktop || updateRequest.current) return;
    updateRequest.current = true;
    setCheckingUpdates(true);
    setUpdateError("");
    try {
      const value = await backend.checkUpdates(manual);
      setUpdate(value);
      setUpdateError(value.error);
    } catch (cause) {
      setUpdateError(message(cause));
    } finally {
      updateRequest.current = false;
      setCheckingUpdates(false);
    }
  }, []);
  const installUpdate = useCallback(async () => {
    if (!isDesktop || updateRequest.current) return;
    updateRequest.current = true;
    setInstallingUpdate(true);
    setUpdateError("");
    try {
      if (update?.ready) await backend.restartUpdate();
      else {
        await backend.installUpdate();
        const value = await backend.updateStatus();
        setUpdate(value);
        setUpdateError(value.error);
      }
    } catch (cause) {
      setUpdateError(message(cause));
    } finally {
      updateRequest.current = false;
      setInstallingUpdate(false);
    }
  }, [update?.ready]);
  useEffect(() => {
    if (isDesktop && !loading) void checkUpdates(false);
  }, [loading, checkUpdates]);
  useEffect(() => {
    if (!isDesktop) return;
    return Events.On("wails:updater:update-ready", (event) => {
      const release = event.data as { version?: string } | undefined;
      setUpdate(
        (value) =>
          value && {
            ...value,
            available: true,
            ready: true,
            latestVersion: release?.version ?? value.latestVersion,
          },
      );
      setUpdateError("");
    });
  }, []);
  const refresh = useCallback(async () => {
    if (!isDesktop) return;
    const request = ++snapshotRequest.current;
    const revision = statusRevision.current;
    const importRevision = queueRevision.current;
    const textRevision = textQueueRevision.current;
    let value: Snapshot;
    try {
      value = await backend.snapshot();
    } catch (cause) {
      // An obsolete failure is as stale as an obsolete successful snapshot.
      if (request !== snapshotRequest.current) return;
      throw cause;
    }
    if (request !== snapshotRequest.current) return;
    if (revision === statusRevision.current) latestStatus.current = value.status;
    if (importRevision === queueRevision.current) {
      const jobs = value.importQueue ?? [];
      queueWasPending.current = jobs.some(importPending);
      knownImportIDs.current = new Set(jobs.map((job) => job.id));
      for (const job of jobs)
        if (importPending(job) || importBatch.current.has(job.id))
          importBatch.current.set(job.id, job);
    }
    // Bridge replies may arrive out of order or after a newer status event.
    setSnapshot((old) =>
      request !== snapshotRequest.current
        ? old
        : {
            ...value,
            bulkTextQueue:
              textRevision === textQueueRevision.current
                ? (value.bulkTextQueue ?? [])
                : old.bulkTextQueue,
            importQueue:
              importRevision === queueRevision.current
                ? (value.importQueue ?? [])
                : old.importQueue,
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
    if (
      !isDesktop ||
      (!snapshot.status.shortcutError && !snapshot.status.profileShortcutError) ||
      isBusy(snapshot.status.phase)
    )
      return;
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
  }, [
    snapshot.status.shortcutError,
    snapshot.status.profileShortcutError,
    snapshot.status.phase,
    refresh,
  ]);
  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    const offStatus = Events.On("dictation:status", ({ data: status }: { data: Status }) => {
      if (!active) return;
      if (status.phase === "recording" || status.importId)
        toastManager.close("transcription-complete");
      const previous = latestStatus.current;
      latestStatus.current = status;
      statusRevision.current++;
      setSnapshot((old) => ({ ...old, status }));
      const download = modelDownload.current;
      // Notify on a completed operation, not on saved results loaded or restored
      // after manually processing text. Status refreshes must not replay a toast.
      if (!status.importId && status.phase === "done" && previous.phase === "transcribing") {
        const warning = status.completionWarning === true;
        toastManager.add({
          id: "transcription-complete",
          type: warning ? "warning" : "success",
          title: warning
            ? i18n.t("dictationProvider.transcriptReadyActionNeeded")
            : i18n.t("dictationProvider.transcriptionFinished"),
          description: warning
            ? i18n.t("dictationProvider.reviewTheLatestResultOnHomeYou")
            : nativeText(status.message),
          timeout: warning ? 0 : 5000,
          priority: warning ? "high" : "low",
          actionProps: {
            children: i18n.t("dictationProvider.viewResult"),
            onClick: () => {
              toastManager.close("transcription-complete");
              window.dispatchEvent(new Event("yap:show-result"));
            },
          },
        });
      } else if (
        !status.importId &&
        status.phase === "error" &&
        !download &&
        (previous.phase !== "error" || previous.message !== status.message)
      ) {
        setError(status.message);
      }
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
            title: nativeText(status.message),
            priority: "high",
            timeout: 8000,
          });
        else if (status.message === "Model installed. Ready to dictate.")
          toastManager.add({
            id: "speech-model-download",
            type: "success",
            title: i18n.t("dictationProvider.downloadedAndReadyToUse", {
              name: download.model.name,
            }),
          });
      }
    });
    const offQueue = Events.On("import:queue", ({ data: jobs }: { data: ImportJob[] }) => {
      if (!active) return;
      queueRevision.current++;
      const pending = jobs.some(importPending);
      if (!queueWasPending.current && pending) importBatch.current.clear();
      for (const job of jobs) {
        if (
          importBatch.current.has(job.id) ||
          importPending(job) ||
          !knownImportIDs.current.has(job.id)
        )
          importBatch.current.set(job.id, job);
      }
      knownImportIDs.current = new Set(jobs.map((job) => job.id));
      if (queueWasPending.current && !pending && importQueueMinimized.current) {
        const results = [...importBatch.current.values()];
        const done = results.filter((job) => job.state === "done").length;
        const failed = results.filter((job) => job.state === "failed").length;
        const cancelled = results.filter((job) => job.state === "cancelled").length;
        toastManager.add({
          id: "import-summary",
          title: [
            i18n.t("dictationProvider.finishedImport", { count: done }),
            failed ? i18n.t("dictationProvider.failedImports", { count: failed }) : "",
            cancelled ? i18n.t("dictationProvider.cancelledImports", { count: cancelled }) : "",
          ]
            .filter(Boolean)
            .join(", "),
          priority: "low",
          timeout: 5000,
        });
      }
      queueWasPending.current = pending;
      setSnapshot((old) => ({ ...old, importQueue: jobs }));
    });
    const offTextQueue = Events.On(
      "text:queue",
      ({ data }: { data: NonNullable<Snapshot["bulkTextQueue"]> }) => {
        if (!active) return;
        textQueueRevision.current++;
        setSnapshot((old) => ({ ...old, bulkTextQueue: data }));
      },
    );
    const offLevel = Events.On("dictation:level", ({ data: value }: { data: number }) => {
      if (active) setLevel(value);
    });
    const offHistory = Events.On("dictation:history", () => {
      void refresh().catch((cause) => {
        if (active) setError(message(cause));
      });
    });
    const offSetup = Events.On("setup:changed", () => {
      void refresh().catch((cause) => {
        if (active) setError(message(cause));
      });
    });
    const offProfile = Events.On(
      "profile:changed",
      ({ data: [name, error] }: { data: [string, string] }) => {
        if (!active) return;
        toastManager.add({
          type: error ? "error" : "success",
          title: error || i18n.t("dictationProvider.profile", { name: name }),
        });
      },
    );
    void refresh().catch((cause) => {
      if (active) setError(message(cause));
    });
    return () => {
      active = false;
      snapshotRequest.current++;
      offStatus();
      offQueue();
      offTextQueue();
      offLevel();
      offHistory();
      offSetup();
      offProfile();
    };
  }, [refresh]);
  return (
    <DictationContext.Provider
      value={{
        importQueue: snapshot.importQueue ?? [],
        processingPanelOpen,
        setProcessingPanelOpen,
        update,
        checkingUpdates,
        installingUpdate,
        updateError,
        checkUpdates,
        installUpdate,
        snapshot,
        level,
        error,
        loading,
        downloadingModelId,
        microphoneTestVisible,
        setMicrophoneTestVisible,
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
