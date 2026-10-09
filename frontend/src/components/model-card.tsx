import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Model } from "@/lib/backend";
import { cn } from "@/lib/utils";
import {
  AudioLines,
  Check,
  Download,
  HardDrive,
  Loader2,
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";

const modelProfiles: Record<string, { icon: typeof Zap; focus: string; useCase: string }> = {
  tiny: { icon: Zap, focus: "Speed first", useCase: "Quick notes & short dictation" },
  base: { icon: AudioLines, focus: "Everyday", useCase: "Your day-to-day dictation" },
  small: { icon: Sparkles, focus: "Accuracy first", useCase: "When the details matter" },
};

type ModelCardProps = {
  model: Model;
  selectedModelPath: string;
  disabled: boolean;
  sizeLabel: string;
  download?: { percent: number; message: string };
  onUse: () => void;
  onRemove: () => void;
  onCancelDownload: () => void;
};

export function ModelCard({
  model,
  selectedModelPath,
  disabled,
  sizeLabel,
  download,
  onUse,
  onRemove,
  onCancelDownload,
}: ModelCardProps) {
  const selected = selectedModelPath === model.path && model.installed;
  const active = !!model.path && selectedModelPath === model.path;
  const repair = model.removable && !model.installed;
  const isDownloading = !!download;
  const profile = modelProfiles[model.id];
  const Icon = profile?.icon ?? AudioLines;

  return (
    <section
      aria-labelledby={`model-${model.id}-heading`}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border bg-card p-5 transition-colors sm:p-6",
        selected || isDownloading ? "border-primary/40" : "hover:border-muted-foreground/30",
      )}
    >
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex size-10 items-center justify-center rounded-xl border bg-background/50 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        {profile && (
          <span className="text-xs font-medium text-muted-foreground">{profile.focus}</span>
        )}
      </div>
      <h3 id={`model-${model.id}-heading`} className="text-lg font-semibold tracking-tight">
        {model.name}
      </h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{model.description}</p>
      <div className="mt-6 mb-5 flex-1 space-y-4 border-t pt-4">
        {profile && (
          <div>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Best for
            </p>
            <p className="mt-1 text-sm">{profile.useCase}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <HardDrive className="size-3.5" aria-hidden="true" />
            {model.diskBytes ? "On disk" : "Download size"}
          </span>
          <span className="font-medium tabular-nums">{sizeLabel}</span>
        </div>
        {!isDownloading && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {model.installed ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <span className="mx-1 size-1.5 rounded-full bg-muted-foreground/50" />
            )}
            {model.installed ? "Downloaded" : repair ? "Repair needed" : "Not downloaded"}
          </p>
        )}
      </div>
      {download ? (
        <div aria-live="polite" className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs font-medium text-primary">
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Downloading
            </span>
            <span className="tabular-nums">{download.percent}%</span>
          </div>
          <Progress aria-label="Model download progress" value={download.percent} />
          <p className="text-xs leading-5 break-words text-muted-foreground">{download.message}</p>
          <Button
            variant="outline"
            className="h-10 w-full rounded-lg"
            aria-label="Cancel download"
            onClick={onCancelDownload}
          >
            <X className="size-3.5" aria-hidden="true" />
            Cancel download
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            className={cn(
              "h-10 flex-1 rounded-lg",
              selected &&
                "border-primary/20 bg-primary/10 text-primary disabled:opacity-100 dark:bg-primary/10",
            )}
            variant={selected ? "outline" : "default"}
            disabled={disabled || selected}
            onClick={onUse}
          >
            {selected ? (
              <>
                <Check className="size-4" />
                Active
              </>
            ) : model.installed ? (
              "Use model"
            ) : (
              <>
                <Download className="size-4" />
                {repair ? "Repair & use" : "Download & use"}
              </>
            )}
          </Button>
          {model.removable && (
            <Button
              size="icon"
              variant="ghost"
              className="size-10 rounded-lg text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${model.name}`}
              disabled={disabled || active}
              title={
                active ? "Switch to another model before removing this one" : `Remove ${model.name}`
              }
              onClick={onRemove}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
