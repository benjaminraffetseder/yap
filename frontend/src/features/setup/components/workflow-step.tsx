import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  useDictationMetadata,
  useSavedModelCatalog,
} from "@/features/dictation/hooks/use-dictation-state";
import { TextModelLibrary } from "@/features/models/components/text-model-library";
import { TextModelSettings } from "@/features/models/components/text-model-settings";
import { useTextRequest } from "@/features/processing/hooks/use-text-request";
import { nativeText } from "@/i18n/native-text";
import { backend, type TextProcessing } from "@/lib/backend";
import { validateTextProcessing } from "@/lib/validation/draft-validation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildWorkflowConfig,
  type RecipeKind,
  type SpeedPreference,
  type WorkflowDraft,
} from "../lib/onboarding-draft";
import { DictationPractice } from "./dictation-practice";
import { RecipeEditor } from "./recipe-editor";

export function WorkflowStep({
  base,
  draft,
  kind,
  preference,
  textReady,
  runtimeAvailable,
  practiceCompleted,
  disabled,
  onBaseChange,
  onDraft,
  onKind,
  onPracticeStart,
}: {
  base: TextProcessing;
  draft: WorkflowDraft;
  kind: RecipeKind;
  preference: SpeedPreference;
  textReady: boolean;
  runtimeAvailable: boolean;
  practiceCompleted: boolean;
  disabled: boolean;
  onBaseChange: (value: Partial<TextProcessing>) => void;
  onDraft: (draft: WorkflowDraft) => void;
  onKind: (kind: RecipeKind) => void;
  onPracticeStart: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { diagnostic } = useDictationMetadata();
  const { textModels = [] } = useSavedModelCatalog();
  const suggested =
    textModels.find(
      (model) => model.id === (preference === "quality" ? "gemma-4-e4b" : "gemma-4-e2b"),
    ) ?? textModels[0];
  const modelTest = useTextRequest();
  const preview = useTextRequest();
  const [trialMode, setTrialMode] = useState<"typed" | "dictated">("typed");
  const [typedInput, setTypedInput] = useState("");
  const [testedConnection, setTestedConnection] = useState("");
  const [completedKey, setCompletedKey] = useState("");
  const connection = `${base.provider}:${base.model}:${base.contextLength ?? 0}`;
  const config = buildWorkflowConfig(base, draft, kind, true);
  const validation = kind === "none" ? "" : validateTextProcessing(config);
  const dictated = trialMode === "dictated";
  const transcript = dictated ? diagnostic.transcript : typedInput;
  const original = dictated ? (diagnostic.rawTranscript ?? diagnostic.transcript) : typedInput;
  const input = transcript.trim();
  const trialKey = JSON.stringify([
    original,
    transcript,
    config,
    kind === "prompt" ? draft.prompt.id : draft.chain.id,
  ]);
  const result = completedKey === trialKey ? preview.result : "";

  function clearPreview() {
    preview.clear();
    setCompletedKey("");
  }
  function updateDraft(value: WorkflowDraft) {
    clearPreview();
    onDraft(value);
  }
  function updateKind(value: RecipeKind) {
    clearPreview();
    onKind(value);
  }
  async function runPreview() {
    if (!textReady || !input || validation || preview.pending) return;
    const key = trialKey;
    const recipeID = kind === "prompt" ? draft.prompt.id : draft.chain.id;
    const output = await preview.request((requestID) =>
      backend.previewWorkflow(requestID, config, original, transcript, recipeID),
    );
    if (output !== undefined) setCompletedKey(key);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("onboarding.optionalTextModel")}</CardTitle>
          <CardDescription>{t("onboarding.optionalTextModelHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!runtimeAvailable && (
            <p role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">
              {t("onboarding.runtimeUnavailable")}
            </p>
          )}
          <div className="rounded-lg border p-3 text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">{t("onboarding.textModelSuggestion")}</p>
            <p>
              {base.enabled && base.model
                ? t("onboarding.keepCurrentTextConnection", { model: base.model })
                : suggested
                  ? t("onboarding.textModelSuggestionHelp", {
                      model: suggested.name,
                      size: t("textModels.size", {
                        size: (suggested.size / 1e9).toLocaleString(i18n.resolvedLanguage, {
                          maximumFractionDigits: 1,
                        }),
                      }),
                    })
                  : t("onboarding.textModelSuggestionUnavailable")}
            </p>
            <p className="mt-1 text-xs">{t("onboarding.textModelSuggestionNote")}</p>
          </div>
          <TextModelLibrary embedded disabled={disabled} />
          {textReady && (
            <div className="rounded-xl border px-5">
              {base.provider === "builtin" ? (
                <TextModelSettings
                  value={base}
                  disabled={disabled || preview.pending}
                  showModelPicker={false}
                  onChange={onBaseChange}
                />
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  {t("setupPage.externalTextModelReady", { model: base.model })}
                </p>
              )}
              <div className="flex flex-col gap-2 border-t py-4">
                {modelTest.pending ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => void modelTest.cancel()}
                  >
                    {t("promptsPage.cancelTest")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={disabled || preview.pending}
                    onClick={() => {
                      setTestedConnection(connection);
                      void modelTest.request(backend.testTextModel);
                    }}
                  >
                    {t("promptsPage.testModel")}
                  </Button>
                )}
                <p
                  role={modelTest.error && testedConnection === connection ? "alert" : "status"}
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {modelTest.pending
                    ? t("promptsPage.testingModel")
                    : testedConnection === connection && modelTest.error
                      ? nativeText(modelTest.error)
                      : testedConnection === connection && modelTest.result
                        ? t("promptsPage.modelRespondedSuccessfully")
                        : t("textModels.firstLoad")}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("onboarding.makeItYours")}</CardTitle>
          <CardDescription>{t("onboarding.draftPrivacy")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RecipeEditor
            kind={kind}
            draft={draft}
            disabled={disabled || preview.pending}
            onKind={updateKind}
            onDraft={updateDraft}
          />
        </CardContent>
      </Card>

      {kind !== "none" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("onboarding.tryWorkflow")}</CardTitle>
            <CardDescription>{t("onboarding.trialPrivacy")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t("onboarding.trialSource")}
            >
              {(["typed", "dictated"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={trialMode === mode ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={trialMode === mode}
                  disabled={
                    disabled || preview.pending || (mode === "dictated" && !practiceCompleted)
                  }
                  onClick={() => {
                    setTrialMode(mode);
                    clearPreview();
                  }}
                >
                  {t(`onboarding.trialMode.${mode}`)}
                </Button>
              ))}
            </div>
            {dictated ? (
              <DictationPractice
                compact
                disabled={disabled || preview.pending}
                onStart={() => {
                  clearPreview();
                  onPracticeStart();
                }}
              />
            ) : (
              <Field>
                <FieldLabel htmlFor="onboarding-trial-input">
                  {t("onboarding.typedSample")}
                </FieldLabel>
                <Textarea
                  id="onboarding-trial-input"
                  value={typedInput}
                  disabled={disabled || preview.pending}
                  rows={5}
                  onChange={(event) => {
                    setTypedInput(event.target.value);
                    clearPreview();
                  }}
                  placeholder={t("onboarding.typedSamplePlaceholder")}
                />
                <FieldDescription>{t("onboarding.typedSampleHelp")}</FieldDescription>
              </Field>
            )}
            {validation && (
              <p role="alert" className="text-sm text-destructive">
                {validation}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {preview.pending ? (
                <Button variant="outline" onClick={() => void preview.cancel()}>
                  {t("promptsPage.cancelTest")}
                </Button>
              ) : (
                <Button
                  disabled={
                    disabled ||
                    !textReady ||
                    !input ||
                    !!validation ||
                    (dictated && !practiceCompleted)
                  }
                  onClick={() => void runPreview()}
                >
                  {t("onboarding.runTrial")}
                </Button>
              )}
              {!textReady && (
                <p className="self-center text-xs text-muted-foreground">
                  {t("onboarding.modelNeededForTrial")}
                </p>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <section
                aria-label={t("onboarding.trialInput")}
                className="min-w-0 rounded-xl border bg-background p-4"
              >
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t("onboarding.trialInput")}
                </h3>
                <p className="mt-2 min-h-20 whitespace-pre-wrap break-words text-sm leading-6">
                  {transcript || t("onboarding.noTrialInput")}
                </p>
                {dictated &&
                  diagnostic.rawTranscript &&
                  diagnostic.rawTranscript !== diagnostic.transcript && (
                    <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground">
                      {t("onboarding.originalRecognition", { text: diagnostic.rawTranscript })}
                    </p>
                  )}
              </section>
              <section
                aria-label={t("onboarding.trialResult")}
                aria-live="polite"
                className="min-w-0 rounded-xl border bg-background p-4"
              >
                <h3 className="text-xs font-medium text-muted-foreground">
                  {t("onboarding.trialResult")}
                </h3>
                <p className="mt-2 min-h-20 whitespace-pre-wrap break-words text-sm leading-6">
                  {preview.pending
                    ? t("onboarding.runningTrial")
                    : result || t("onboarding.noTrialResult")}
                </p>
                {preview.error && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {nativeText(preview.error)}
                  </p>
                )}
              </section>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
