/* eslint-disable react-refresh/only-export-components -- This isolated browser fixture mounts itself. */
import { QueryClientProvider } from "@tanstack/react-query";
import { Profiler, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { DictationProvider } from "../src/features/dictation/components/dictation-provider";
import {
  useAudioLevel,
  useDictationActions,
  useDictationActivity,
  useDictationConnection,
  useDictationPhase,
  useDictationStatus,
  useImportQueue,
} from "../src/features/dictation/hooks/use-dictation-state";
import { GeneratedOutputs } from "../src/features/processing/components/generated-outputs";
import { ProcessingPanel } from "../src/features/processing/components/processing-panel";
import { UpdatePanel } from "../src/features/updates/components/update-panel";
import "../src/index.css";
import { emptySnapshot } from "../src/lib/queries/resource-defaults";
import { createQueryClient } from "../src/lib/queries/resource-queries";
import { useConfiguration } from "../src/lib/queries/saved-queries";

const snapshot = structuredClone(emptySnapshot);
snapshot.ready = true;
snapshot.settings.setupComplete = true;
const update = {
  currentVersion: "0.11.0",
  latestVersion: "0.11.0",
  available: false,
  ready: false,
  supported: true,
  configured: true,
  checkedAt: "",
  notes: "",
  error: "",
  message: "",
};
Object.assign(Reflect.get(window, "mockBackend").app.App, {
  GetSnapshot: async () => structuredClone(snapshot),
  CheckForUpdates: async () => structuredClone(update),
  GetUpdateStatus: async () => structuredClone(update),
  GetSessionOutputs: async () => [
    {
      id: "render-check-output",
      sessionId: "render-check-session",
      createdAt: "2026-11-22T12:00:00Z",
      model: "local-model",
      endpoint: "http://localhost/v1",
      prompt: { id: "summary", name: "Summary", instruction: "Summarize the source." },
      input: "A saved source transcript.",
      text: "# Saved output\n\nA generated document stays unchanged during native progress updates.",
    },
  ],
});
const commits: Record<string, number> = {};
Reflect.set(window, "subscriptionFixture", {
  commits,
  snapshot,
  emit: (name: string, data: unknown) =>
    Reflect.get(window, "_wails").dispatchWailsEvent({ name, data }),
});
function Measure({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler
      id={id}
      onRender={() => {
        commits[id] = (commits[id] ?? 0) + 1;
      }}
    >
      {children}
    </Profiler>
  );
}
function Actions() {
  const { run } = useDictationActions();
  return <button onClick={() => void run(async () => {}, false)}>Run action</button>;
}
function Phase() {
  const phase = useDictationPhase();
  return <output data-testid="phase">{phase}</output>;
}
function Status() {
  const status = useDictationStatus();
  return <output data-testid="progress">{status.progress}</output>;
}
function Activity() {
  const activity = useDictationActivity();
  return <output data-testid="history-error">{activity.historyError}</output>;
}
function Queue() {
  const importQueue = useImportQueue();
  return <output data-testid="queue">{importQueue.length}</output>;
}
function Level() {
  const level = useAudioLevel();
  return <output data-testid="level">{level}</output>;
}
function Configuration() {
  const { data } = useConfiguration();
  return <output data-testid="configuration">{data?.settings.language}</output>;
}
function Connection() {
  const { loading } = useDictationConnection();
  return <output data-testid="connection">{loading ? "loading" : "ready"}</output>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={createQueryClient()}>
    <DictationProvider>
      <MemoryRouter>
        <TooltipProvider>
          <ProcessingPanel />
          <Measure id="outputs">
            <GeneratedOutputs
              sessionID="render-check-session"
              unavailable={false}
              onCopyTargetChange={() => undefined}
            />
          </Measure>
        </TooltipProvider>
      </MemoryRouter>
      <Measure id="actions">
        <Actions />
      </Measure>
      <Measure id="phase">
        <Phase />
      </Measure>
      <Measure id="status">
        <Status />
      </Measure>
      <Measure id="activity">
        <Activity />
      </Measure>
      <Measure id="queue">
        <Queue />
      </Measure>
      <Measure id="level">
        <Level />
      </Measure>
      <Measure id="configuration">
        <Configuration />
      </Measure>
      <Measure id="connection">
        <Connection />
      </Measure>
      <Measure id="updates">
        <UpdatePanel />
      </Measure>
    </DictationProvider>
  </QueryClientProvider>,
);
