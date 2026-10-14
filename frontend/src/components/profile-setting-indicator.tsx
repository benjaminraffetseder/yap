import type { ComponentProps } from "react";
import { CircleDot } from "lucide-react";
import { useDictation } from "@/components/dictation-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { languages } from "@/lib/languages";

export function ModifiedMarker({ className = "", ...props }: ComponentProps<"span">) {
  return (
    <span
      role="img"
      aria-label="Modified profile"
      className={`inline-flex shrink-0 items-center text-muted-foreground ${className}`}
      {...props}
    >
      <CircleDot className="size-3.5" aria-hidden="true" />
    </span>
  );
}

type ProfileSetting = "modelPath" | "language" | "cleanText" | "autoPromptId";
const settingNames: Record<ProfileSetting, string> = {
  modelPath: "Speech model",
  language: "Spoken language",
  cleanText: "Light cleanup",
  autoPromptId: "Run after dictation",
};

export function ProfileSettingIndicator({
  field,
  value,
  currentLabel,
}: {
  field: ProfileSetting;
  value: string | boolean;
  currentLabel?: string;
}) {
  const { snapshot, loading } = useDictation();
  const profile = snapshot.dictationProfiles?.find((p) => p.id === snapshot.activeProfileId);
  if (loading || !profile || profile[field] === value) return null;

  const savedValue =
    field === "autoPromptId" ? snapshot.textProcessing.autoPromptId : snapshot.settings[field];
  function display(setting: string | boolean) {
    if (typeof setting === "boolean") return setting ? "On" : "Off";
    switch (field) {
      case "modelPath":
        return snapshot.models.find((model) => model.path === setting)?.name || setting || "None";
      case "language":
        return languages.find((language) => language.value === setting)?.label || setting;
      case "autoPromptId":
        return setting
          ? snapshot.textProcessing.prompts.find((prompt) => prompt.id === setting)?.name ||
              "Prompt unavailable"
          : "No automatic processing";
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
            aria-label={`${settingNames[field]} changed from ${profile.name}`}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      />
      <TooltipContent className="block space-y-1 [overflow-wrap:anywhere]">
        <p className="font-medium">Changed from {profile.name}</p>
        <p>Profile: {display(profile[field])}</p>
        <p>Current: {currentLabel ?? display(value)}</p>
        {savedValue !== value && <p>Unsaved change — save to apply.</p>}
      </TooltipContent>
    </Tooltip>
  );
}
