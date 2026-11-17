import { AudioLevelProvider } from "@/features/dictation/components/audio-level-provider";
import { useDictationRuntime } from "@/features/dictation/hooks/use-dictation-runtime";
import { dictationContexts as contexts } from "@/features/dictation/hooks/use-dictation-state";
import { useAppUpdateState } from "@/features/updates/hooks/use-app-updates";
import { isDesktop, message, type ImportJob, type Snapshot } from "@/lib/backend";
import {
  configurationQuery,
  modelCatalogQuery,
  vocabularyQuery,
} from "@/lib/queries/resource-queries";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

// eslint-disable-next-line react-refresh/only-export-components -- Preserve the existing public hooks during the context split.
export { useDictation, useDictationState } from "@/features/dictation/hooks/use-dictation-state";

const emptyImports: ImportJob[] = [];
const emptyTextQueue: NonNullable<Snapshot["bulkTextQueue"]> = [];

export function DictationProvider({ children }: { children: ReactNode }) {
  const configuration = useQuery({ ...configurationQuery, enabled: isDesktop });
  const vocabulary = useQuery({ ...vocabularyQuery, enabled: isDesktop });
  const catalog = useQuery({ ...modelCatalogQuery, enabled: isDesktop });
  const {
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
  } = useDictationRuntime();
  const updates = useAppUpdateState(loading);
  const savedError = configuration.error || vocabulary.error || catalog.error;
  const savedLoading = isDesktop && (!configuration.data || !vocabulary.data || !catalog.data);
  const [dismissedSavedError, setDismissedSavedError] = useState<unknown>(null);
  const latestSavedError = useRef(savedError);
  latestSavedError.current = savedError;
  const clearError = useCallback(() => {
    setError("");
    setDismissedSavedError(latestSavedError.current);
  }, [setError]);
  const actions = useMemo(
    () => ({ refresh, run, installModel, clearError }),
    [refresh, run, installModel, clearError],
  );
  const connectionError =
    error || (savedError && savedError !== dismissedSavedError ? message(savedError) : "");
  const connectionLoading = loading || savedLoading;
  const connection = useMemo(
    () => ({ error: connectionError, loading: connectionLoading, savedReadError: savedError }),
    [connectionError, connectionLoading, savedError],
  );
  // Status and queue events preserve these references. Metadata consumers do not
  // subscribe to progress just because they need a capability or diagnostic.
  const metadata = useMemo(
    () => ({
      history: runtime.history,
      dataDir: runtime.dataDir,
      floatingIndicator: runtime.floatingIndicator,
      launchAtLoginAvailable: runtime.launchAtLoginAvailable,
      startInTrayAvailable: runtime.startInTrayAvailable,
      microphoneTested: runtime.microphoneTested,
      shortcutTested: runtime.shortcutTested,
      diagnostic: runtime.diagnostic,
      recordingSaveHistory: runtime.recordingSaveHistory,
      latestResult: runtime.latestResult,
    }),
    [
      runtime.history,
      runtime.dataDir,
      runtime.floatingIndicator,
      runtime.launchAtLoginAvailable,
      runtime.startInTrayAvailable,
      runtime.microphoneTested,
      runtime.shortcutTested,
      runtime.diagnostic,
      runtime.recordingSaveHistory,
      runtime.latestResult,
    ],
  );
  const activity = useMemo(
    () => ({
      phase: runtime.status.phase,
      startedAt: runtime.status.startedAt,
      importId: runtime.status.importId,
      profileId: runtime.status.profileId,
      profileShortcutError: runtime.status.profileShortcutError,
      completionWarning: runtime.status.completionWarning,
      shortcutError: runtime.status.shortcutError,
      indicatorError: runtime.status.indicatorError,
      trayError: runtime.status.trayError,
      startupError: runtime.status.startupError,
      historyError: runtime.status.historyError,
    }),
    [
      runtime.status.phase,
      runtime.status.startedAt,
      runtime.status.importId,
      runtime.status.profileId,
      runtime.status.profileShortcutError,
      runtime.status.completionWarning,
      runtime.status.shortcutError,
      runtime.status.indicatorError,
      runtime.status.trayError,
      runtime.status.startupError,
      runtime.status.historyError,
    ],
  );
  const processing = useMemo(
    () => ({ processingPanelOpen, setProcessingPanelOpen }),
    [processingPanelOpen, setProcessingPanelOpen],
  );
  const microphone = useMemo(
    () => ({ microphoneTestVisible, setMicrophoneTestVisible }),
    [microphoneTestVisible, setMicrophoneTestVisible],
  );
  const modelDownload = useMemo(() => ({ downloadingModelId }), [downloadingModelId]);
  return (
    <AudioLevelProvider>
      <contexts.actions.Provider value={actions}>
        <contexts.connection.Provider value={connection}>
          <contexts.metadata.Provider value={metadata}>
            <contexts.status.Provider value={runtime.status}>
              <contexts.activity.Provider value={activity}>
                <contexts.phase.Provider value={runtime.status.phase}>
                  <contexts.imports.Provider value={runtime.importQueue ?? emptyImports}>
                    <contexts.textQueue.Provider value={runtime.bulkTextQueue ?? emptyTextQueue}>
                      <contexts.updates.Provider value={updates}>
                        <contexts.processing.Provider value={processing}>
                          <contexts.microphoneTest.Provider value={microphone}>
                            <contexts.modelDownload.Provider value={modelDownload}>
                              {children}
                            </contexts.modelDownload.Provider>
                          </contexts.microphoneTest.Provider>
                        </contexts.processing.Provider>
                      </contexts.updates.Provider>
                    </contexts.textQueue.Provider>
                  </contexts.imports.Provider>
                </contexts.phase.Provider>
              </contexts.activity.Provider>
            </contexts.status.Provider>
          </contexts.metadata.Provider>
        </contexts.connection.Provider>
      </contexts.actions.Provider>
    </AudioLevelProvider>
  );
}
