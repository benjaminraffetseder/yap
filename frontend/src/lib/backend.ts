import { Cancel, CompleteSetup, CopyText, DeleteSession, ExportSession, GetAudio, GetMicrophones, GetSnapshot, InstallModel, RestartSetup, SaveSettings, SaveVocabulary, SelectFile, StartMicrophoneTest, StartRecording, StopMicrophoneTest, StopRecording } from "@wails/go/main/App"
export const isDesktop = typeof window !== "undefined" && "go" in window
export type Settings = { microphoneId: string; whisperPath: string; modelPath: string; language: string; shortcut: string; interaction: string; autoPaste: boolean; saveAudio: boolean; launchAtLogin: boolean; startInTray: boolean; cleanText: boolean; setupComplete: boolean }
export type VocabularyEntry = { id: string; canonical: string; aliases: string[]; enabled: boolean }
export type Microphone = { id: string; name: string }
export type Session = { id: string; createdAt: string; durationMs: number; rawTranscript: string; finalTranscript: string; speechModel: string; language: string; audioPath: string }
export type Status = { phase: string; message: string; startedAt: number; transcript: string; progress: number; shortcutError: string; indicatorError: string; trayError: string; startupError: string }
export type Model = { id: string; name: string; description: string; size: number; installed: boolean; path: string }
export type Snapshot = { settings: Settings; status: Status; history: Session[]; models: Model[]; dataDir: string; ready: boolean; floatingIndicator: boolean; launchAtLoginAvailable: boolean; startInTrayAvailable: boolean; vocabulary: VocabularyEntry[]; microphoneTested: boolean; shortcutTested: boolean }
export const backend = {
  snapshot: async (): Promise<Snapshot> => GetSnapshot(), start: StartRecording, stop: StopRecording, cancel: Cancel,
  microphones: async (): Promise<Microphone[]> => GetMicrophones(),
  settings: SaveSettings, selectFile: SelectFile, install: InstallModel,
  vocabulary: SaveVocabulary, testMic: StartMicrophoneTest, stopMicTest: StopMicrophoneTest, completeSetup: CompleteSetup, restartSetup: RestartSetup,
  copy: CopyText, remove: DeleteSession, audio: GetAudio, export: ExportSession,
}
export function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
export function duration(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` }
