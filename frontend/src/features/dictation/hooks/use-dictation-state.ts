import type {
  Configuration,
  ImportJob,
  Model,
  ModelCatalog,
  RuntimeSnapshot,
  Snapshot,
  Status,
  UpdateStatus,
} from "@/lib/backend";
import { emptySnapshot } from "@/lib/queries/resource-defaults";
import { useConfiguration, useModelCatalog, useVocabulary } from "@/lib/queries/saved-queries";
import { createContext, useContext, useMemo, type Context } from "react";

type Actions = {
  refresh: () => Promise<void>;
  run: (action: () => Promise<unknown>, reload?: boolean) => Promise<void>;
  installModel: (model: Model) => Promise<void>;
  clearError: () => void;
};
type Connection = { loading: boolean; error: string; savedReadError: Error | null };
type Metadata = Omit<RuntimeSnapshot, "status" | "importQueue" | "bulkTextQueue">;
type AppUpdates = {
  update: UpdateStatus | null;
  checkingUpdates: boolean;
  installingUpdate: boolean;
  updateError: string;
  checkUpdates: (manual?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
};
export const dictationContexts = {
  actions: createContext<Actions | null>(null),
  connection: createContext<Connection | null>(null),
  metadata: createContext<Metadata | null>(null),
  status: createContext<Status | null>(null),
  activity: createContext<Omit<Status, "message" | "progress" | "transcript"> | null>(null),
  phase: createContext<string | null>(null),
  imports: createContext<ImportJob[] | null>(null),
  textQueue: createContext<NonNullable<Snapshot["bulkTextQueue"]> | null>(null),
  updates: createContext<AppUpdates | null>(null),
  processing: createContext<{
    processingPanelOpen: boolean;
    setProcessingPanelOpen: (open: boolean) => void;
  } | null>(null),
  microphoneTest: createContext<{
    microphoneTestVisible: boolean;
    setMicrophoneTestVisible: (visible: boolean) => void;
  } | null>(null),
  modelDownload: createContext<{ downloadingModelId: string | null } | null>(null),
  level: createContext(0),
};
function useRequiredContext<T>(context: Context<T | null>): T {
  const value = useContext(context);
  if (value === null) throw new Error("DictationProvider is missing");
  return value;
}
export const useDictationActions = () => useRequiredContext(dictationContexts.actions);
export const useDictationConnection = () => useRequiredContext(dictationContexts.connection);
export const useDictationMetadata = () => useRequiredContext(dictationContexts.metadata);
export const useDictationStatus = () => useRequiredContext(dictationContexts.status);
export const useDictationActivity = () => useRequiredContext(dictationContexts.activity);
export const useDictationPhase = () => useRequiredContext(dictationContexts.phase);
export const useImportQueue = () => useRequiredContext(dictationContexts.imports);
export const useBulkTextQueue = () => useRequiredContext(dictationContexts.textQueue);
export const useAppUpdates = () => useRequiredContext(dictationContexts.updates);
export const useProcessingPanelState = () => useRequiredContext(dictationContexts.processing);
export const useMicrophoneTestState = () => useRequiredContext(dictationContexts.microphoneTest);
export const useModelDownload = () => useRequiredContext(dictationContexts.modelDownload);
export const useAudioLevel = () => useContext(dictationContexts.level);
export const useSavedConfiguration = (): Configuration => useConfiguration().data ?? emptySnapshot;
export const useSavedModelCatalog = (): ModelCatalog => useModelCatalog().data ?? emptySnapshot;
export const useSavedVocabulary = () => useVocabulary().data ?? emptySnapshot.vocabulary;

// This is a projection of Query data, not another saved-data cache. Runtime
// events cannot notify these observers unless the saved resources also change.
export function useSavedSnapshot() {
  const { data: configuration } = useConfiguration();
  const { data: catalog } = useModelCatalog();
  const { data: vocabulary } = useVocabulary();
  return useMemo(
    () => ({
      settings: configuration?.settings ?? emptySnapshot.settings,
      textProcessing: configuration?.textProcessing ?? emptySnapshot.textProcessing,
      appProfileRules: configuration?.appProfileRules ?? emptySnapshot.appProfileRules,
      profileShortcut: configuration?.profileShortcut ?? emptySnapshot.profileShortcut,
      dictationProfiles: configuration?.dictationProfiles ?? emptySnapshot.dictationProfiles,
      activeProfileId: configuration?.activeProfileId ?? emptySnapshot.activeProfileId,
      defaultProfileId: configuration?.defaultProfileId ?? emptySnapshot.defaultProfileId,
      profileModified: configuration?.profileModified ?? emptySnapshot.profileModified,
      ready: configuration?.ready ?? emptySnapshot.ready,
      models: catalog?.models ?? emptySnapshot.models,
      textModels: catalog?.textModels ?? emptySnapshot.textModels,
      textRuntimeAvailable: catalog?.textRuntimeAvailable ?? emptySnapshot.textRuntimeAvailable,
      recommendedTextContext:
        catalog?.recommendedTextContext ?? emptySnapshot.recommendedTextContext,
      vocabulary: vocabulary ?? emptySnapshot.vocabulary,
    }),
    [configuration, catalog, vocabulary],
  );
}

// Compatibility hooks retain the old interface. App components use the focused
// hooks above so unrelated domains do not become implicit subscriptions.
export function useDictationState() {
  const saved = useSavedSnapshot();
  const metadata = useDictationMetadata();
  const status = useDictationStatus();
  const importQueue = useImportQueue();
  const bulkTextQueue = useBulkTextQueue();
  const actions = useDictationActions();
  const connection = useDictationConnection();
  const updates = useAppUpdates();
  const processing = useProcessingPanelState();
  const microphone = useMicrophoneTestState();
  const download = useModelDownload();
  return {
    snapshot: { ...emptySnapshot, ...metadata, ...saved, status, importQueue, bulkTextQueue },
    importQueue,
    ...actions,
    ...connection,
    ...updates,
    ...processing,
    ...microphone,
    ...download,
  };
}
export function useDictation() {
  const value = useDictationState();
  const level = useAudioLevel();
  return { ...value, level };
}
