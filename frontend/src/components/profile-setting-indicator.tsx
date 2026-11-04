import { useTranslation } from "react-i18next";
import type { ComponentProps } from "react";
import { CircleDot } from "lucide-react";
import { useDictation } from "@/components/dictation-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguages } from "@/lib/languages";
import { processingOptions } from "@/lib/backend";

export function ModifiedMarker({ className = "", ...props }: ComponentProps<"span">) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t("profileSettingIndicator.modifiedProfile")}
      className={`inline-flex shrink-0 items-center text-muted-foreground ${className}`}
      {...props}
    >
      <CircleDot className="size-3.5" aria-hidden="true" />
    </span>
  );
}

type ProfileSetting = "modelPath" | "language" | "cleanText" | "autoPromptId";

export function ProfileSettingIndicator({
  field,
  value,
  currentLabel,
}: {
  field: ProfileSetting;
  value: string | boolean;
  currentLabel?: string;
}) {
  const languages = useLanguages();
  const { t } = useTranslation();
  const settingNames: Record<ProfileSetting, string> = {
    modelPath: t("common.speechModel"),
    language: t("settingsPage.spokenLanguage"),
    cleanText: t("settingsPage.lightCleanup"),
    autoPromptId: t("promptsPage.runAfterDictation"),
  };

  const { snapshot, loading } = useDictation();
  const profile = snapshot.dictationProfiles?.find((p) => p.id === snapshot.activeProfileId);
  if (loading || !profile || profile[field] === value) return null;

  const savedValue =
    field === "autoPromptId" ? snapshot.textProcessing.autoPromptId : snapshot.settings[field];
  function display(setting: string | boolean) {
    if (typeof setting === "boolean") return setting ? t("common.on") : t("common.off");
    switch (field) {
      case "modelPath":
        return (
          snapshot.models.find((model) => model.path === setting)?.name ||
          setting ||
          t("homeProfileActions.none")
        );
      case "language":
        return languages.find((language) => language.value === setting)?.label || setting;
      case "autoPromptId":
        return setting
          ? processingOptions(snapshot.textProcessing).find((option) => option.value === setting)
              ?.label || t("dictationProfiles.promptOrChainUnavailable")
          : t("common.noAutomaticProcessing");
      default:
        return setting;
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ModifiedMarker
            tabIndex={0}
            aria-label={t("profileSettingIndicator.changedFrom", {
              field: settingNames[field],
              name: profile.name,
            })}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      />
      <TooltipContent className="block space-y-1 [overflow-wrap:anywhere]">
        <p className="font-medium">
          {t("profileSettingIndicator.changedFrom2")} {profile.name}
        </p>
        <p>
          {t("profileSettingIndicator.profile")} {display(profile[field])}
        </p>
        <p>
          {t("profileSettingIndicator.current")} {currentLabel ?? display(value)}
        </p>
        {savedValue !== value && <p>{t("profileSettingIndicator.notSavedYet")}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
