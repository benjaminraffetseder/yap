import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useDictationActions,
  useDictationStatus,
  useModelDownload,
} from "@/features/dictation/hooks/use-dictation-state";
import { ModelCard } from "@/features/models/components/model-card";
import {
  initialGuidanceLanguage,
  recommendSpeechModel,
} from "@/features/models/lib/model-guidance";
import { modelProfiles } from "@/features/models/lib/model-profiles";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy, isDesktop, type Model, type Settings } from "@/lib/backend";
import { useSavedActions } from "@/lib/queries/saved-queries";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpeedPreference } from "../lib/onboarding-draft";

export function SpeechModelStep({
  models,
  settings,
  language,
  preference,
  cleanText,
  ready,
  disabled,
}: {
  models: Model[];
  settings: Settings;
  language: string;
  preference: SpeedPreference;
  cleanText: boolean;
  ready: boolean;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const savedActions = useSavedActions();
  const { run, installModel } = useDictationActions();
  const { downloadingModelId } = useModelDownload();
  const status = useDictationStatus();
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState(false);
  const task = preference === "speed" ? "quick" : preference === "quality" ? "quality" : "everyday";
  const recommended = recommendSpeechModel(models, initialGuidanceLanguage(language), task);
  const current = models.find((model) => model.path && model.path === settings.modelPath);
  const sorted = [...models].sort(
    (a, b) =>
      Number(b.id === recommended?.id) - Number(a.id === recommended?.id) ||
      Number(b.path === settings.modelPath) - Number(a.path === settings.modelPath) ||
      a.size - b.size,
  );
  const first = [recommended, current].filter(
    (model, index, values): model is Model =>
      !!model && values.findIndex((item) => item?.id === model.id) === index,
  );
  const displayed = showAll ? sorted : first.length ? first : sorted.slice(0, 1);
  const busy = disabled || pending || isBusy(status.phase) || downloadingModelId !== null;
  const sizeLabel = (bytes: number) =>
    t("modelGuidance.downloadSize", {
      size: new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(
        bytes / 1_000_000,
      ),
    });

  async function selectModel(model: Model) {
    if (!isDesktop || busy) return;
    setPending(true);
    try {
      if (model.installed) {
        await run(() =>
          savedActions.settings({ ...settings, modelPath: model.path, language, cleanText }),
        );
      } else {
        await installModel(model);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere]">
      <p className="text-xs text-muted-foreground">{t("modelsPage.dictationRunsOnYourDevice")}</p>
      <Card>
        <CardHeader>
          <CardTitle>{t("onboarding.recommendedStartingPoint")}</CardTitle>
          <CardDescription>{t("onboarding.recommendationHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          {recommended ? (
            <p>
              {t("onboarding.recommendedForChoices", {
                model: recommended.name,
                speed: nativeText(modelProfiles[recommended.id]?.speed.label ?? ""),
                quality: nativeText(modelProfiles[recommended.id]?.accuracy.label ?? ""),
                size: sizeLabel(recommended.size),
              })}
            </p>
          ) : (
            <p>{t("onboarding.noEligibleRecommendation")}</p>
          )}
        </CardContent>
      </Card>
      {settings.modelPath && !current && (
        <p role="status" className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
          {t("onboarding.customModelKept", {
            model: settings.modelPath.split(/[\\/]/).pop(),
            state: ready ? t("modelsPage.active") : t("modelsPage.needsAttention"),
          })}
        </p>
      )}
      <div className="@container/models overflow-hidden rounded-xl border bg-card/30">
        {displayed.map((model) => (
          <ModelCard
            key={model.id}
            model={{ ...model, removable: false }}
            selectedModelPath={settings.modelPath}
            disabled={!isDesktop || busy}
            sizeLabel={sizeLabel(model.diskBytes || model.size)}
            recommended={model.id === recommended?.id}
            download={
              status.phase === "downloading" && downloadingModelId === model.id
                ? {
                    percent: Math.round(Math.min(1, Math.max(0, status.progress)) * 100),
                    message: status.message,
                  }
                : undefined
            }
            onUse={() => void selectModel(model)}
            onRepair={model.installed ? () => void installModel(model) : undefined}
            onUpdateRuntime={() => void installModel(model, true)}
            onRemove={() => {}}
            onCancelDownload={() => void run(backend.cancel)}
          />
        ))}
        {!displayed.length && (
          <p role="status" className="p-8 text-center text-sm text-muted-foreground">
            {t("uiPolish.noModelsFound")}
          </p>
        )}
      </div>
      {models.length > displayed.length && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
          className="self-start"
        >
          {showAll ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {showAll
            ? t("uiPolish.showFewerModels")
            : t("uiPolish.showAllModels", { count: models.length })}
        </Button>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        {t("onboarding.downloadOnlyOnClick")}
      </p>
    </div>
  );
}
