import {
  AddVocabularyTerm,
  ApplyDictationProfile,
  BeginShortcutCapture,
  Cancel,
  CancelTextProcessing,
  CheckForUpdates,
  ClearFinishedImports,
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
  ExportSession,
  ExportSessions,
  GenerateSessionOutput,
  GetAudio,
  GetAudioSupport,
  GetDiagnosticChecks,
  GetHistory,
  GetMicrophones,
  GetProfileApplications,
  GetRecentlyDeleted,
  GetRevisions,
  GetSession,
  GetSessionOutputs,
  GetSnapshot,
  ImportAudio,
  ImportDroppedAudio,
  InstallAudioSupport,
  InstallModel,
  ListTextModels,
  OpenUpdateDownload,
  PermanentlyDeleteSessions,
  PreviewBackup,
  ProcessText,
  RefinePrompt,
  RegenerateSessionOutput,
  RemoveImport,
  RemoveModel,
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
} from "@wails/go/main/App";
import { storage, text } from "@wails/go/models";
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
export const isDesktop = typeof window !== "undefined" && "go" in window;
export const backendVersionMismatchMessage =
  "Yap's interface and backend are different versions. Quit and reopen Yap. In development, restart wails dev.";
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
  createdAt: string;
  durationMs: number;
  rawTranscript: string;
  finalTranscript: string;
  speechModel: string;
  language: string;
  audioPath: string;
  deletedAt?: string;
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
  chain?: {
    runId: string;
    chainId: string;
    name: string;
    stepId: string;
    step: number;
    total: number;
    input: string;
    sourceOutputId: string;
  };
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
    output?: GeneratedOutput;
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
> & { saveHistory?: boolean };
export type BackupPreview = {
  id: string;
  filename: string;
  createdAt: string;
  preferences: BackupPreferences;
  summary: BackupSummary;
};
function requireBackupAPI(name: string) {
  const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (typeof api?.[name] !== "function")
    throw new Error(
      "Backups need the current backend. Quit and reopen Yap; in development, restart wails dev.",
    );
}
function requireOutputAPI(name: string) {
  const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (typeof api?.[name] !== "function")
    throw new Error(
      "Saved outputs need the current backend. Quit and reopen Yap; in development, restart wails dev.",
    );
}
function requireProfileAPI(name: string) {
  const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (typeof api?.[name] !== "function")
    throw new Error(
      "Dictation profiles need the current backend. Quit and reopen Yap; in development, restart wails dev.",
    );
}

function requireImportQueueAPI(name: string) {
  const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (typeof api?.[name] !== "function") throw new Error(backendVersionMismatchMessage);
}

export const backend = {
  revisions: (kind: RevisionKind, itemId: string): Promise<Revision[]> =>
    GetRevisions(kind, itemId),
  profileApplications: async (): Promise<ProfileApplication[]> => {
    requireProfileAPI("GetProfileApplications");
    return GetProfileApplications();
  },
  saveProfileAutomation: async (rules: AppProfileRule[], shortcut: string): Promise<void> => {
    requireProfileAPI("SaveProfileAutomation");
    return SaveProfileAutomation(
      rules.map((rule) => storage.AppProfileRule.createFrom(rule)),
      shortcut,
    );
  },
  saveProfile: async (profile: DictationProfile): Promise<DictationProfile> => {
    requireProfileAPI("SaveDictationProfile");
    return SaveDictationProfile(storage.DictationProfile.createFrom(profile));
  },
  applyProfile: async (id: string): Promise<void> => {
    requireProfileAPI("ApplyDictationProfile");
    return ApplyDictationProfile(id);
  },
  deleteProfile: async (id: string): Promise<void> => {
    requireProfileAPI("DeleteDictationProfile");
    return DeleteDictationProfile(id);
  },
  checkUpdates: async (manual: boolean): Promise<UpdateStatus> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.CheckForUpdates !== "function") throw new Error(backendVersionMismatchMessage);
    return CheckForUpdates(manual);
  },
  downloadUpdate: OpenUpdateDownload,
  reorderImports: async (ids: string[]): Promise<void> => {
    requireImportQueueAPI("ReorderImportQueue");
    return ReorderImportQueue(ids);
  },
  removeImport: async (id: string): Promise<void> => {
    requireImportQueueAPI("RemoveImport");
    return RemoveImport(id);
  },
  retryImport: async (id: string): Promise<void> => {
    requireImportQueueAPI("RetryImport");
    return RetryImport(id);
  },
  clearFinishedImports: async (): Promise<void> => {
    requireImportQueueAPI("ClearFinishedImports");
    return ClearFinishedImports();
  },
  importDroppedAudio: async (paths: string[]): Promise<void> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.ImportDroppedAudio !== "function")
      throw new Error(
        "Audio import needs the current backend. Quit and reopen Yap; in development, restart wails dev.",
      );
    return ImportDroppedAudio(paths);
  },
  audioSupport: async (): Promise<AudioSupport> => {
    requireAudioSupportAPI("GetAudioSupport");
    return GetAudioSupport();
  },
  installAudioSupport: async (): Promise<void> => {
    requireAudioSupportAPI("InstallAudioSupport");
    return InstallAudioSupport();
  },
  importAudio: async (): Promise<void> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.ImportAudio !== "function")
      throw new Error(
        "Audio import needs the current backend. Quit and reopen Yap; in development, restart wails dev.",
      );
    return ImportAudio();
  },
  exportBackup: async (audio: boolean): Promise<BackupSummary | null> => {
    requireBackupAPI("ExportBackup");
    return ExportBackup(audio);
  },
  previewBackup: async (): Promise<BackupPreview | null> => {
    requireBackupAPI("PreviewBackup");
    return PreviewBackup();
  },
  restoreBackup: async (id: string, preferences: boolean): Promise<BackupSummary> => {
    requireBackupAPI("RestoreBackup");
    return RestoreBackup(id, preferences);
  },
  discardBackup: async (id: string): Promise<void> => {
    requireBackupAPI("DiscardBackupPreview");
    return DiscardBackupPreview(id);
  },
  snapshot: async (): Promise<Snapshot> => {
    const value = await GetSnapshot();
    // A long-running dev backend can predate the frontend and generated bindings.
    // Keep the last safe snapshot instead of rendering incompatible page state.
    if (!value.textProcessing || !Array.isArray(value.textProcessing.prompts)) {
      throw new Error(backendVersionMismatchMessage);
    }
    return value;
  },
  start: StartRecording,
  stop: StopRecording,
  cancel: Cancel,
  microphones: async (): Promise<Microphone[]> => GetMicrophones(),
  settings: SaveSettings,
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
  diagnosticChecks: async (): Promise<DiagnosticCheck[]> => GetDiagnosticChecks(),
  testDictation: StartDiagnosticTest,
  stopDictationTest: StopDiagnosticTest,
  copy: CopyText,
  remove: DeleteSession,
  audio: GetAudio,
  export: ExportSession,
  saveTranscript: SaveTranscript,
  addVocabularyTerm: AddVocabularyTerm,
  history: async (query: string, page: number): Promise<HistoryPageResult> =>
    GetHistory(query, page),
  recentlyDeleted: async (query: string, page: number): Promise<HistoryPageResult> => {
    requireHistoryRecoveryAPI("GetRecentlyDeleted");
    return GetRecentlyDeleted(query, page);
  },
  restoreSessions: async (ids: string[]): Promise<void> => {
    requireHistoryRecoveryAPI("RestoreSessions");
    return RestoreSessions(ids);
  },
  permanentlyDeleteSessions: async (ids: string[]): Promise<void> => {
    requireHistoryRecoveryAPI("PermanentlyDeleteSessions");
    return PermanentlyDeleteSessions(ids);
  },
  session: async (id: string): Promise<Session | null> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.GetSession !== "function")
      throw new Error(
        "Dictation pages need the current backend. Quit and reopen Yap; in development, restart wails dev.",
      );
    return GetSession(id);
  },
  generatedOutputs: async (id: string): Promise<GeneratedOutput[]> => {
    requireOutputAPI("GetSessionOutputs");
    return GetSessionOutputs(id);
  },
  generateOutput: async (
    requestID: string,
    sessionID: string,
    promptID: string,
  ): Promise<string> => {
    requireOutputAPI("GenerateSessionOutput");
    return GenerateSessionOutput(requestID, sessionID, promptID);
  },
  regenerateOutput: async (
    requestID: string,
    sessionID: string,
    outputID: string,
  ): Promise<string> => {
    requireOutputAPI("RegenerateSessionOutput");
    return RegenerateSessionOutput(requestID, sessionID, outputID);
  },
  deleteOutput: async (sessionID: string, outputID: string): Promise<void> => {
    requireOutputAPI("DeleteSessionOutput");
    return DeleteSessionOutput(sessionID, outputID);
  },
  removeSessions: async (ids: string[]): Promise<void> => {
    // Older backends delete permanently and cannot honor the Undo action.
    requireHistoryRecoveryAPI("RestoreSessions");
    return DeleteSessions(ids);
  },
  exportSessions: ExportSessions,
  removeModel: RemoveModel,
  beginShortcutCapture: BeginShortcutCapture,
  endShortcutCapture: EndShortcutCapture,
  retryShortcut: async (): Promise<void> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.RetryShortcut !== "function") throw new Error(backendVersionMismatchMessage);
    return RetryShortcut();
  },
  textProcessing: async (config: TextProcessing): Promise<TextProcessing> =>
    SaveTextProcessing(text.Config.createFrom(config)),
  processText: ProcessText,
  cancelTextProcessing: CancelTextProcessing,
  testTextModel: TestTextModel,
  refinePrompt: async (
    id: string,
    endpoint: string,
    model: string,
    instruction: string,
  ): Promise<string> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.RefinePrompt !== "function")
      throw new Error(
        "Prompt refinement needs the current backend. Quit and reopen Yap; in development, restart wails dev.",
      );
    return RefinePrompt(id, endpoint, model, instruction);
  },
  listTextModels: async (id: string, endpoint: string): Promise<string[]> => {
    const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go
      ?.main?.App;
    if (typeof api?.ListTextModels !== "function") {
      throw new Error(
        "Model discovery needs the current backend. Quit and reopen Yap; in development, restart wails dev.",
      );
    }
    return ListTextModels(id, endpoint);
  },
};
function requireHistoryRecoveryAPI(name: string) {
  const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (typeof api?.[name] !== "function")
    throw new Error(
      "History recovery needs the current backend. Quit and reopen Yap; in development, restart wails dev.",
    );
}
function requireAudioSupportAPI(name: string) {
  const api = (window as unknown as { go?: { main?: { App?: Record<string, unknown> } } }).go?.main
    ?.App;
  if (typeof api?.[name] !== "function")
    throw new Error(
      "Audio support settings need the current backend. Quit and reopen Yap; in development, restart wails dev.",
    );
}
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
  return cause instanceof Error ? cause.message : String(cause);
}
export function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
