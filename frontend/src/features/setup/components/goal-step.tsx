import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLanguages } from "@/lib/languages";
import { useTranslation } from "react-i18next";
import type { OnboardingUseCase, SpeedPreference } from "../lib/onboarding-draft";

const useCases: OnboardingUseCase[] = ["everyday", "email", "notes", "custom"];
const preferences: SpeedPreference[] = ["speed", "balanced", "quality"];

export function GoalStep({
  useCase,
  language,
  preference,
  cleanText,
  disabled,
  onUseCase,
  onLanguage,
  onPreference,
  onCleanText,
}: {
  useCase: OnboardingUseCase;
  language: string;
  preference: SpeedPreference;
  cleanText: boolean;
  disabled: boolean;
  onUseCase: (value: OnboardingUseCase) => void;
  onLanguage: (value: string) => void;
  onPreference: (value: SpeedPreference) => void;
  onCleanText: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const languages = useLanguages();
  return (
    <FieldGroup className="gap-7">
      <FieldSet disabled={disabled}>
        <FieldLegend>{t("onboarding.primaryUseCase")}</FieldLegend>
        <FieldDescription>{t("onboarding.primaryUseCaseHelp")}</FieldDescription>
        <div className="grid gap-3 sm:grid-cols-2">
          {useCases.map((value) => (
            <FieldLabel
              key={value}
              className="min-w-0 cursor-pointer rounded-xl border p-4 has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <Field orientation="horizontal">
                <input
                  type="radio"
                  name="onboarding-use-case"
                  value={value}
                  checked={useCase === value}
                  onChange={() => onUseCase(value)}
                  className="size-4 shrink-0 accent-primary"
                />
                <FieldContent>
                  <FieldTitle>{t(`onboarding.useCase.${value}`)}</FieldTitle>
                  <FieldDescription>{t(`onboarding.useCaseHelp.${value}`)}</FieldDescription>
                </FieldContent>
              </Field>
            </FieldLabel>
          ))}
        </div>
      </FieldSet>
      <div className="grid gap-6 lg:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="onboarding-language">{t("settingsPage.spokenLanguage")}</FieldLabel>
          <Select
            items={languages}
            value={language}
            disabled={disabled}
            onValueChange={(value) => {
              if (value !== null) onLanguage(value);
            }}
          >
            <SelectTrigger id="onboarding-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {languages.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{t("onboarding.languageHelp")}</FieldDescription>
        </Field>
        <FieldSet disabled={disabled}>
          <FieldLegend variant="label">{t("onboarding.speedOrQuality")}</FieldLegend>
          <div className="flex flex-col gap-2">
            {preferences.map((value) => (
              <FieldLabel
                key={value}
                className="cursor-pointer rounded-lg border px-3 py-2 has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
              >
                <Field orientation="horizontal">
                  <input
                    type="radio"
                    name="onboarding-preference"
                    value={value}
                    checked={preference === value}
                    onChange={() => onPreference(value)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <FieldContent>
                    <FieldTitle>{t(`onboarding.preference.${value}`)}</FieldTitle>
                    <FieldDescription className="text-xs">
                      {t(`onboarding.preferenceHelp.${value}`)}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </div>
        </FieldSet>
      </div>
      <Field orientation="horizontal">
        <Switch
          id="onboarding-cleanup"
          checked={cleanText}
          disabled={disabled}
          onCheckedChange={onCleanText}
        />
        <FieldContent>
          <FieldLabel htmlFor="onboarding-cleanup">{t("onboarding.lightCleanup")}</FieldLabel>
          <FieldDescription>{t("onboarding.lightCleanupHelp")}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldGroup>
  );
}
