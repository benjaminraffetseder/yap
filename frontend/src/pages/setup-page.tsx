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

const steps = [
  {
    label: "Speech model",
    shortLabel: "Model",
    icon: HardDriveDownload,
    title: "Choose your speech model",
    description: "Pick the model that fits your day. You can switch anytime.",
  },
  {
    label: "Microphone",
    shortLabel: "Mic",
    icon: Mic,
    title: "Let’s hear you",
    description: "Choose your microphone and make sure your voice comes through.",
  },
  {
    label: "Shortcut",
    shortLabel: "Shortcut",
    icon: Keyboard,
    title: "One shortcut. Ready when you are.",
    description: "Set a global shortcut so Yap is always within reach.",
  },
];

export function SetupPage() {
  const { snapshot, run, level, setMicrophoneTestVisible } = useDictation();
  const [step, setStep] = useState(0);
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
      title: "Speech model ready",
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
    { value: "", label: "System default" },
    ...microphones.map((device) => ({ value: device.id, label: device.name })),
    ...(mic && !microphones.some((device) => device.id === mic)
      ? [{ value: mic, label: "Selected microphone (disconnected)" }]
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
      ? "Everything is ready. Let's start dictating."
      : `Up next: ${steps[step + 1].label.toLowerCase()}`
    : step === 0
      ? "Download or select a model to continue."
      : step === 1
        ? "Test your microphone to continue."
        : shortcut !== snapshot.settings.shortcut
          ? "Apply your shortcut, then press it once."
          : "Press your shortcut once to finish setup.";
  return (
    <div className="flex min-h-[calc(100dvh-2rem)] flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Set up Yap</h1>
        </div>
        <ol aria-label="Setup steps" className="grid grid-cols-3 gap-2 sm:gap-3">
          {steps.map(({ label, shortLabel, icon: Icon }, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={cn("flex flex-col gap-3 p-2 sm:flex-row sm:items-center sm:p-3")}
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
                    "text-xs font-medium sm:text-sm",
                    index !== step && "text-muted-foreground",
                  )}
                >
                  <span className="hidden sm:inline">
                    <span className="mr-1 tabular-nums">{index + 1}.</span> {label}
                  </span>
                  <span className="sm:hidden">{shortLabel}</span>
                  {index < step && completed[index] && <span className="sr-only">, complete</span>}
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
      {step === 0 && <ModelsPage embedded />}
      {step === 1 && (
        <section
          aria-label="Microphone setup"
          className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-2"
        >
          <div className="space-y-5 p-5 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Mic className="size-5" aria-hidden="true" />
              </span>
              <h3 className="font-semibold">Test your microphone</h3>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-microphone">Microphone</Label>
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
                  <SelectTrigger id="setup-microphone" className="data-[size=default]:h-9 w-full">
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
                  aria-label="Refresh microphones"
                  disabled={busy || pending}
                  onClick={() => void action(refreshMicrophones)}
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Speak for a few seconds. Test audio is deleted and never transcribed.
            </p>
            <Button
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
              {testing ? "Stop test" : "Test microphone"}
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              You can also test transcription in{" "}
              <Link className="text-primary underline underline-offset-4" to="/settings">
                dictation diagnostics in Settings
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-5 border-t bg-muted/20 px-5 py-8 sm:px-7 lg:border-t-0 lg:border-l">
            <span
              className={cn(
                "flex size-16 items-center justify-center rounded-2xl border",
                testing || micPassed
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "bg-background text-muted-foreground",
              )}
            >
              {micPassed && !testing ? (
                <Check className="size-7" aria-hidden="true" />
              ) : (
                <Mic className="size-7" aria-hidden="true" />
              )}
            </span>
            <div className="w-full max-w-xs">
              <div aria-hidden="true" className="flex h-12 items-end gap-1.5">
                {Array.from({ length: 24 }, (_, index) => (
                  <span
                    key={index}
                    className={cn(
                      "h-full min-w-0 flex-1 rounded-sm transition-colors motion-reduce:transition-none",
                      testing && inputLevel * 24 > index ? "bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Input level</span>
                <span className="tabular-nums">
                  {testing ? `${Math.round(inputLevel * 100)}%` : "—"}
                </span>
              </div>
              {testing && (
                <meter
                  aria-label="Microphone level"
                  className="sr-only"
                  min={0}
                  max={1}
                  value={level}
                />
              )}
            </div>
            <div className="text-center">
              <p
                role="status"
                className={cn("text-sm font-medium", micPassed && !testing && "text-primary")}
              >
                {testing ? "Listening…" : micPassed ? "Microphone test passed" : "Ready to test"}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {testing
                  ? snapshot.status.message
                  : micPassed
                    ? "Your microphone is ready. You can continue."
                    : micAttempted
                      ? "Check your microphone access or try another input, then test again."
                      : "Start the test, then say a few words."}
              </p>
            </div>
          </div>
        </section>
      )}
      {step === 2 && (
        <section aria-label="Shortcut setup" className="overflow-hidden rounded-2xl border bg-card">
          <div className="space-y-5 bg-muted/20 px-5 py-8 text-center sm:px-7">
            <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Keyboard className="size-6" aria-hidden="true" />
            </span>
            <h3 className="font-semibold">Test your shortcut</h3>
            <div
              aria-label={`Saved shortcut: ${snapshot.settings.shortcut}`}
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
              {shortcutPassed ? "Shortcut test passed" : "Press your shortcut once to test it"}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              This checks your shortcut without starting a recording.
            </p>
          </div>
          <div className="space-y-4 border-t p-5 sm:p-7">
            <div className="space-y-2">
              <Label htmlFor="setup-shortcut">Global shortcut</Label>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1 basis-64">
                  <ShortcutInput
                    id="setup-shortcut"
                    value={shortcut}
                    disabled={busy || pending}
                    onChange={setShortcut}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={busy || pending || shortcut === snapshot.settings.shortcut}
                  onClick={() =>
                    void action(() => backend.settings({ ...snapshot.settings, shortcut }))
                  }
                >
                  Apply shortcut
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Ctrl, Alt, Shift + Space, A–Z, or F1–F12. Change hold/toggle mode in{" "}
              <Link className="underline" to="/settings">
                Settings
              </Link>
              .
            </p>
            <ShortcutStatus disabled={busy || pending} />
          </div>
        </section>
      )}
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
            Skip setup
          </Button>
          {step > 0 && (
            <Button variant="outline" disabled={busy || pending} onClick={() => setStep(step - 1)}>
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">{guidance}</p>
          {step < 2 ? (
            <Button
              disabled={busy || pending || (step === 0 ? !snapshot.ready : !micPassed)}
              onClick={() => setStep(step + 1)}
            >
              Next
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              disabled={busy || pending || !shortcutPassed}
              onClick={() => void action(() => backend.completeSetup(false))}
            >
              Finish setup
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
