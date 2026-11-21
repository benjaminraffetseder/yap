import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import type { RecipeKind } from "../lib/onboarding-draft";

export function ProfileStep({
  name,
  speechModel,
  language,
  cleanText,
  textModel,
  recipeKind,
  recipeName,
  nameError,
  disabled,
  onName,
}: {
  name: string;
  speechModel: string;
  language: string;
  cleanText: boolean;
  textModel: string;
  recipeKind: RecipeKind;
  recipeName: string;
  nameError: string;
  disabled: boolean;
  onName: (name: string) => void;
}) {
  const { t } = useTranslation();
  const hasWorkflow = textModel && recipeKind !== "none";
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("onboarding.nameProfile")}</CardTitle>
          <CardDescription>{t("onboarding.nameProfileHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Field data-invalid={!!nameError}>
            <FieldLabel htmlFor="onboarding-profile-name">{t("onboarding.profileName")}</FieldLabel>
            <Input
              id="onboarding-profile-name"
              value={name}
              disabled={disabled}
              aria-invalid={!!nameError}
              maxLength={120}
              autoComplete="off"
              onChange={(event) => onName(event.target.value)}
            />
            <FieldDescription>{t("onboarding.profileNameHelp")}</FieldDescription>
            {nameError && <FieldError>{nameError}</FieldError>}
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("onboarding.profileSummary")}</CardTitle>
          <CardDescription>{t("onboarding.profileSummaryHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              [t("common.speechModel"), speechModel],
              [t("settingsPage.spokenLanguage"), language],
              [
                t("onboarding.lightCleanup"),
                cleanText ? t("onboarding.enabled") : t("onboarding.disabled"),
              ],
              [t("promptsPage.textModel"), textModel || t("onboarding.noTextModel")],
              [
                t("onboarding.recipeChoice"),
                hasWorkflow ? recipeName : t("onboarding.basicDictation"),
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {t("onboarding.profileAppWideNote")}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("onboarding.findProfileLater")}</CardTitle>
          <CardDescription>{t("onboarding.findProfileLaterHelp")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
