import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { ModelLanguages } from "@/components/model-languages";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import type { Model } from "@/lib/backend";
import { modelProfiles, modelUseCases } from "@/lib/model-profiles";
import { cn } from "@/lib/utils";
import { Check, Download, Loader2, Trash2, Wrench } from "lucide-react";

type ModelCardProps = {
  model: Model;
  selectedModelPath: string;
  disabled: boolean;
  sizeLabel: string;
  download?: { percent: number; message: string };
  recommended?: boolean;
  onUse: () => void;
  onRemove: () => void;
  onRepair?: () => void;
  onCancelDownload: () => void;
};

export function ModelCard({
  model,
  selectedModelPath,
  disabled,
  sizeLabel,
  download,
  recommended,
  onUse,
  onRemove,
  onRepair,
  onCancelDownload,
}: ModelCardProps) {
  const { t } = useTranslation();
  const selected = selectedModelPath === model.path && model.installed;
  const active = !!model.path && selectedModelPath === model.path;
  const repair = model.removable && !model.installed;
  const profile = modelProfiles[model.id];
  return (
    <section
      data-slot="model-row"
      aria-labelledby={`model-${model.id}-heading`}
      aria-current={active ? "true" : undefined}
      className={cn(
        "min-w-0 border-b px-4 py-2 last:border-b-0 sm:px-5",
        selected && "bg-primary/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 @min-[48rem]/models:grid @min-[48rem]/models:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem]">
        <div className="min-w-0 flex-[1_1_15rem]">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`model-${model.id}-heading`}
              tabIndex={-1}
              className="rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {model.name}
            </h3>
            {selected && (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                <Check aria-hidden="true" className="size-3" />
                {t("modelsPage.active")}
              </span>
            )}
            {recommended && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {t("uiPolish.recommended")}
              </span>
            )}
            {active && !model.installed && (
              <span className="text-xs text-destructive">{t("modelsPage.needsAttention")}</span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground @min-[48rem]/models:line-clamp-1">
            {nativeText(modelUseCases[model.id] ?? profile?.tagline ?? model.description)}
          </p>
        </div>
        <div
          className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground"
          title={t("modelGuidance.speedAndQualityAreQualitativeGuidesResults")}
        >
          {profile ? (
            <>
              <span>
                <span className="@min-[48rem]/models:sr-only">{t("uiPolish.speedLabel")} </span>
                <span className="text-foreground">{nativeText(profile.speed.label)}</span>
              </span>
              <span aria-hidden="true" className="hidden @min-[48rem]/models:inline">
                ·
              </span>
              <span>
                <span className="@min-[48rem]/models:sr-only">{t("uiPolish.accuracyLabel")} </span>
                <span className="text-foreground">{nativeText(profile.accuracy.label)}</span>
              </span>
            </>
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground @min-[48rem]/models:flex-nowrap @min-[48rem]/models:gap-x-2">
          {profile && (
            <ModelLanguages id={model.id} name={model.name} languages={profile.languages} />
          )}
          <span
            className="shrink-0 text-right tabular-nums"
            title={model.diskBytes ? t("modelCard.onDisk") : t("modelCard.downloadSize")}
          >
            {sizeLabel}
          </span>
        </div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
          {download ? (
            <Button size="sm" variant="outline" onClick={onCancelDownload}>
              {t("homePage.cancelDownload")}
            </Button>
          ) : !selected ? (
            <Button
              size="sm"
              variant={recommended ? "default" : model.installed ? "outline" : "ghost"}
              disabled={disabled}
              onClick={onUse}
              className="h-auto min-h-8 max-w-full whitespace-normal"
            >
              {!model.installed ? <Download aria-hidden="true" className="size-3.5" /> : null}
              {model.installed
                ? t("modelCard.useModel")
                : repair
                  ? t("modelCard.repairUse")
                  : t("modelCard.downloadUse")}
            </Button>
          ) : null}
          {(model.removable || model.installed) && (
            <ActionMenu label={`${t("uiPolish.moreActions")} · ${model.name}`} disabled={disabled}>
              {onRepair && (
                <ActionMenuItem onClick={onRepair} disabled={disabled}>
                  <Wrench aria-hidden="true" />
                  {t("modelsPage.checkRepairRuntime")}
                </ActionMenuItem>
              )}
              {model.removable && (
                <ActionMenuItem onClick={onRemove} destructive disabled={disabled || active}>
                  <Trash2 aria-hidden="true" />
                  {t("modelsPage.removeModel")}
                </ActionMenuItem>
              )}
            </ActionMenu>
          )}
        </div>
      </div>
      {download && (
        <div className="mt-4 space-y-2" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-primary">
            <span className="flex items-center gap-2">
              <Loader2
                aria-hidden="true"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
              {t("modelsPage.downloading")}
            </span>
            <span className="tabular-nums">{download.percent}%</span>
          </div>
          <Progress aria-label={t("modelCard.modelDownloadProgress")} value={download.percent} />
          <p className="text-xs text-muted-foreground">{nativeText(download.message)}</p>
        </div>
      )}
    </section>
  );
}
