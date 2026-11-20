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
import { cn } from "@/lib/utils";
import { validateTextProcessing } from "@/lib/validation/draft-validation";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
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
  onContinue,
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
  onContinue?: (animate: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { diagnostic } = useDictationMetadata();
  const { textModels = [] } = useSavedModelCatalog();
  const suggested =
    textModels.find(
      (model) => model.id === (preference === "quality" ? "gemma-4-e4b" : "gemma-4-e2b"),
    ) ?? textModels[0];
  const activeModel =
    base.provider === "builtin"
      ? (textModels.find((model) => model.id === base.model)?.name ?? base.model)
      : base.model;
  const modelTest = useTextRequest();
  const preview = useTextRequest();
  const previewJob = useRef<Promise<string | undefined> | null>(null);
  const [trialMode, setTrialMode] = useState<"typed" | "dictated">("typed");
  const [typedInput, setTypedInput] = useState("");
  const [testedConnection, setTestedConnection] = useState("");
  const [completedKey, setCompletedKey] = useState("");
  const [modelOptionsOpen, setModelOptionsOpen] = useState(false);
  const [continuePending, setContinuePending] = useState(false);
  const [continueError, setContinueError] = useState("");
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
  const trialBusy = preview.pending || continuePending;

  function clearPreview() {
    preview.clear();
    setCompletedKey("");
    setContinueError("");
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
    if (!textReady || !input || validation || preview.pending || continuePending) return;
    const key = trialKey;
    const recipeID = kind === "prompt" ? draft.prompt.id : draft.chain.id;
    setContinueError("");
    const job = preview.request((requestID) =>
      backend.previewWorkflow(requestID, config, original, transcript, recipeID),
    );
    previewJob.current = job;
    const output = await job;
    if (previewJob.current === job) previewJob.current = null;
    if (output !== undefined) setCompletedKey(key);
  }
  async function cancelTrialAndContinue(animate: boolean) {
    if (!preview.pending || continuePending || !onContinue) return;
    setContinuePending(true);
    setContinueError("");
    const job = previewJob.current;
    try {
      const accepted = await preview.cancel();
      if (!accepted) {
        // Cancel RPC failed: ownership stays with the running job. Do not navigate.
        setContinueError(t("onboarding.trialCancelFailed"));
        return;
      }
      if (job) await job;
      onContinue(animate);
    } finally {
      setContinuePending(false);
    }
  }

  const modelControls = (
    <>
      {!runtimeAvailable && (
        <p role="status" className="rounded-lg border p-3 text-sm text-muted-foreground">
          {t("onboarding.runtimeUnavailable")}
        </p>
      )}
      {!textReady && (
        <div className="rounded-lg border p-3 text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">{t("onboarding.textModelSuggestion")}</p>
          <p>
            {base.enabled && base.model
              ? t("onboarding.keepCurrentTextConnection", { model: activeModel || base.model })
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
      )}
      <TextModelLibrary embedded disabled={disabled} />
      {textReady && (
        <div className="rounded-xl border px-5">
          {base.provider === "builtin" ? (
            <TextModelSettings
              value={base}
              disabled={disabled || trialBusy}
              showModelPicker={false}
              onChange={onBaseChange}
            />
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              {t("setupPage.externalTextModelReady", { model: activeModel || base.model })}
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
                disabled={disabled || trialBusy}
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
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        {!textReady && (
          <CardHeader>
            <CardTitle>{t("onboarding.optionalTextModel")}</CardTitle>
            <CardDescription>{t("onboarding.optionalTextModelHelp")}</CardDescription>
          </CardHeader>
        )}
        <CardContent className="flex flex-col gap-5">
          {textReady ? (
            <Collapsible.Root open={modelOptionsOpen} onOpenChange={setModelOptionsOpen}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-[1_1_10rem]">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("onboarding.activeTextModel")}
                  </p>
                  <p className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {activeModel || t("onboarding.noTextModel")}
                  </p>
                </div>
                <Collapsible.Trigger
                  render={<Button variant="outline" size="sm" />}
                  className="h-auto min-h-8 max-w-full self-start gap-1.5 whitespace-normal"
                  aria-expanded={modelOptionsOpen}
                >
                  {t("onboarding.changeModelOptions")}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "transition-transform motion-reduce:transition-none",
                      modelOptionsOpen && "rotate-180",
                    )}
                  />
                </Collapsible.Trigger>
              </div>
              <Collapsible.Panel
                keepMounted
                role="region"
                aria-label={t("onboarding.changeModelOptions")}
                className="flex flex-col gap-5 pt-4"
              >
                {modelControls}
              </Collapsible.Panel>
            </Collapsible.Root>
          ) : (
            modelControls
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
            disabled={disabled || trialBusy}
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
                  disabled={disabled || trialBusy || (mode === "dictated" && !practiceCompleted)}
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
                disabled={disabled || trialBusy}
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
                  disabled={disabled || trialBusy}
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
                <Button
                  variant="outline"
                  disabled={continuePending}
                  onClick={() => void preview.cancel()}
                >
                  {t("promptsPage.cancelTest")}
                </Button>
              ) : (
                <Button
                  disabled={
                    disabled ||
                    continuePending ||
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
              {preview.pending && onContinue && (
                <Button
                  variant="secondary"
                  disabled={continuePending}
                  onClick={(event) => void cancelTrialAndContinue(event.detail > 0)}
                >
                  {continuePending
                    ? t("onboarding.cancellingTrialContinue")
                    : t("onboarding.cancelTrialContinue")}
                </Button>
              )}
              {!textReady && (
                <p className="self-center text-xs text-muted-foreground">
                  {t("onboarding.modelNeededForTrial")}
                </p>
              )}
            </div>
            {continueError && (
              <p role="alert" className="text-sm text-destructive">
                {nativeText(continueError)}
              </p>
            )}
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
                {preview.pending ? (
                  <p className="mt-2 min-h-20 whitespace-pre-wrap break-words text-sm leading-6">
                    {preview.error ? nativeText(preview.error) : t("onboarding.runningTrial")}
                  </p>
                ) : preview.error ? (
                  <p role="alert" className="mt-2 min-h-20 text-sm leading-6 text-destructive">
                    {nativeText(preview.error)}
                  </p>
                ) : result ? (
                  <p className="mt-2 min-h-20 whitespace-pre-wrap break-words text-sm leading-6">
                    {result}
                  </p>
                ) : (
                  <p className="mt-2 min-h-20 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {t("onboarding.noTrialResult")}
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
