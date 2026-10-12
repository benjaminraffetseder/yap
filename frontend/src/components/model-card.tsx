import { useMotionPreference } from "@/lib/use-motion-preference";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Model } from "@/lib/backend";
import { modelProfiles, type ModelRating } from "@/lib/model-profiles";
import { cn } from "@/lib/utils";
import { Check, Download, HardDrive, Languages, Loader2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { MotionReveal } from "@/components/motion-reveal";
import { motionTransition } from "@/lib/motion";

function RatingBar({ name, rating }: { name: "Accuracy" | "Speed"; rating: ModelRating }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{name}</span>
        <span className="font-medium">{rating.label}</span>
      </div>
      <div
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={rating.score}
        aria-valuetext={rating.label}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full",
            name === "Accuracy"
              ? "bg-emerald-500 dark:bg-emerald-400"
              : "bg-sky-500 dark:bg-sky-400",
          )}
          style={{ width: `${(rating.score / 5) * 100}%` }}
        />
      </div>
    </div>
  );
}

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
  const reduced = useMotionPreference();

  return (
    <motion.section
      layout={reduced ? false : "position"}
      layoutDependency={isDownloading}
      transition={motionTransition("model", reduced)}
      aria-labelledby={`model-${model.id}-heading`}
      className={cn(
        "relative rounded-xl border bg-background/40 p-4 transition-colors sm:p-5",
        selected || isDownloading ? "border-primary/40" : "hover:border-muted-foreground/30",
      )}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-8">
        <div className="min-w-0">
          <h3 id={`model-${model.id}-heading`} className="text-base font-semibold tracking-tight">
            {model.name}
          </h3>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-muted-foreground">
            {profile?.tagline ?? model.description}
          </p>
        </div>
        {profile && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-1 sm:gap-3">
            <RatingBar name="Accuracy" rating={profile.accuracy} />
            <RatingBar name="Speed" rating={profile.speed} />
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-4 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {profile &&
            (profile.languages.length > 1 ? (
              <Tooltip>
                <TooltipTrigger
                  render={<Badge variant="outline" render={<button type="button" />} />}
                  className="h-6 cursor-help gap-1.5 border-border/80 text-muted-foreground hover:bg-muted"
                  aria-label={`Supported languages for ${model.name}`}
                  aria-describedby={`model-${model.id}-languages`}
                >
                  <Languages aria-hidden="true" />
                  Multilingual
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  className="block max-w-[min(32rem,calc(100vw-2rem))] px-3.5 py-3 leading-5"
                >
                  <p className="mb-1 font-semibold">{profile.languages.length} languages</p>
                  <p>{profile.languages.join(", ")}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Badge variant="outline" className="h-6 border-border/80 text-muted-foreground">
                English only
              </Badge>
            ))}
          <span className="flex items-center gap-1.5">
            <HardDrive className="size-3.5" aria-hidden="true" />
            <span>{model.diskBytes ? "On disk" : "Download size"}</span>
            <span className="font-medium text-foreground tabular-nums">{sizeLabel}</span>
          </span>
          {!isDownloading && (model.installed || repair) && (
            <span className="flex items-center gap-1.5">
              {model.installed && <Check className="size-3.5 text-primary" aria-hidden="true" />}
              {model.installed ? "Downloaded" : "Repair needed"}
            </span>
          )}
          {profile && profile.languages.length > 1 && (
            <span id={`model-${model.id}-languages`} className="sr-only">
              {profile.languages.length} languages: {profile.languages.join(", ")}
            </span>
          )}
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {!download && (
            <MotionReveal
              key={selected ? "active" : model.installed ? "installed" : "download"}
              preset="model"
              className="flex shrink-0 items-center gap-2"
            >
              <Button
                pressFeedback={!selected}
                className={cn(
                  "h-9 flex-1 rounded-lg sm:flex-none",
                  selected &&
                    "border-primary/20 bg-primary/10 text-primary disabled:opacity-100 dark:bg-primary/10",
                )}
                variant={selected ? "outline" : "default"}
                disabled={disabled || selected}
                onClick={onUse}
              >
                {selected ? (
                  <>
                    <Check className="size-4" aria-hidden="true" />
                    Active
                  </>
                ) : model.installed ? (
                  "Use model"
                ) : (
                  <>
                    <Download className="size-4" aria-hidden="true" />
                    {repair ? "Repair & use" : "Download & use"}
                  </>
                )}
              </Button>
              {model.removable && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-lg text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${model.name}`}
                  disabled={disabled || active}
                  title={
                    active
                      ? "Switch to another model before removing this one"
                      : `Remove ${model.name}`
                  }
                  onClick={onRemove}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </MotionReveal>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {download ? (
          <MotionReveal
            key="download-progress"
            preset="model"
            aria-live="polite"
            className="mt-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-primary">
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Downloading
              </span>
              <span className="tabular-nums">{download.percent}%</span>
            </div>
            <Progress aria-label="Model download progress" value={download.percent} />
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {download.message}
            </p>
            <Button
              variant="outline"
              className="h-10 w-full rounded-lg"
              aria-label="Cancel download"
              onClick={onCancelDownload}
            >
              <X className="size-3.5" aria-hidden="true" />
              Cancel download
            </Button>
          </MotionReveal>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
