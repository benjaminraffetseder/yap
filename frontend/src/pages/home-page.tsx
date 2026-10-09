import { AudioImportButton } from "@/components/audio-import-button";
import { useDictation } from "@/components/dictation-provider";
import { DictationRow } from "@/components/dictation-row";
import { Button, buttonVariants } from "@/components/ui/button";
import { CircularProgress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { backend, duration, isBusy, isDesktop } from "@/lib/backend";
import { SetupPage } from "@/pages/setup-page";
import { ArrowRight, AudioLines, Download, Keyboard, Loader2, Mic, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
export function HomePage() {
  const { snapshot, loading, level, run, installModel } = useDictation();
  const { status, settings, history, ready } = snapshot;
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const recording = status.phase === "recording";
  const downloading = status.phase === "downloading";
  const downloadPercent = Math.round(Math.min(1, Math.max(0, status.progress)) * 100);
  const working = isBusy(status.phase) && !recording;
  const activeModel = snapshot.models.find(
    (model) => model.path === settings.modelPath && model.installed,
  );
  const selectedModel = activeModel
    ? `model:${activeModel.id}`
    : settings.modelPath
      ? `custom:${settings.modelPath}`
      : null;
  const modelOptions = snapshot.models.map((model) => ({
    value: `model:${model.id}`,
    label: model.name,
    download: !model.installed,
  }));
  if (settings.modelPath && !activeModel) {
    modelOptions.unshift({
      value: selectedModel!,
      label: settings.modelPath.split(/[\\/]/).pop() || "Custom model",
      download: false,
    });
  }
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [recording]);
  async function record() {
    setPending(true);
    await run(recording ? backend.stop : backend.start);
    setPending(false);
  }
  async function selectModel(value: string | null) {
    if (
      !isDesktop ||
      loading ||
      pending ||
      switchingModel ||
      isBusy(status.phase) ||
      value === selectedModel
    )
      return;
    const model = snapshot.models.find((model) => `model:${model.id}` === value);
    if (!model) return;
    setSwitchingModel(true);
    try {
      if (model.installed) {
        await run(() => backend.settings({ ...settings, modelPath: model.path }));
      } else {
        await installModel(model);
      }
    } finally {
      setSwitchingModel(false);
    }
  }
  if (isDesktop && !loading && !settings.setupComplete) return <SetupPage />;
  return (
    <div className="space-y-8">
      <section
        aria-label="Dictation recorder"
        className={`overflow-hidden rounded-2xl border bg-card transition-colors ${recording ? "border-primary/40" : ""}`}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 sm:px-8">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AudioLines className="size-4 text-primary" aria-hidden="true" />
            Voice to text
          </span>
          <AudioImportButton showDownloadProgress={false} />
        </header>
        <div className="flex flex-col items-center justify-center gap-7 px-6 py-10 text-center sm:flex-row sm:gap-10 sm:px-8 sm:py-12 sm:text-left">
          <div className="relative flex size-40 shrink-0 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full border border-primary/10 bg-primary/5"
            />
            <span
              aria-hidden="true"
              className="absolute inset-3 rounded-full border border-primary/15 transition-transform duration-150 motion-reduce:transition-none"
              style={{ transform: recording ? `scale(${1 + level * 0.15})` : undefined }}
            />
            {downloading && (
              <CircularProgress
                aria-label="Download progress"
                value={downloadPercent}
                className="absolute size-32"
              />
            )}
            <button
              disabled={!isDesktop || !ready || working || loading || pending || switchingModel}
              onClick={() => void record()}
              aria-label={recording ? "Stop recording" : "Start recording"}
              className={`relative flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/15 transition-transform hover:scale-105 active:scale-95 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:transition-none disabled:cursor-default disabled:hover:scale-100 ${downloading ? "disabled:opacity-100" : "disabled:opacity-50"}`}
            >
              {downloading ? (
                <span className="font-mono text-xl font-medium tabular-nums">
                  {downloadPercent}%
                </span>
              ) : working || pending ? (
                <Loader2 className="size-8 animate-spin motion-reduce:animate-none" />
              ) : recording ? (
                <Square className="size-7 fill-current" />
              ) : (
                <Mic className="size-9" />
              )}
            </button>
          </div>
          <div className="w-full min-w-0 space-y-3 sm:max-w-80">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {loading
                ? "Connecting…"
                : recording
                  ? "Recording"
                  : working
                    ? status.message
                    : ready
                      ? "Ready to record"
                      : "Install a speech model"}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {loading
                ? "Getting your dictation tools ready."
                : recording
                  ? "Speak naturally. Click stop when you’re finished."
                  : downloading
                    ? "Your speech model is on its way."
                    : working
                      ? "You can start another dictation when this finishes."
                      : ready
                        ? "Click the microphone to start, or use your shortcut."
                        : "Choose a model to turn your voice into text."}
            </p>
            {recording && (
              <div className="flex items-center justify-center gap-4 pt-2 sm:justify-start">
                <span className="font-mono text-sm tabular-nums text-primary">
                  {duration(Math.max(0, now - status.startedAt))}
                </span>
                <div aria-hidden="true" className="flex h-8 items-center gap-1 text-primary">
                  {Array.from({ length: 17 }, (_, index) => (
                    <span
                      key={index}
                      className="w-1 rounded-full bg-current transition-[height] duration-150 motion-reduce:transition-none"
                      style={{ height: `${4 + level * (12 + 16 * Math.sin(index * 1.7) ** 2)}px` }}
                    />
                  ))}
                </div>
              </div>
            )}
            {downloading && (
              <Button variant="outline" size="sm" onClick={() => void run(backend.cancel, false)}>
                Cancel download
              </Button>
            )}
            {!ready && !working && !loading && (
              <Link to="/models" className={buttonVariants({ className: "rounded-lg" })}>
                <Download className="size-4" />
                Download model
              </Link>
            )}
          </div>
        </div>
        {(ready || snapshot.models.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-t bg-background/30 px-6 py-4 sm:px-8">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-xs text-muted-foreground">Speech model</span>
              <Select
                items={modelOptions}
                value={selectedModel}
                disabled={
                  !isDesktop || loading || pending || switchingModel || isBusy(status.phase)
                }
                onValueChange={(value) => void selectModel(value)}
              >
                <SelectTrigger aria-label="Speech model" className="w-48 max-w-full bg-background">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                      {model.download && (
                        <Download
                          role="img"
                          aria-label="Download required"
                          className="size-3.5 text-muted-foreground translate-y-0.5"
                        />
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {ready && !working && !loading && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Keyboard className="mr-1 size-4" aria-hidden="true" />
                <span className="mr-1">{settings.interaction === "hold" ? "Hold" : "Press"}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {settings.shortcut.split("+").map((key, index) => (
                    <span key={key} className="flex items-center gap-1.5">
                      {index > 0 && (
                        <span aria-hidden="true" className="text-muted-foreground/60">
                          +
                        </span>
                      )}
                      <kbd className="rounded-md border bg-background px-1.5 py-1 font-mono text-[11px] text-foreground shadow-xs">
                        {key}
                      </kbd>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </section>
      {status.shortcutError && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
        >
          Global shortcut unavailable: {status.shortcutError}{" "}
          <Link to="/settings" className="underline">
            Change shortcut
          </Link>
        </p>
      )}
      {status.indicatorError && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
        >
          {status.indicatorError}
        </p>
      )}
      {status.trayError && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
        >
          {status.trayError}
        </p>
      )}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent dictations</h2>
          <Link
            to="/history"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            View all
            <ArrowRight className="size-3" />
          </Link>
        </div>
        {history.length ? (
          <div className="overflow-hidden rounded-xl border bg-card/60">
            {history.slice(0, 3).map((entry) => (
              <DictationRow
                entry={entry}
                to={`/history/${encodeURIComponent(entry.id)}`}
                key={entry.id}
                showDate
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed px-6 py-7 text-center text-sm text-muted-foreground">
            No dictations yet.
          </div>
        )}
      </section>
    </div>
  );
}
