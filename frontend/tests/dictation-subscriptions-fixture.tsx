/* eslint-disable react-refresh/only-export-components -- This isolated browser fixture mounts itself. */
import { Profiler, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { DictationProvider } from "../src/components/dictation-provider";
import {
  useDictationActions,
  useDictationPhase,
  useDictationStatus,
  useDictationActivity,
  useImportQueue,
  useAudioLevel,
  useDictationConnection,
} from "../src/lib/dictation-state";
import { UpdatePanel } from "../src/components/update-panel";
import { ProcessingPanel } from "../src/components/processing-panel";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { MemoryRouter } from "react-router";
import { createQueryClient } from "../src/lib/resource-queries";
import { emptySnapshot } from "../src/lib/resource-defaults";
import { useConfiguration } from "../src/lib/saved-queries";

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
Object.assign(Reflect.get(window, "mockBackend").main.App, {
  GetSnapshot: async () => structuredClone(snapshot),
  CheckForUpdates: async () => structuredClone(update),
  GetUpdateStatus: async () => structuredClone(update),
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
