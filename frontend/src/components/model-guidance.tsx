import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Model } from "@/lib/backend";
import {
  guidanceLanguages,
  guidanceTasks,
  initialGuidanceLanguage,
  recommendSpeechModel,
  type GuidanceTask,
} from "@/lib/model-guidance";
import { modelProfiles } from "@/lib/model-profiles";
import { languageName } from "@/lib/languages";
import { ArrowDown, Check, Download } from "lucide-react";
import { useId, useState } from "react";

export function ModelGuidance({
  models,
  language,
  selectedModelPath,
  onShow,
  onUse,
  disabled,
}: {
  models: Model[];
  language: string;
  selectedModelPath: string;
  onShow: (model: Model) => void;
  onUse: (model: Model) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const languageOptions = guidanceLanguages.map((option) => ({
    ...option,
    label: option.value === "auto" ? t("modelGuidance.unsure") : languageName(option.value),
  }));
  const taskOptions = guidanceTasks.map((option) => ({
    ...option,
    label:
      option.value === "everyday"
        ? t("modelGuidance.everyday")
        : option.value === "quick"
          ? t("modelGuidance.quick")
          : t("modelGuidance.qualityTask"),
  }));
  const id = useId();
  const [spokenLanguage, setSpokenLanguage] = useState(() => initialGuidanceLanguage(language));
  const [task, setTask] = useState<GuidanceTask>("everyday");
  const model = recommendSpeechModel(models, spokenLanguage, task);
  const profile = model && modelProfiles[model.id];
  const downloadSize =
    model &&
    t("modelGuidance.downloadSize", {
      size: new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(
        model.size / 1_000_000,
      ),
    });

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-4 rounded-xl border bg-card/40 p-4 sm:p-5"
    >
      <div>
        <h2 id={`${id}-heading`} className="text-base font-semibold">
          {t("modelGuidance.findAStartingPoint")}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("modelGuidance.chooseYourLanguageAndTaskForA")}
        </p>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-language`}>{t("modelGuidance.languageForGuidance")}</Label>
          <Select
            items={languageOptions}
            value={spokenLanguage}
            onValueChange={(value) => {
              if (value !== null) setSpokenLanguage(value);
            }}
          >
            <SelectTrigger
              id={`${id}-language`}
              className="h-auto! min-h-10 w-full min-w-0 whitespace-normal [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:break-words"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {languageOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="[&>*]:min-w-0 [&>*]:shrink [&>*]:break-words [&>*]:whitespace-normal"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-task`}>{t("modelGuidance.whatWillYouDictate")}</Label>
          <Select
            items={taskOptions}
            value={task}
            onValueChange={(value) => {
              if (value !== null) setTask(value);
            }}
          >
            <SelectTrigger
              id={`${id}-task`}
              className="h-auto! min-h-10 w-full min-w-0 whitespace-normal [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:break-words"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {taskOptions.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="[&>*]:min-w-0 [&>*]:shrink [&>*]:break-words [&>*]:whitespace-normal"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
          {model && profile ? (
            <>
              <p className="text-xs font-medium text-muted-foreground">
                {t("modelGuidance.suggestedStartingPoint")}
              </p>
              <p className="mt-1 font-semibold break-words">{model.name}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {spokenLanguage === "auto"
                  ? t("modelGuidance.broadLanguageCoverageWhileYouDecide")
                  : t("modelGuidance.supports", {
                      spokenLanguage: languageName(spokenLanguage),
                    })}{" "}
                · {downloadSize}
              </p>
            </>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              {t("modelGuidance.noCatalogSuggestionForThisLanguageIs")}
            </p>
          )}
        </div>
        {model && (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            <Button
              size="sm"
              className="h-auto min-h-8 max-w-full whitespace-normal"
              disabled={disabled || (model.installed && model.path === selectedModelPath)}
              onClick={() => onUse(model)}
            >
              {model.installed && model.path === selectedModelPath ? (
                <Check aria-hidden="true" />
              ) : !model.installed ? (
                <Download aria-hidden="true" />
              ) : null}
              {model.installed
                ? model.path === selectedModelPath
                  ? t("modelsPage.active")
                  : t("modelCard.useModel")
                : model.removable
                  ? t("modelCard.repairUse")
                  : t("modelCard.downloadUse")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-9 max-w-full whitespace-normal"
              onClick={() => onShow(model)}
            >
              {t("modelGuidance.showModel")}
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("modelGuidance.speedAndQualityAreQualitativeGuidesResults")}
      </p>
    </section>
  );
}
