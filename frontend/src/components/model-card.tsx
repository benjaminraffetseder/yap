import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { languageName } from "@/lib/languages";
import { MotionReveal } from "@/components/motion-reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Model } from "@/lib/backend";
import { modelProfiles, type ModelRating } from "@/lib/model-profiles";
import { motionTransition } from "@/lib/motion";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { cn } from "@/lib/utils";
import { Check, Download, HardDrive, Languages, Loader2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

function RatingBar({ name, rating }: { name: "Accuracy" | "Speed"; rating: ModelRating }) {
  useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">{nativeText(name)}</span>
        <span className="font-medium">{nativeText(rating.label)}</span>
      </div>
      <div
        role="meter"
        aria-label={nativeText(name)}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={rating.score}
        aria-valuetext={nativeText(rating.label)}
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
  const { t } = useTranslation();
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_9rem] lg:gap-8">
        <div className="min-w-0">
          <h3
            id={`model-${model.id}-heading`}
            tabIndex={-1}
            className="rounded-sm text-base font-semibold tracking-tight break-words outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {model.name}
          </h3>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-muted-foreground">
            {nativeText(profile?.tagline ?? model.description)}
          </p>
        </div>
        {profile && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 lg:gap-3">
            <RatingBar name="Accuracy" rating={profile.accuracy} />
            <RatingBar name="Speed" rating={profile.speed} />
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-4 border-t pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {profile &&
            (profile.languages.length > 1 ? (
              <Tooltip
                onOpenChange={(open, details) => {
                  // Scrolling to keyboard focus can put another badge under the pointer.
                  // Keep that hover from replacing the focused model's language details.
                  const focused = document.activeElement;
                  if (
                    open &&
                    details.reason === "trigger-hover" &&
                    focused?.matches("[data-model-language]:focus-visible") &&
                    focused.getAttribute("data-model-language") !== model.id
                  )
                    details.cancel();
                }}
              >
                <TooltipTrigger
                  render={<Badge variant="outline" render={<button type="button" />} />}
                  className="h-6 cursor-help gap-1.5 border-border/80 text-muted-foreground hover:bg-muted"
                  aria-label={t("modelCard.supportedLanguagesFor", { name: model.name })}
                  data-model-language={model.id}
                  aria-describedby={`model-${model.id}-languages`}
                >
                  <Languages aria-hidden="true" />
                  {t("modelCard.multilingual")}
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  className="block max-w-[min(32rem,calc(100vw-2rem))] px-3.5 py-3 leading-5"
                >
                  <p className="mb-1 font-semibold">
                    {t("modelCard.languageCount", { count: profile.languages.length })}
                  </p>
                  <p>{profile.languages.map(languageName).join(", ")}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Badge variant="outline" className="h-6 border-border/80 text-muted-foreground">
                {t("modelCard.englishOnly")}
              </Badge>
            ))}
          <span className="flex items-center gap-1.5">
            <HardDrive className="size-3.5" aria-hidden="true" />
            <span>{model.diskBytes ? t("modelCard.onDisk") : t("modelCard.downloadSize")}</span>
            <span className="font-medium text-foreground tabular-nums">{sizeLabel}</span>
          </span>
          {!isDownloading && (model.installed || repair) && (
            <span className="flex items-center gap-1.5">
              {model.installed && <Check className="size-3.5 text-primary" aria-hidden="true" />}
              {model.installed ? t("modelCard.downloaded") : t("modelCard.repairNeeded")}
            </span>
          )}
          {profile && profile.languages.length > 1 && (
            <span id={`model-${model.id}-languages`} className="sr-only">
              {t("modelCard.languageCount", { count: profile.languages.length })}:{" "}
              {profile.languages.map(languageName).join(", ")}
            </span>
          )}
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {!download && (
            <MotionReveal
              key={selected ? "active" : model.installed ? "installed" : "download"}
              preset="model"
              className="flex min-w-0 flex-wrap items-center gap-2 lg:shrink-0"
            >
              <Button
                pressFeedback={!selected}
                className={cn(
                  "h-auto min-h-9 flex-1 rounded-lg whitespace-normal lg:flex-none",
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
                    {t("modelsPage.active")}
                  </>
                ) : model.installed ? (
                  t("modelCard.useModel")
                ) : (
                  <>
                    <Download className="size-4" aria-hidden="true" />
                    {repair ? t("modelCard.repairUse") : t("modelCard.downloadUse")}
                  </>
                )}
              </Button>
              {model.removable && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 rounded-lg text-muted-foreground hover:text-destructive"
                  aria-label={t("modelCard.remove", { name: model.name })}
                  disabled={disabled || active}
                  title={
                    active
                      ? t("modelCard.switchToAnotherModelBeforeRemovingThis")
                      : t("modelCard.remove", { name: model.name })
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
      {!selected && !isDownloading && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {model.installed
            ? t("modelCard.useModelSwitchesYourNextDictationTo")
            : repair
              ? t("modelCard.repairUseChecksTheFilesDownloadsWhat")
              : t("modelCard.downloadUseInstallsThisModelAndIts")}
        </p>
      )}
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
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {t("modelsPage.downloading")}
              </span>
              <span className="tabular-nums">{download.percent}%</span>
            </div>
            <Progress aria-label={t("modelCard.modelDownloadProgress")} value={download.percent} />
            <p className="text-xs leading-5 break-words text-muted-foreground">
              {download.message}
            </p>
            <Button
              variant="outline"
              className="h-10 w-full rounded-lg"
              aria-label={t("homePage.cancelDownload")}
              onClick={onCancelDownload}
            >
              <X className="size-3.5" aria-hidden="true" />
              {t("homePage.cancelDownload")}
            </Button>
          </MotionReveal>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
