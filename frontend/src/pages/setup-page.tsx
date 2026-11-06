import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { useDictation } from "@/components/dictation-provider";
import { ShortcutInput } from "@/components/shortcut-input";
import { ShortcutStatus } from "@/components/shortcut-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { backend, isBusy, type Microphone } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { ModelsPage } from "@/pages/models-page";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  HardDriveDownload,
  Keyboard,
  Mic,
  RefreshCw,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { MotionReveal } from "@/components/motion-reveal";
import { fade } from "@/lib/motion";

export function SetupPage() {
  const { t } = useTranslation();
  const steps = [
    {
      label: t("common.speechModel"),
      shortLabel: t("common.model"),
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
      shortLabel: t("setupPage.shortcut"),
      icon: Keyboard,
      title: t("setupPage.oneShortcutReadyWhenYouAre"),
      description: t("setupPage.setAGlobalShortcutSoYapIs"),
    },
  ];

  const { snapshot, run, level, setMicrophoneTestVisible } = useDictation();
  const [navigation, setNavigation] = useState({ step: 0, direction: 1, animate: false });
  const { step } = navigation;
  const [celebratedMic, setCelebratedMic] = useState(snapshot.microphoneTested);
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [mic, setMic] = useState(snapshot.settings.microphoneId);
  const [shortcut, setShortcut] = useState(snapshot.settings.shortcut);
  const [pending, setPending] = useState(false);
  const [micAttempted, setMicAttempted] = useState(false);
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
  const testing = snapshot.status.phase === "mic-test";
  const busy = isBusy(snapshot.status.phase);
  useEffect(() => {
    const element = footer.current;
    if (!element) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--setup-footer-height",
        `${element.getBoundingClientRect().height}px`,
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--setup-footer-height");
    };
  }, []);
  useEffect(() => {
    setMicrophoneTestVisible(step === 1);
    return () => setMicrophoneTestVisible(false);
  }, [step, setMicrophoneTestVisible]);
  useEffect(() => {
    if (!snapshot.ready) {
      notifiedModelPath.current = null;
      return;
    }
    if (
      step !== 0 ||
      busy ||
      snapshot.status.phase === "error" ||
      notifiedModelPath.current === snapshot.settings.modelPath
    )
      return;
    notifiedModelPath.current = snapshot.settings.modelPath;
    // Reuse the download notification so setup never shows two success toasts.
    toastManager.add({
      id: "speech-model-download",
      type: "success",
      title: i18n.t("setupPage.speechModelReady"),
      timeout: 5000,
    });
  }, [snapshot.ready, snapshot.settings.modelPath, snapshot.status.phase, step, busy]);
  useEffect(() => {
    if (step === 1) void run(refreshMicrophones, false);
    return () => {
      microphoneRequest.current++;
    };
  }, [step, refreshMicrophones]); // Fetch only when this step opens.
  useEffect(() => {
    if (step > 0) stepHeading.current?.focus();
  }, [step]);
  const options = [
    { value: "", label: t("settingsPage.systemDefault") },
    ...microphones.map((device) => ({ value: device.id, label: device.name })),
    ...(mic && !microphones.some((device) => device.id === mic)
      ? [{ value: mic, label: t("settingsPage.selectedMicrophoneDisconnected") }]
      : []),
  ];
  async function action(work: () => Promise<unknown>) {
    setPending(true);
    await run(work);
    setPending(false);
  }
  const micPassed = snapshot.microphoneTested && mic === snapshot.settings.microphoneId;
  const shortcutPassed =
    snapshot.shortcutTested &&
    shortcut === snapshot.settings.shortcut &&
    !snapshot.status.shortcutError;
  const completed = [snapshot.ready, micPassed, shortcutPassed];
  const canContinue = completed[step];
  const inputLevel = Math.min(1, Math.max(0, level));
  const guidance = canContinue
    ? step === 2
      ? t("setupPage.everythingIsReadyLetSStartDictating")
      : t("setupPage.upNext", { step: steps[step + 1].label.toLowerCase() })
    : step === 0
      ? t("setupPage.downloadOrSelectAModelToContinue")
      : step === 1
        ? t("setupPage.testYourMicrophoneToContinue")
        : shortcut !== snapshot.settings.shortcut
          ? t("setupPage.applyYourShortcutThenPressItOnce")
          : t("setupPage.pressYourShortcutOnceToFinishSetup");
  return (
    <div className="@container/setup flex min-h-[calc(100dvh-2rem)] flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("setupPage.setUpYap")}</h1>
        </div>
        <ol
          aria-label={t("setupPage.setupSteps")}
          className="grid min-w-0 grid-cols-3 gap-2 @min-[40rem]/setup:gap-3"
        >
          {steps.map(({ label, shortLabel, icon: Icon }, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className="flex min-w-0 flex-col gap-3 p-2 @min-[40rem]/setup:flex-row @min-[40rem]/setup:items-center @min-[40rem]/setup:p-3"
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
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Icon className="size-4" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs font-medium @min-[40rem]/setup:text-sm",
                    index !== step && "text-muted-foreground",
                  )}
                >
                  <span className="hidden @min-[40rem]/setup:inline">
                    <span className="mr-1 tabular-nums">{index + 1}.</span> {label}
                  </span>
                  <span className="@min-[40rem]/setup:hidden">{shortLabel}</span>
                  {index < step && completed[index] && (
                    <span className="sr-only">{t("setupPage.complete")}</span>
                  )}
                </p>
              </div>
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
          {step === 0 && <ModelsPage embedded />}
          {step === 1 && (
            <section
              aria-label={t("setupPage.microphoneSetup")}
              className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-2"
            >
              <div className="space-y-5 p-5 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Mic className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-semibold">{t("setupPage.testYourMicrophone")}</h3>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-microphone">{t("settingsPage.microphone")}</Label>
                  <div className="flex gap-2">
                    <Select
                      items={options}
                      value={mic}
                      disabled={busy || pending}
                      onValueChange={(value) => {
                        if (value !== null) {
                          setMic(value);
                          setMicAttempted(false);
                        }
                      }}
                    >
                      <SelectTrigger
                        id="setup-microphone"
                        className="data-[size=default]:h-9 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        {options.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("settingsPage.refreshMicrophones")}
                      disabled={busy || pending}
                      onClick={() => void action(refreshMicrophones)}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("setupPage.speakForAFewSecondsTestAudio")}
                </p>
                <Button
                  pressFeedback
                  className="rounded-lg"
                  variant={testing ? "outline" : "default"}
                  disabled={pending || (busy && !testing)}
                  onClick={() =>
                    void action(async () => {
                      if (testing) return backend.stopMicTest();
                      if (mic !== snapshot.settings.microphoneId)
                        await backend.settings({
                          ...snapshot.settings,
                          microphoneId: mic,
                        });
                      setMicAttempted(true);
                      await backend.testMic();
                    })
                  }
                >
                  {testing ? (
                    <Square className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Mic className="size-4" aria-hidden="true" />
                  )}
                  {testing
                    ? t("setupPage.stopTest")
                    : micPassed
                      ? t("uiPolish.testAgain")
                      : t("setupPage.testMicrophone")}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("setupPage.youCanAlsoTestTranscriptionIn")}{" "}
                  <Link className="text-primary underline underline-offset-4" to="/settings">
                    {t("setupPage.dictationDiagnosticsInSettings")}
                  </Link>
                  .
                </p>
              </div>
              <div className="flex flex-col items-center justify-center gap-5 border-t bg-muted/20 px-5 py-8 sm:px-7 lg:border-t-0 lg:border-l">
                <span
                  className={cn(
                    "relative flex size-16 items-center justify-center rounded-2xl border",
                    testing || micPassed
                      ? "border-primary/20 bg-primary/10 text-primary"
                      : "bg-background text-muted-foreground",
                  )}
                >
                  {micPassed && !testing ? (
                    <MicrophoneSuccess celebrated={celebratedMic} onCelebrate={setCelebratedMic} />
                  ) : (
                    <Mic className="size-7" aria-hidden="true" />
                  )}
                </span>
                {testing && (
                  <div className="w-full max-w-xs">
                    <div aria-hidden="true" className="flex h-12 items-end gap-1.5">
                      {Array.from({ length: 24 }, (_, index) => (
                        <span
                          key={index}
                          className={cn(
                            "h-full min-w-0 flex-1 rounded-sm transition-colors motion-reduce:transition-none",
                            inputLevel * 24 > index ? "bg-primary" : "bg-muted",
                          )}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{t("setupPage.inputLevel")}</span>
                      <span className="tabular-nums">{`${Math.round(inputLevel * 100)}%`}</span>
                    </div>
                    <meter
                      aria-label={t("setupPage.microphoneLevel")}
                      className="sr-only"
                      min={0}
                      max={1}
                      value={level}
                    />
                  </div>
                )}
                <div className="text-center">
                  <p
                    role="status"
                    className={cn("text-sm font-medium", micPassed && !testing && "text-primary")}
                  >
                    {testing
                      ? t("setupPage.listening")
                      : micPassed
                        ? t("uiPolish.lastMicrophoneTestPassed")
                        : t("setupPage.readyToTest")}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {testing
                      ? nativeText(snapshot.status.message)
                      : micPassed
                        ? t("setupPage.yourMicrophoneIsReadyYouCanContinue")
                        : micAttempted
                          ? t("setupPage.checkYourMicrophoneAccessOrTryAnother")
                          : t("setupPage.startTheTestThenSayAFew")}
                  </p>
                </div>
              </div>
            </section>
          )}
          {step === 2 && (
            <section
              aria-label={t("setupPage.shortcutSetup")}
              className="overflow-hidden rounded-2xl border bg-card"
            >
              <div className="space-y-3 bg-muted/20 px-5 py-5 text-center sm:px-7">
                <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Keyboard className="size-6" aria-hidden="true" />
                </span>
                <h3 className="font-semibold">{t("setupPage.testYourShortcut")}</h3>
                <div
                  aria-label={t("setupPage.savedShortcut", {
                    shortcut: snapshot.settings.shortcut,
                  })}
                  className="flex flex-wrap items-center justify-center gap-2"
                >
                  {snapshot.settings.shortcut.split("+").map((key, index) => (
                    <span key={`${key}-${index}`} className="inline-flex items-center gap-2">
                      {index > 0 && (
                        <span aria-hidden="true" className="text-muted-foreground">
                          +
                        </span>
                      )}
                      <kbd className="min-w-12 rounded-lg border border-b-[3px] bg-background px-3 py-2.5 text-sm font-medium shadow-xs sm:px-4 sm:text-base">
                        {key}
                      </kbd>
                    </span>
                  ))}
                </div>
                <p
                  role="status"
                  className={cn(
                    "flex items-center justify-center gap-2 text-sm font-medium",
                    shortcutPassed && "text-primary",
                  )}
                >
                  {shortcutPassed && <Check className="size-4" aria-hidden="true" />}
                  {shortcutPassed
                    ? t("setupPage.shortcutTestPassed")
                    : t("setupPage.pressYourShortcutOnceToTestIt")}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("setupPage.thisChecksYourShortcutWithoutStartingA")}
                </p>
              </div>
              <div className="space-y-4 border-t p-5 sm:p-7">
                <div className="space-y-2">
                  <Label htmlFor="setup-shortcut">{t("settingsPage.globalShortcut")}</Label>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1 basis-64">
                      <ShortcutInput
                        id="setup-shortcut"
                        value={shortcut}
                        disabled={busy || pending}
                        onChange={setShortcut}
                      />
                    </div>
                    {shortcut !== snapshot.settings.shortcut ? (
                      <Button
                        variant="outline"
                        disabled={busy || pending || shortcut === snapshot.settings.shortcut}
                        onClick={() =>
                          void action(() => backend.settings({ ...snapshot.settings, shortcut }))
                        }
                      >
                        {t("setupPage.applyShortcut")}
                      </Button>
                    ) : (
                      <span className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                        <Check aria-hidden="true" className="size-3.5" />
                        {t("uiPolish.saved")}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("setupPage.ctrlAltShiftSpaceAZOr")}{" "}
                  <Link className="underline" to="/settings">
                    {t("common.settings")}
                  </Link>
                  .
                </p>
                <ShortcutStatus disabled={busy || pending} />
              </div>
            </section>
          )}
        </MotionReveal>
      </AnimatePresence>
      <footer
        ref={footer}
        className="sticky bottom-0 z-20 -mb-8 mt-auto flex flex-wrap items-center justify-between gap-4 border-t bg-background py-5"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={busy || pending}
            onClick={() => void action(() => backend.completeSetup(true))}
          >
            {t("setupPage.skipSetup")}
          </Button>
          {step > 0 && (
            <Button
              variant="outline"
              disabled={busy || pending}
              onClick={(event) =>
                setNavigation({ step: step - 1, direction: -1, animate: event.detail > 0 })
              }
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {t("common.back")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">{guidance}</p>
          {step < 2 ? (
            <Button
              pressFeedback
              className="disabled:bg-muted disabled:text-muted-foreground"
              disabled={busy || pending || (step === 0 ? !snapshot.ready : !micPassed)}
              onClick={(event) =>
                setNavigation({ step: step + 1, direction: 1, animate: event.detail > 0 })
              }
            >
              {t("common.next")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              pressFeedback
              className="disabled:bg-muted disabled:text-muted-foreground"
              disabled={busy || pending || !shortcutPassed}
              onClick={() => void action(() => backend.completeSetup(false))}
            >
              {t("setupPage.finishSetup")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function MicrophoneSuccess({
  celebrated,
  onCelebrate,
}: {
  celebrated: boolean;
  onCelebrate: (value: boolean) => void;
}) {
  const reduced = useMotionPreference();
  const [play] = useState(!celebrated);
  useEffect(() => {
    if (play) onCelebrate(true);
  }, [play, onCelebrate]);

  return (
    <>
      {play && !reduced && (
        <motion.span
          aria-hidden="true"
          data-slot="setup-success-halo"
          className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/30"
          initial={{ opacity: 0.25, transform: "scale(1)" }}
          animate={{ opacity: 0, transform: "scale(1.35)" }}
          transition={fade(false, 0.28)}
        />
      )}
      <MotionReveal
        preset="success"
        from="scale(0.8)"
        rest="scale(1)"
        enter={play}
        data-slot="setup-mic-success"
      >
        <Check className="size-7" aria-hidden="true" />
      </MotionReveal>
    </>
  );
}
