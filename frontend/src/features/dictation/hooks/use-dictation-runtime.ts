import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import { toastManager } from "@/components/ui/toast";
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  importPending,
  isBusy,
  isDesktop,
  message,
  type HomeResult,
  type ImportJob,
  type Model,
  type RuntimeSnapshot,
  type Snapshot,
  type Status,
} from "@/lib/backend";
import { processingActivity } from "@/features/processing/lib/processing-activity";
import { resourceKeys, refreshSaved, savedResources } from "@/lib/queries/resource-queries";
import { emptySnapshot as empty } from "@/lib/queries/resource-defaults";
import { useSavedActions } from "@/lib/queries/saved-queries";

export function useDictationRuntime() {
  const queryClient = useQueryClient();
  const { install } = useSavedActions();
  const [runtime, setSnapshot] = useState<RuntimeSnapshot>({
    status: empty.status,
    history: [],
    dataDir: "",
    floatingIndicator: false,
    launchAtLoginAvailable: false,
    startInTrayAvailable: false,
    microphoneTested: false,
    shortcutTested: false,
    diagnostic: empty.diagnostic,
  });
  // Follow activity until the user chooses visibility. New work never overrides
  // an explicit minimization, even across page changes or completed batches.
  const [processingPanelPreference, setProcessingPanelOpen] = useState<boolean | null>(null);
  const processingPanelOpen = processingPanelPreference ?? processingActivity(runtime).hasActivity;
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
  const refreshRuntime = useCallback(async () => {
    if (!isDesktop) return;
    const request = ++snapshotRequest.current;
    const revision = statusRevision.current;
    const importRevision = queueRevision.current;
    const textRevision = textQueueRevision.current;
    let value: RuntimeSnapshot;
    try {
      value = await backend.runtimeSnapshot();
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
  const refresh = useCallback(async () => {
    const failed = savedResources.filter(
      (resource) => queryClient.getQueryState(resourceKeys[resource])?.status === "error",
    );
    await Promise.all([
      refreshRuntime(),
      isDesktop && failed.length ? refreshSaved(queryClient, failed) : Promise.resolve(),
    ]);
  }, [refreshRuntime, queryClient]);
  const run = useCallback(
    async (action: () => Promise<unknown>, reload = true) => {
      setError("");
      try {
        await action();
        if (reload) await refresh();
      } catch (cause) {
        setError(message(cause));
      }
    },
    [refresh],
  );
  const current = useRef({ loading, phase: runtime.status.phase });
  current.current = { loading, phase: runtime.status.phase };
  const installModel = useCallback(
    async (model: Model) => {
      if (
        !isDesktop ||
        current.current.loading ||
        isBusy(current.current.phase) ||
        modelDownload.current
      )
        return;
      modelDownload.current = { model, started: false };
      setDownloadingModelId(model.id);
      setError("");
      toastManager.close("speech-model-download");
      try {
        await install(model.id);
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
    },
    [install, refresh],
  );
  useEffect(() => {
    if (
      !isDesktop ||
      (!runtime.status.shortcutError && !runtime.status.profileShortcutError) ||
      isBusy(runtime.status.phase)
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
    runtime.status.shortcutError,
    runtime.status.profileShortcutError,
    runtime.status.phase,
    refresh,
  ]);
  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    const offStatus = Events.On("dictation:status", ({ data: status }: { data: Status }) => {
      if (!active) return;
      // A status event supersedes an outstanding Home read, even when its
      // native promise cannot be stopped. Accepted capture expires temporary
      // text in the cache too, including while Home is unmounted.
      void queryClient.cancelQueries({ queryKey: resourceKeys.home });
      const accepted =
        status.phase === "recording" ||
        (!!status.importId && ["transcribing", "downloading"].includes(status.phase));
      if (accepted)
        queryClient.setQueryData<HomeResult | null>(resourceKeys.home, (value) =>
          value && !value.saved ? null : value,
        );
      void queryClient.invalidateQueries({
        queryKey: resourceKeys.home,
        refetchType: isBusy(status.phase) ? "none" : "active",
      });
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
    const offHistory = Events.On("dictation:history", () => {
      if (!active) return;
      // The event covers older sessions outside the snapshot's history subset.
      // Cancel first: invalidation alone can reuse an obsolete initial read.
      const filters = {
        queryKey: resourceKeys.all,
        predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[1] !== "chat",
      };
      void queryClient.cancelQueries(filters).then(() => {
        if (active) void queryClient.invalidateQueries(filters);
      });
      void refreshRuntime().catch((cause) => {
        if (active) setError(message(cause));
      });
    });
    const offSetup = Events.On("setup:changed", ({ data }) => {
      if (!active) return;
      const domains = Array.isArray(data)
        ? savedResources.filter((resource) => data.includes(resource))
        : savedResources;
      void refreshSaved(queryClient, domains).catch(() => {});
      // Unscoped events include backup restore and may replace session resources.
      if (!Array.isArray(data))
        void queryClient.cancelQueries({ queryKey: resourceKeys.all }).then(() => {
          if (active) void queryClient.invalidateQueries({ queryKey: resourceKeys.all });
        });
      void refreshRuntime().catch((cause) => {
        if (active) setError(message(cause));
      });
    });
    const offChat = Events.On("chat:changed", ({ data }: { data: string }) => {
      if (!active) return;
      const filters = { queryKey: resourceKeys.chat(data) };
      void queryClient.cancelQueries(filters).then(() => {
        if (active) void queryClient.invalidateQueries(filters);
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
    void refreshRuntime().catch((cause) => {
      if (active) setError(message(cause));
    });
    return () => {
      active = false;
      snapshotRequest.current++;
      offStatus();
      offQueue();
      offTextQueue();
      offHistory();
      offSetup();
      offChat();
      offProfile();
    };
  }, [refreshRuntime, queryClient]);
  return {
    runtime,
    error,
    setError,
    loading,
    downloadingModelId,
    microphoneTestVisible,
    setMicrophoneTestVisible,
    processingPanelOpen,
    setProcessingPanelOpen,
    refresh,
    run,
    installModel,
  };
}
