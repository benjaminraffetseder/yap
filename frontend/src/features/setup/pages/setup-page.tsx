import { MotionReveal } from "@/components/shared/motion-reveal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toastManager } from "@/components/ui/toast";
import {
  useDictationActions,
  useDictationMetadata,
  useDictationStatus,
  useMicrophoneTestState,
  useSavedConfiguration,
  useSavedModelCatalog,
} from "@/features/dictation/hooks/use-dictation-state";
import i18n from "@/i18n";
import { backend, isBusy, type Microphone } from "@/lib/backend";
import { useLanguages } from "@/lib/languages";
import { useSavedActions } from "@/lib/queries/saved-queries";
import { cn } from "@/lib/utils";
import { validateTextProcessing } from "@/lib/validation/draft-validation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  HardDriveDownload,
  Keyboard,
  Mic,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DictationPractice } from "../components/dictation-practice";
import { GoalStep } from "../components/goal-step";
import { MicrophoneStep, ShortcutStep } from "../components/hardware-steps";
import { ProfileStep } from "../components/profile-step";
import { SpeechModelStep } from "../components/speech-model-step";
import { WorkflowStep } from "../components/workflow-step";
import {
  buildWorkflowConfig,
  createWorkflowDraft,
  defaultRecipeKind,
  profileTextConnection,
  uniqueProfileName,
  type OnboardingUseCase,
  type RecipeKind,
  type SpeedPreference,
} from "../lib/onboarding-draft";

export function SetupPage() {
  const { t } = useTranslation();
  const savedActions = useSavedActions();
  const languages = useLanguages();
  const steps = [
    {
      label: t("onboarding.step.goal"),
      shortLabel: t("onboarding.stepShort.goal"),
      icon: SlidersHorizontal,
      title: t("onboarding.goalTitle"),
      description: t("onboarding.goalDescription"),
    },
    {
      label: t("common.speechModel"),
      shortLabel: t("modelsPage.speechShort"),
      icon: HardDriveDownload,
      title: t("setupPage.chooseYourSpeechModel"),
      description: t("setupPage.pickTheModelThatFitsYourDay"),
    },
    {
      label: t("settingsPage.microphone"),
      shortLabel: t("setupPage.mic"),
      icon: Mic,
      title: t("setupPage.letSHearYou"),
      description: t("setupPage.chooseYourMicrophoneAndMakeSureYour"),
    },
    {
      label: t("setupPage.shortcut"),
      shortLabel: t("setupPage.shortcutShort"),
      icon: Keyboard,
      title: t("setupPage.oneShortcutReadyWhenYouAre"),
      description: t("setupPage.setAGlobalShortcutSoYapIs"),
    },
    {
      label: t("onboarding.step.practice"),
      shortLabel: t("onboarding.stepShort.practice"),
      icon: Mic,
      title: t("onboarding.practiceHeading"),
      description: t("onboarding.practiceDescription"),
    },
    {
      label: t("onboarding.step.workflow"),
      shortLabel: t("onboarding.stepShort.workflow"),
      icon: Sparkles,
      title: t("setupPage.addTextModel"),
      description: t("onboarding.workflowDescription"),
    },
    {
      label: t("onboarding.step.profile"),
      shortLabel: t("onboarding.stepShort.profile"),
      icon: UserRound,
      title: t("onboarding.profileHeading"),
      description: t("onboarding.profileDescription"),
    },
  ];

  const { run } = useDictationActions();
  const { setMicrophoneTestVisible } = useMicrophoneTestState();
  const snapshot = {
    ...useSavedConfiguration(),
    ...useSavedModelCatalog(),
    ...useDictationMetadata(),
    status: useDictationStatus(),
  };
  const [navigation, setNavigation] = useState({ step: 0, direction: 1, animate: false });
  const { step } = navigation;
  const [useCase, setUseCase] = useState<OnboardingUseCase>("everyday");
  const [language, setLanguage] = useState(snapshot.settings.language);
  const [preference, setPreference] = useState<SpeedPreference>("balanced");
  const [cleanText, setCleanText] = useState(snapshot.settings.cleanText);
  const [recipeKind, setRecipeKind] = useState<RecipeKind>("none");
  const [basicRequested, setBasicRequested] = useState(false);
  const [recipeEdited, setRecipeEdited] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState(() => createWorkflowDraft("everyday"));
  const [baseTextConfig, setBaseTextConfig] = useState(snapshot.textProcessing);
  const [profileID] = useState(() => crypto.randomUUID());
  const [profileName, setProfileName] = useState(() =>
    uniqueProfileName(t("onboarding.defaultProfileName.everyday"), snapshot.dictationProfiles),
  );
  const [profileNameEdited, setProfileNameEdited] = useState(false);
  const [celebratedMic, setCelebratedMic] = useState(snapshot.microphoneTested);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [mic, setMic] = useState(snapshot.settings.microphoneId);
  const [shortcut, setShortcut] = useState(snapshot.settings.shortcut);
  const [pending, setPending] = useState(false);
  const [micAttempted, setMicAttempted] = useState(false);
  const [practiceAttempted, setPracticeAttempted] = useState(false);
  const [practiceCompletedKey, setPracticeCompletedKey] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const footer = useRef<HTMLElement>(null);
  const microphoneRequest = useRef(0);
  const notifiedModelPath = useRef<string | null>(null);

  const refreshMicrophones = useCallback(async () => {
    const request = ++microphoneRequest.current;
    try {
      const devices = await backend.microphones();
      if (request === microphoneRequest.current) setMicrophones(devices);
    } catch (cause) {
      if (request === microphoneRequest.current) throw cause;
    }
  }, []);

  const busy = isBusy(snapshot.status.phase);
  const textReady = !!(
    baseTextConfig.enabled &&
    baseTextConfig.model &&
    (baseTextConfig.provider !== "builtin" ||
      (snapshot.textRuntimeAvailable &&
        snapshot.textModels?.some((model) => model.id === baseTextConfig.model && model.installed)))
  );
  const micPassed = snapshot.microphoneTested && mic === snapshot.settings.microphoneId;
  const shortcutPassed =
    snapshot.shortcutTested &&
    shortcut === snapshot.settings.shortcut &&
    !snapshot.status.shortcutError;
  const speechSettingsKey = [
    snapshot.settings.whisperPath,
    snapshot.settings.modelPath,
    snapshot.settings.microphoneId,
    snapshot.settings.language,
    snapshot.settings.cleanText,
  ].join("\u0000");
  const practiceCompleted =
    practiceCompletedKey === speechSettingsKey &&
    snapshot.diagnostic.phase === "done" &&
    !!snapshot.diagnostic.transcript.trim();
  const dictationReady = snapshot.ready && micPassed && shortcutPassed && practiceCompleted;
  const trimmedName = profileName.trim();
  const nameError = !trimmedName
    ? t("onboarding.profileNameRequired")
    : [...profileName].length > 60 || /[\r\n\0]/.test(profileName)
      ? t("onboarding.profileNameInvalid")
      : trimmedName.toLowerCase() === "default" ||
          snapshot.dictationProfiles?.some(
            (profile) => profile.name.trim().toLowerCase() === trimmedName.toLowerCase(),
          )
        ? t("onboarding.profileNameExists")
        : "";
  const effectiveKind: RecipeKind = textReady && !basicRequested ? recipeKind : "none";
  const workflowValidation =
    textReady && recipeKind !== "none"
      ? validateTextProcessing(buildWorkflowConfig(baseTextConfig, workflowDraft, recipeKind, true))
      : "";
  const currentSpeechModel = snapshot.models.find(
    (model) => model.path && model.path === snapshot.settings.modelPath,
  );

  useEffect(() => {
    setBaseTextConfig(snapshot.textProcessing);
  }, [snapshot.textProcessing]);
  useEffect(() => {
    const element = footer.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const height = `${element.getBoundingClientRect().height}px`;
      if (document.documentElement.style.getPropertyValue("--setup-footer-height") !== height)
        document.documentElement.style.setProperty("--setup-footer-height", height);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.documentElement.style.removeProperty("--setup-footer-height");
    };
  }, []);
  useEffect(() => {
    setMicrophoneTestVisible(step === 2);
    return () => setMicrophoneTestVisible(false);
  }, [step, setMicrophoneTestVisible]);
  useEffect(() => {
    if (!snapshot.ready) {
      notifiedModelPath.current = null;
      return;
    }
    if (
      step !== 1 ||
      busy ||
      snapshot.status.phase === "error" ||
      notifiedModelPath.current === snapshot.settings.modelPath
    )
      return;
    notifiedModelPath.current = snapshot.settings.modelPath;
    toastManager.add({
      id: "speech-model-download",
      type: "success",
      title: i18n.t("setupPage.speechModelReady"),
      timeout: 5000,
    });
  }, [snapshot.ready, snapshot.settings.modelPath, snapshot.status.phase, step, busy]);
  useEffect(() => {
    const requests = microphoneRequest;
    if (step === 2) void run(refreshMicrophones, false);
    return () => {
      requests.current++;
    };
  }, [step, refreshMicrophones, run]); // Fetch only when this step opens.
  useEffect(() => {
    if (step > 0) stepHeading.current?.focus();
  }, [step]);
  useEffect(() => {
    if (
      practiceAttempted &&
      snapshot.diagnostic.phase === "done" &&
      snapshot.diagnostic.transcript.trim() &&
      !isBusy(snapshot.status.phase)
    ) {
      setPracticeCompletedKey(speechSettingsKey);
      setPracticeAttempted(false);
    }
  }, [practiceAttempted, snapshot.diagnostic, snapshot.status.phase, speechSettingsKey]);

  async function action(work: () => Promise<unknown>) {
    setPending(true);
    try {
      await run(work);
    } finally {
      setPending(false);
    }
  }
  function navigate(next: number, direction: number, animate: boolean) {
    setNavigation({ step: next, direction, animate });
  }
  function changeUseCase(value: OnboardingUseCase) {
    setUseCase(value);
    setBasicRequested(false);
    setRecipeKind(defaultRecipeKind(value));
    if (!recipeEdited) setWorkflowDraft(createWorkflowDraft(value));
    if (!profileNameEdited)
      setProfileName(
        uniqueProfileName(t(`onboarding.defaultProfileName.${value}`), snapshot.dictationProfiles),
      );
  }
  function startPractice() {
    setPracticeAttempted(true);
    setPracticeCompletedKey("");
  }
  function finish(basic = false) {
    if (!dictationReady || nameError || pending || busy) return;
    const kind = basic ? "none" : effectiveKind;
    const config = buildWorkflowConfig(
      baseTextConfig,
      workflowDraft,
      kind,
      !basic && !basicRequested && textReady,
    );
    void action(() =>
      savedActions.completeOnboarding(
        {
          id: profileID,
          name: trimmedName,
          modelPath: snapshot.settings.modelPath,
          language: snapshot.settings.language,
          cleanText: snapshot.settings.cleanText,
          autoPromptId: config.autoPromptId,
          textModel: profileTextConnection(config),
        },
        config,
      ),
    );
  }
  function next(animate: boolean) {
    if (step === 1) {
      void action(async () => {
        if (language !== snapshot.settings.language || cleanText !== snapshot.settings.cleanText)
          await savedActions.settings({ ...snapshot.settings, language, cleanText });
        navigate(2, 1, animate);
      });
      return;
    }
    navigate(step + 1, 1, animate);
  }

  const completed = [
    true,
    snapshot.ready,
    micPassed,
    shortcutPassed,
    practiceCompleted,
    !workflowValidation,
    !nameError,
  ];
  const canContinue = completed[step];
  const guidance =
    step === 0
      ? t("onboarding.goalGuidance")
      : step === 1 && !snapshot.ready
        ? t("setupPage.downloadOrSelectAModelToContinue")
        : step === 2 && !micPassed
          ? t("setupPage.testYourMicrophoneToContinue")
          : step === 3 && !shortcutPassed
            ? shortcut !== snapshot.settings.shortcut
              ? t("setupPage.applyYourShortcutThenPressItOnce")
              : t("setupPage.pressYourShortcutOnceToFinishSetup")
            : step === 4 && !practiceCompleted
              ? t("onboarding.practiceGuidance")
              : step === 6
                ? t("onboarding.finishGuidance")
                : t("onboarding.continueGuidance");

  return (
    <div className="@container/setup flex min-h-[calc(100dvh-2rem)] flex-col gap-7">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">{t("setupPage.setUpYap")}</h1>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.progress", { current: step + 1, total: steps.length })}
          </p>
        </div>
        <Progress
          aria-label={t("setupPage.setupSteps")}
          value={((step + 1) / steps.length) * 100}
        />
        <ol
          aria-label={t("setupPage.setupSteps")}
          className="grid min-w-0 grid-cols-7 gap-1 @min-[48rem]/setup:gap-2"
        >
          {steps.map(({ label, shortLabel, icon: Icon }, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className="flex min-w-0 flex-col items-center gap-2 p-1 text-center"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  index === step || (index < step && completed[index])
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {index < step && completed[index] ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Icon aria-hidden="true" />
                )}
              </span>
              <p
                className={cn(
                  "max-w-full text-xs font-medium [overflow-wrap:anywhere]",
                  index !== step && "text-muted-foreground",
                )}
              >
                <span className="hidden @min-[48rem]/setup:inline">{label}</span>
                <span className="sr-only @min-[48rem]/setup:hidden">{shortLabel}</span>
                {index < step && completed[index] && (
                  <span className="sr-only">{t("setupPage.complete")}</span>
                )}
              </p>
            </li>
          ))}
        </ol>
      </header>
      <div>
        <h2
          ref={stepHeading}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          {steps[step].title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{steps[step].description}</p>
      </div>
      <AnimatePresence initial={false} mode="popLayout" custom={navigation.animate}>
        <MotionReveal
          key={step}
          preset="setup"
          from={`translateX(${navigation.direction * 24}px)`}
          instant={!navigation.animate}
          className="min-w-0 pb-[calc(var(--setup-footer-height,5rem)+1rem)]"
        >
          {step === 0 && (
            <GoalStep
              useCase={useCase}
              language={language}
              preference={preference}
              cleanText={cleanText}
              disabled={busy || pending}
              onUseCase={changeUseCase}
              onLanguage={setLanguage}
              onPreference={setPreference}
              onCleanText={setCleanText}
            />
          )}
          {step === 1 && (
            <SpeechModelStep
              models={snapshot.models}
              settings={snapshot.settings}
              language={language}
              preference={preference}
              cleanText={cleanText}
              ready={snapshot.ready}
              disabled={busy || pending}
            />
          )}
          {step === 2 && (
            <MicrophoneStep
              settings={snapshot.settings}
              status={snapshot.status}
              microphones={microphones}
              microphoneTested={snapshot.microphoneTested}
              mic={mic}
              micAttempted={micAttempted}
              celebrated={celebratedMic}
              pending={pending}
              busy={busy}
              onMic={(value) => {
                setMic(value);
                setMicAttempted(false);
              }}
              onAttempt={() => setMicAttempted(true)}
              onCelebrate={setCelebratedMic}
              onRefresh={refreshMicrophones}
              onSettings={savedActions.settings}
              action={action}
            />
          )}
          {step === 3 && (
            <ShortcutStep
              settings={snapshot.settings}
              status={snapshot.status}
              shortcutTested={snapshot.shortcutTested}
              shortcut={shortcut}
              pending={pending}
              busy={busy}
              onShortcut={setShortcut}
              onSettings={savedActions.settings}
              action={action}
            />
          )}
          {step === 4 && (
            <DictationPractice
              disabled={busy || pending || !snapshot.ready}
              onStart={startPractice}
            />
          )}
          {step === 5 && (
            <WorkflowStep
              base={baseTextConfig}
              draft={workflowDraft}
              kind={recipeKind}
              preference={preference}
              textReady={textReady}
              runtimeAvailable={!!snapshot.textRuntimeAvailable}
              practiceCompleted={practiceCompleted}
              disabled={busy || pending}
              onBaseChange={(value) =>
                void action(() => savedActions.textProcessing({ ...baseTextConfig, ...value }))
              }
              onDraft={(value) => {
                setWorkflowDraft(value);
                setRecipeEdited(true);
              }}
              onKind={(value) => {
                setBasicRequested(false);
                setRecipeKind(value);
              }}
              onPracticeStart={startPractice}
            />
          )}
          {step === 6 && (
            <ProfileStep
              name={profileName}
              speechModel={
                currentSpeechModel?.name ?? snapshot.settings.modelPath.split(/[\\/]/).pop() ?? ""
              }
              language={
                languages.find((item) => item.value === snapshot.settings.language)?.label ??
                snapshot.settings.language
              }
              cleanText={snapshot.settings.cleanText}
              textModel={!basicRequested && textReady ? baseTextConfig.model : ""}
              recipeKind={effectiveKind}
              recipeName={
                effectiveKind === "prompt" ? workflowDraft.prompt.name : workflowDraft.chain.name
              }
              nameError={nameError}
              disabled={busy || pending}
              onName={(value) => {
                setProfileName(value);
                setProfileNameEdited(true);
              }}
            />
          )}
        </MotionReveal>
      </AnimatePresence>
      <footer
        ref={footer}
        className="sticky bottom-0 z-20 -mb-8 mt-auto flex flex-wrap items-center justify-between gap-3 border-t bg-background py-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              disabled={busy || pending}
              onClick={(event) => navigate(step - 1, -1, event.detail > 0)}
            >
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              {t("common.back")}
            </Button>
          )}
          {step === 5 && (
            <Button
              variant="ghost"
              disabled={busy || pending || !practiceCompleted}
              onClick={(event) => {
                setBasicRequested(true);
                setRecipeKind("none");
                navigate(6, 1, event.detail > 0);
              }}
            >
              {t("onboarding.finishBasic")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">{guidance}</p>
          {step < steps.length - 1 ? (
            <Button
              pressFeedback
              className="disabled:bg-muted disabled:text-muted-foreground"
              disabled={busy || pending || !canContinue}
              onClick={(event) => next(event.detail > 0)}
            >
              {t("common.next")}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          ) : (
            <>
              {effectiveKind !== "none" && (
                <Button
                  variant="outline"
                  disabled={busy || pending || !dictationReady || !!nameError}
                  onClick={() => finish(true)}
                >
                  {t("onboarding.finishBasic")}
                </Button>
              )}
              <Button
                pressFeedback
                className="disabled:bg-muted disabled:text-muted-foreground"
                disabled={busy || pending || !dictationReady || !!nameError}
                onClick={() => finish(false)}
              >
                {basicRequested || !textReady
                  ? t("onboarding.finishBasic")
                  : t("onboarding.saveActivateProfile")}
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
