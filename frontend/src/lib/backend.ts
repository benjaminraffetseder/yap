import {
  AddVocabularyTerm,
  ApplyDictationProfile,
  BeginShortcutCapture,
  Cancel,
  CancelTextProcessing,
  CancelBulkTextQueue,
  CheckForUpdates,
  ClearFinishedImports,
  ClearFinishedBulkTextJobs,
  CompleteSetup,
  CopyText,
  DeleteDictationProfile,
  DeleteSession,
  DeleteSessionOutput,
  DeleteSessions,
  DiscardBackupPreview,
  DismissLatestResult,
  EndShortcutCapture,
  ExportBackup,
  ExportTranscripts,
  GenerateSessionOutput,
  GenerateSessionTitle,
  GetAudio,
  GetAudioSupport,
  GetDiagnosticChecks,
  GetHistory,
  GetHomeResult,
  GetMicrophones,
  GetProfileApplications,
  GetRecentlyDeleted,
  GetRevisions,
  GetSession,
  GetSessionOutputs,
  GetSnapshot,
  GetTranscriptExportPreview,
  HomeResultAction,
  ImportAudio,
  ImportDroppedAudio,
  InstallAudioSupport,
  InstallModel,
  ListTextModels,
  OpenUpdateDownload,
  PermanentlyDeleteSessions,
  PreviewBackup,
  ProcessText,
  QueueBulkText,
  RefinePrompt,
  RegenerateSessionOutput,
  RemoveImport,
  RemoveModel,
  RenameSession,
  ReorderImportQueue,
  RestartSetup,
  RestoreBackup,
  RestoreSessions,
  RetryImport,
  RetryShortcut,
  SaveDictationProfile,
  SaveLatestResult,
  SaveProfileAutomation,
  SaveSettings,
  SaveTextProcessing,
  SaveTranscript,
  SaveVocabulary,
  SelectFile,
  SetSaveHistory,
  StartDiagnosticTest,
  StartMicrophoneTest,
  StartRecording,
  StopDiagnosticTest,
  StopMicrophoneTest,
  StopRecording,
  TestTextModel,
} from "@bindings/yap/app";
import type { Config } from "@bindings/yap/internal/inference/text/models";
export { isDesktop } from "@/lib/desktop";
export type { TranscriptExportPreview, TranscriptExportRequest } from "@bindings/yap/models";
export type { BulkTextJob } from "@bindings/yap/models";
export type BulkTextRequest = {
  selection: TranscriptExportSelection;
  action: "title" | "output";
  promptId: string;
  replaceTitles: boolean;
};
export type TranscriptExportSelection = {
  sessionIds: string[];
  allMatching: boolean;
  query: string;
  excludedSessionIds?: string[];
};
export type DictationProfile = {
  id: string;
  name: string;
  modelPath: string;
  language: string;
  cleanText: boolean;
  autoPromptId: string;
};
export type ProfileApplication = { id: string; name: string };
export type AppProfileRule = { applicationId: string; applicationName: string; profileId: string };
export type TextPrompt = { id: string; name: string; instruction: string };
export type RevisionKind = "prompt" | "chain" | "vocabulary" | "transcript";
export type Revision = { id: number; createdAt: string; updatedAt: string; value: string };
export type PromptChainStep = { id: string; promptId: string; input: string };
export type PromptChain = { id: string; name: string; steps: PromptChainStep[] };
export type TextProcessing = {
  enabled: boolean;
  endpoint: string;
  model: string;
  autoPromptId: string;
  prompts: TextPrompt[];
  chains?: PromptChain[];
};
export type ProcessingOption = { value: string; label: string; isChain?: boolean };
export function processingOptions(config: TextProcessing): ProcessingOption[] {
  return [
    ...config.prompts.map((prompt) => ({ value: prompt.id, label: prompt.name })),
    ...(config.chains ?? []).map((chain) => ({
      value: chain.id,
      label: chain.name,
      isChain: true,
    })),
  ];
}
export const defaultTextProcessing: TextProcessing = {
  enabled: false,
  endpoint: "http://127.0.0.1:11434/v1",
  model: "",
  autoPromptId: "",
  chains: [],
  prompts: [
    {
      id: "cleanup",
      name: "Cleanup",
      instruction:
        "Fix punctuation, capitalization, and obvious grammar mistakes. Remove filler words and accidental repetitions. Preserve meaning, names, technical terms, and the original language. Return only the cleaned text.",
    },
    {
      id: "summary",
      name: "Summary",
      instruction:
        "Summarize the transcript concisely in its original language. Preserve key facts, names, decisions, and action items. Do not invent details. Return only the summary.",
    },
  ],
};
export const backendVersionMismatchMessage =
  "Yap's interface and backend are different versions. Quit and reopen Yap. In development, restart wails3 dev.";
export type Settings = {
  microphoneId: string;
  whisperPath: string;
  modelPath: string;
  language: string;
  shortcut: string;
  interaction: string;
  autoCopy: boolean;
  autoPaste: boolean;
  saveHistory: boolean;
  saveAudio: boolean;
  launchAtLogin: boolean;
  startInTray: boolean;
  cleanText: boolean;
  setupComplete: boolean;
  historyRetentionDays: number;
  statsForNerds?: boolean;
};
export type VocabularyEntry = {
  id: string;
  canonical: string;
  aliases: string[];
  enabled: boolean;
};
export type DiagnosticResult = {
  phase: string;
  message: string;
  details: string;
  transcript: string;
  durationMs: number;
};
export type DiagnosticCheck = {
  id: string;
  name: string;
  ready: boolean;
  message: string;
};
export type Microphone = { id: string; name: string };
export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  supported: boolean;
  configured: boolean;
  checkedAt: string;
  downloadURL: string;
  notes: string;
  error: string;
  message: string;
};
export type AudioSupport = {
  installed: boolean;
  managed: boolean;
  path: string;
  canDownload: boolean;
  size: number;
  message: string;
};
export type Session = {
  id: string;
  title?: string;
  createdAt: string;
  durationMs: number;
  rawTranscript: string;
  finalTranscript: string;
  speechModel: string;
  language: string;
  audioPath: string;
  deletedAt?: string;
  stats?: { transcriptionMs: number; engine: string } | null;
};
export type TextStats = {
  durationMs: number;
  responseMs: number;
  attempts: number;
  model: string;
  finishReason?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  generationTokensPerSecond?: number | null;
};
export type GeneratedOutput = {
  id: string;
  sessionId: string;
  createdAt: string;
  prompt: TextPrompt;
  model: string;
  endpoint: string;
  input: string;
  text: string;
  stats?: TextStats | null;
  chain?: {
    runId: string;
    chainId: string;
    name: string;
    stepId: string;
    step: number;
    total: number;
    input: string;
    sourceOutputId: string;
  } | null;
};
export type HomeResult = {
  session: Session;
  outputs: GeneratedOutput[];
  text: string;
  outputId: string;
  revision: string;
  saved: boolean;
  imported: boolean;
  outcomes: Record<"transcription" | "history" | "processing" | "clipboard" | "paste", string>;
};
export type HistoryPageResult = {
  entries: Session[];
  total: number;
  page: number;
  pageSize: number;
};
export type ImportJob = {
  id: string;
  name: string;
  state: string;
  message: string;
  sessionId: string;
  transcript: string;
  error: string;
  progress: number;
};
export const importPending = (job: ImportJob) =>
  ["queued", "preparing", "transcribing", "processing"].includes(job.state);

export type Status = {
  importId?: string;
  profileId?: string;
  profileShortcutError?: string;
  completionWarning?: boolean;
  phase: string;
  message: string;
  startedAt: number;
  transcript: string;
  progress: number;
  shortcutError: string;
  indicatorError: string;
  trayError: string;
  startupError: string;
  historyError: string;
};
export type Model = {
  id: string;
  name: string;
  description: string;
  size: number;
  installed: boolean;
  path: string;
  diskBytes: number;
  removable: boolean;
};
export type Snapshot = {
  bulkTextQueue?: import("@bindings/yap/models").BulkTextJob[];
  importQueue?: ImportJob[];
  appProfileRules?: AppProfileRule[];
  profileShortcut?: string;
  dictationProfiles?: DictationProfile[];
  activeProfileId?: string;
  defaultProfileId?: string;
  profileModified?: boolean;
  recordingSaveHistory?: boolean;
  latestResult?: {
    session: Session;
    output?: GeneratedOutput | null;
    outputs?: GeneratedOutput[];
    text: string;
  } | null;
  textProcessing: TextProcessing;
  settings: Settings;
  status: Status;
  history: Session[];
  models: Model[];
  dataDir: string;
  ready: boolean;
  floatingIndicator: boolean;
  launchAtLoginAvailable: boolean;
  startInTrayAvailable: boolean;
  vocabulary: VocabularyEntry[];
  microphoneTested: boolean;
  shortcutTested: boolean;
  diagnostic: DiagnosticResult;
};
export type BackupSummary = {
  sessions: number;
  duplicateSessions: number;
  outputs: number;
  duplicateOutputs: number;
  prompts: number;
  skippedPrompts: number;
  chains?: number;
  skippedChains?: number;
  vocabulary: number;
  skippedVocabulary: number;
  recordings: number;
  missingRecordings: number;
};
export type BackupPreferences = Pick<
  Settings,
  "language" | "interaction" | "autoCopy" | "autoPaste" | "saveAudio" | "cleanText"
> & { saveHistory?: boolean | null };
export type BackupPreview = {
  id: string;
  filename: string;
  createdAt: string;
  preferences: BackupPreferences;
  summary: BackupSummary;
};

function normalizeTextProcessing(config: Config): TextProcessing {
  return {
    ...config,
    prompts: config.prompts ?? [],
    chains: (config.chains ?? []).map((chain) => ({ ...chain, steps: chain.steps ?? [] })),
  };
}

async function updateHistorySessions(ids: string[], update: (batch: string[]) => Promise<void>) {
  // Native history mutations accept at most 50 IDs per call. Infinite scrolling
  // lets a selection span multiple batches, including a deletion's Undo action.
  if (ids.length <= 50) return update(ids);
  for (let offset = 0; offset < ids.length; offset += 50) {
    await update(ids.slice(offset, offset + 50));
  }
}

export const backend = {
  queueBulkText: (request: BulkTextRequest): Promise<number> =>
    QueueBulkText({
      ...request,
      selection: {
        ...request.selection,
        excludedSessionIds: request.selection.excludedSessionIds ?? [],
      },
    }),
  cancelBulkTextQueue: CancelBulkTextQueue,
  clearFinishedBulkTextJobs: ClearFinishedBulkTextJobs,
  homeResult: async (): Promise<HomeResult | null> => {
    const result = await GetHomeResult();
    return result && { ...result, outputs: result.outputs ?? [] };
  },
  homeResultAction: HomeResultAction,
  revisions: async (kind: RevisionKind, itemId: string): Promise<Revision[]> =>
    (await GetRevisions(kind, itemId)) ?? [],
  profileApplications: async (): Promise<ProfileApplication[]> => {
    return (await GetProfileApplications()) ?? [];
  },
  saveProfileAutomation: async (rules: AppProfileRule[], shortcut: string): Promise<void> => {
    return SaveProfileAutomation(rules, shortcut);
  },
  saveProfile: async (profile: DictationProfile): Promise<DictationProfile> => {
    return SaveDictationProfile(profile);
  },
  applyProfile: async (id: string): Promise<void> => {
    return ApplyDictationProfile(id);
  },
  deleteProfile: async (id: string): Promise<void> => {
    return DeleteDictationProfile(id);
  },
  checkUpdates: async (manual: boolean): Promise<UpdateStatus> => {
    return CheckForUpdates(manual);
  },
  downloadUpdate: OpenUpdateDownload,
  reorderImports: async (ids: string[]): Promise<void> => {
    return ReorderImportQueue(ids);
  },
  removeImport: async (id: string): Promise<void> => {
    return RemoveImport(id);
  },
  retryImport: async (id: string): Promise<void> => {
    return RetryImport(id);
  },
  clearFinishedImports: async (): Promise<void> => {
    return ClearFinishedImports();
  },
  importDroppedAudio: async (paths: string[]): Promise<void> => {
    return ImportDroppedAudio(paths);
  },
  audioSupport: async (): Promise<AudioSupport> => {
    return GetAudioSupport();
  },
  installAudioSupport: async (): Promise<void> => {
    return InstallAudioSupport();
  },
  importAudio: async (): Promise<void> => {
    return ImportAudio();
  },
  exportBackup: async (audio: boolean): Promise<BackupSummary | null> => {
    return ExportBackup(audio);
  },
  previewBackup: async (): Promise<BackupPreview | null> => {
    return PreviewBackup();
  },
  restoreBackup: async (id: string, preferences: boolean): Promise<BackupSummary> => {
    return RestoreBackup(id, preferences);
  },
  discardBackup: async (id: string): Promise<void> => {
    return DiscardBackupPreview(id);
  },
  snapshot: async (): Promise<Snapshot> => {
    const value = await GetSnapshot();
    // A long-running dev backend can predate the frontend and generated bindings.
    // Keep the last safe snapshot instead of rendering incompatible page state.
    if (!value.textProcessing || !Array.isArray(value.textProcessing.prompts)) {
      throw new Error(backendVersionMismatchMessage);
    }
    return {
      ...value,
      textProcessing: normalizeTextProcessing(value.textProcessing),
      importQueue: value.importQueue ?? [],
      bulkTextQueue: value.bulkTextQueue ?? [],
      appProfileRules: value.appProfileRules ?? [],
      dictationProfiles: value.dictationProfiles ?? [],
      history: value.history ?? [],
      models: value.models ?? [],
      vocabulary: (value.vocabulary ?? []).map((entry) => ({
        ...entry,
        aliases: entry.aliases ?? [],
      })),
      latestResult: value.latestResult && {
        ...value.latestResult,
        outputs: value.latestResult.outputs ?? [],
      },
    };
  },
  start: StartRecording,
  stop: StopRecording,
  cancel: Cancel,
  microphones: async (): Promise<Microphone[]> => (await GetMicrophones()) ?? [],
  settings: (settings: Settings) =>
    SaveSettings({ ...settings, statsForNerds: settings.statsForNerds ?? false }),
  setSaveHistory: SetSaveHistory,
  saveLatestResult: SaveLatestResult,
  dismissLatestResult: DismissLatestResult,
  selectFile: SelectFile,
  install: InstallModel,
  vocabulary: SaveVocabulary,
  testMic: StartMicrophoneTest,
  stopMicTest: StopMicrophoneTest,
  completeSetup: CompleteSetup,
  restartSetup: RestartSetup,
  diagnosticChecks: async (): Promise<DiagnosticCheck[]> => (await GetDiagnosticChecks()) ?? [],
  testDictation: StartDiagnosticTest,
  stopDictationTest: StopDiagnosticTest,
  copy: CopyText,
  remove: DeleteSession,
  audio: GetAudio,
  exportTranscripts: ExportTranscripts,
  exportPreview: async (selection: TranscriptExportSelection) => {
    const result = await GetTranscriptExportPreview({
      ...selection,
      excludedSessionIds: selection.excludedSessionIds ?? [],
    });
    return { ...result, sessionIds: result.sessionIds ?? [], outputs: result.outputs ?? [] };
  },
  saveTranscript: SaveTranscript,
  renameSession: RenameSession,
  generateSessionTitle: GenerateSessionTitle,
  addVocabularyTerm: AddVocabularyTerm,
  history: async (query: string, page: number): Promise<HistoryPageResult> => {
    const result = await GetHistory(query, page);
    return { ...result, entries: result.entries ?? [] };
  },
  recentlyDeleted: async (query: string, page: number): Promise<HistoryPageResult> => {
    const result = await GetRecentlyDeleted(query, page);
    return { ...result, entries: result.entries ?? [] };
  },
  restoreSessions: async (ids: string[]): Promise<void> => {
    return updateHistorySessions(ids, RestoreSessions);
  },
  permanentlyDeleteSessions: async (ids: string[]): Promise<void> => {
    return updateHistorySessions(ids, PermanentlyDeleteSessions);
  },
  session: async (id: string): Promise<Session | null> => {
    return GetSession(id);
  },
  generatedOutputs: async (id: string): Promise<GeneratedOutput[]> => {
    // Go serializes the zero-value chain for standalone prompts as an object.
    return ((await GetSessionOutputs(id)) ?? []).map((output) => ({
      ...output,
      chain: output.chain?.runId ? output.chain : null,
    }));
  },
  generateOutput: async (
    requestID: string,
    sessionID: string,
    promptID: string,
  ): Promise<string> => {
    return GenerateSessionOutput(requestID, sessionID, promptID);
  },
  regenerateOutput: async (
    requestID: string,
    sessionID: string,
    outputID: string,
  ): Promise<string> => {
    return RegenerateSessionOutput(requestID, sessionID, outputID);
  },
  deleteOutput: async (sessionID: string, outputID: string): Promise<void> => {
    return DeleteSessionOutput(sessionID, outputID);
  },
  removeSessions: async (ids: string[]): Promise<void> => {
    return updateHistorySessions(ids, DeleteSessions);
  },
  removeModel: RemoveModel,
  beginShortcutCapture: BeginShortcutCapture,
  endShortcutCapture: EndShortcutCapture,
  retryShortcut: async (): Promise<void> => {
    return RetryShortcut();
  },
  textProcessing: async (config: TextProcessing): Promise<TextProcessing> =>
    normalizeTextProcessing(await SaveTextProcessing({ ...config, chains: config.chains ?? [] })),
  processText: ProcessText,
  cancelTextProcessing: CancelTextProcessing,
  testTextModel: TestTextModel,
  refinePrompt: async (
    id: string,
    endpoint: string,
    model: string,
    instruction: string,
  ): Promise<string> => {
    return RefinePrompt(id, endpoint, model, instruction);
  },
  listTextModels: async (id: string, endpoint: string): Promise<string[]> => {
    return (await ListTextModels(id, endpoint)) ?? [];
  },
};
export function isBusy(phase: string) {
  return [
    "backup",
    "recording",
    "transcribing",
    "text-processing",
    "downloading",
    "mic-test",
    "diagnostic-recording",
    "diagnostic-transcribing",
  ].includes(phase);
}
export function message(cause: unknown) {
  if (cause instanceof Error && cause.name === "ReferenceError") {
    return backendVersionMismatchMessage;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
