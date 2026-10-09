import { useDictation } from "@/components/dictation-provider";
import { ModelCard } from "@/components/model-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backend, isBusy, isDesktop, message, type Model } from "@/lib/backend";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  AudioLines,
  Check,
  FolderOpen,
  HardDrive,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

export function ModelsPage({ embedded = false }: { embedded?: boolean }) {
  const { snapshot, run, refresh, loading, installModel, downloadingModelId } = useDictation();
  const [removing, setRemoving] = useState<Model | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { status, settings, models } = snapshot;
  const downloading = status.phase === "downloading";
  const busy = isBusy(status.phase) || loading || downloadingModelId !== null;
  const downloadPercent = Math.round(Math.min(1, Math.max(0, status.progress)) * 100);
  const megabytes = (bytes: number) =>
    `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`;
  const diskBytes = models.reduce((sum, model) => sum + (model.diskBytes ?? 0), 0);
  const installedCount = models.filter((model) => model.installed).length;
  const currentModel = models.find((model) => !!model.path && settings.modelPath === model.path);
  const currentReady = currentModel ? currentModel.installed : snapshot.ready;
  async function remove() {
    if (!removing || pending) return;
    setPending(true);
    setError("");
    try {
      await backend.removeModel(removing.id);
      setRemoving(null);
      await run(refresh, false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-7">
      {!embedded && (
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Models</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Find the right balance of speed, size, and accuracy.
            </p>
          </div>
          <div
            role="group"
            aria-label="Model storage"
            className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
          >
            <HardDrive className="size-4 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium tabular-nums">{megabytes(diskBytes)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {installedCount} {installedCount === 1 ? "model" : "models"} downloaded
              </p>
            </div>
          </div>
        </header>
      )}
      {settings.modelPath && (
        <section
          aria-label="Current speech model"
          className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:flex sm:flex-wrap sm:p-6"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <AudioLines className="size-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Your current model</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <p className="text-lg font-semibold tracking-tight">
                {currentModel?.name ?? "Custom model"}
              </p>
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5",
                  currentReady && "border-primary/20 bg-primary/10 text-primary",
                )}
              >
                {currentReady && <Check aria-hidden="true" />}
                {currentReady ? "Active" : "Needs attention"}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {currentReady
                ? "Selected for your next dictation."
                : "Check your model and runtime to get ready to dictate."}
            </p>
          </div>
          {currentModel?.installed && (
            <Button
              size="sm"
              variant="outline"
              className="col-span-2 justify-self-start rounded-lg bg-transparent"
              disabled={!isDesktop || busy || pending}
              onClick={() => void installModel(currentModel)}
            >
              <Wrench className="size-3.5" aria-hidden="true" />
              Check &amp; repair runtime
            </Button>
          )}
        </section>
      )}
      {status.phase === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm whitespace-pre-wrap text-destructive"
        >
          {status.message}
        </p>
      )}
      <section aria-labelledby="model-library-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="model-library-heading" className="text-sm font-semibold">
            Choose your model
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Dictation runs on your device
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selectedModelPath={settings.modelPath}
              disabled={!isDesktop || busy || pending}
              sizeLabel={megabytes(model.diskBytes || model.size)}
              download={
                downloading && downloadingModelId === model.id
                  ? { percent: downloadPercent, message: status.message }
                  : undefined
              }
              onUse={() =>
                void (model.installed
                  ? run(() => backend.settings({ ...settings, modelPath: model.path }))
                  : installModel(model))
              }
              onRemove={() => {
                setError("");
                setRemoving(model);
              }}
              onCancelDownload={() => void run(backend.cancel)}
            />
          ))}
        </div>
      </section>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-5 py-4">
        <FolderOpen className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Bring your own model</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Use local model files or an existing Whisper installation.
          </p>
        </div>
        <Link
          className="flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          to="/settings"
        >
          Open Settings
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <Dialog
        open={!!removing}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              This removes {megabytes(removing?.diskBytes ?? 0)} from this device. You can download
              the model again.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending || busy} onClick={() => void remove()}>
              {pending ? "Removing…" : "Remove model"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
