import { MotionReveal } from "@/components/shared/motion-reveal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShortcutInput } from "@/features/dictation/components/shortcut-input";
import { ShortcutStatus } from "@/features/dictation/components/shortcut-status";
import { useAudioLevel } from "@/features/dictation/hooks/use-dictation-state";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import { nativeText } from "@/i18n/native-text";
import { backend, type Microphone, type Settings, type Status } from "@/lib/backend";
import { fade } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Check, Keyboard, Mic, RefreshCw, Square } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

type Action = (work: () => Promise<unknown>) => Promise<void>;

export function MicrophoneStep({
  settings,
  status,
  microphones,
  microphoneTested,
  mic,
  micAttempted,
  celebrated,
  pending,
  busy,
  onMic,
  onAttempt,
  onCelebrate,
  onRefresh,
  onSettings,
  action,
}: {
  settings: Settings;
  status: Status;
  microphones: Microphone[];
  microphoneTested: boolean;
  mic: string;
  micAttempted: boolean;
  celebrated: boolean;
  pending: boolean;
  busy: boolean;
  onMic: (value: string) => void;
  onAttempt: () => void;
  onCelebrate: (value: boolean) => void;
  onRefresh: () => Promise<void>;
  onSettings: (settings: Settings) => Promise<unknown>;
  action: Action;
}) {
  const { t } = useTranslation();
  const testing = status.phase === "mic-test";
  const passed = microphoneTested && mic === settings.microphoneId;
  const options = [
    { value: "", label: t("settingsPage.systemDefault") },
    ...microphones.map((device) => ({ value: device.id, label: device.name })),
    ...(mic && !microphones.some((device) => device.id === mic)
      ? [{ value: mic, label: t("settingsPage.selectedMicrophoneDisconnected") }]
      : []),
  ];
  return (
    <section
      aria-label={t("setupPage.microphoneSetup")}
      className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-2"
    >
      <div className="flex flex-col gap-5 p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mic className="size-5" aria-hidden="true" />
          </span>
          <h3 className="font-semibold">{t("setupPage.testYourMicrophone")}</h3>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-microphone">{t("settingsPage.microphone")}</Label>
          <div className="flex gap-2">
            <Select
              items={options}
              value={mic}
              disabled={busy || pending}
              onValueChange={(value) => {
                if (value !== null) onMic(value);
              }}
            >
              <SelectTrigger id="setup-microphone" className="w-full data-[size=default]:h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("settingsPage.refreshMicrophones")}
              disabled={busy || pending}
              onClick={() => void action(onRefresh)}
            >
              <RefreshCw aria-hidden="true" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("setupPage.speakForAFewSecondsTestAudio")}
        </p>
        <Button
          pressFeedback
          className="self-start rounded-lg"
          variant={testing ? "outline" : "default"}
          disabled={pending || (busy && !testing)}
          onClick={() =>
            void action(async () => {
              if (testing) return backend.stopMicTest();
              if (mic !== settings.microphoneId)
                await onSettings({ ...settings, microphoneId: mic });
              onAttempt();
              await backend.testMic();
            })
          }
        >
          {testing ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
          {testing
            ? t("setupPage.stopTest")
            : passed
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
            testing || passed
              ? "border-primary/20 bg-primary/10 text-primary"
              : "bg-background text-muted-foreground",
          )}
        >
          {passed && !testing ? (
            <MicrophoneSuccess celebrated={celebrated} onCelebrate={onCelebrate} />
          ) : (
            <Mic className="size-7" aria-hidden="true" />
          )}
        </span>
        {testing && <MicrophoneLevelMeter />}
        <div className="text-center">
          <p
            role="status"
            className={cn("text-sm font-medium", passed && !testing && "text-primary")}
          >
            {testing
              ? t("setupPage.listening")
              : passed
                ? t("uiPolish.lastMicrophoneTestPassed")
                : t("setupPage.readyToTest")}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {testing
              ? nativeText(status.message)
              : passed
                ? t("setupPage.yourMicrophoneIsReadyYouCanContinue")
                : micAttempted
                  ? t("setupPage.checkYourMicrophoneAccessOrTryAnother")
                  : t("setupPage.startTheTestThenSayAFew")}
          </p>
        </div>
      </div>
    </section>
  );
}

export function ShortcutStep({
  settings,
  status,
  shortcutTested,
  shortcut,
  pending,
  busy,
  onShortcut,
  onSettings,
  action,
}: {
  settings: Settings;
  status: Status;
  shortcutTested: boolean;
  shortcut: string;
  pending: boolean;
  busy: boolean;
  onShortcut: (value: string) => void;
  onSettings: (settings: Settings) => Promise<unknown>;
  action: Action;
}) {
  const { t } = useTranslation();
  const passed = shortcutTested && shortcut === settings.shortcut && !status.shortcutError;
  return (
    <section
      aria-label={t("setupPage.shortcutSetup")}
      className="overflow-hidden rounded-2xl border bg-card"
    >
      <div className="flex flex-col gap-3 bg-muted/20 px-5 py-5 text-center sm:px-7">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Keyboard className="size-6" aria-hidden="true" />
        </span>
        <h3 className="font-semibold">{t("setupPage.testYourShortcut")}</h3>
        <div
          aria-label={t("setupPage.savedShortcut", { shortcut: settings.shortcut })}
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {settings.shortcut.split("+").map((key, index) => (
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
            passed && "text-primary",
          )}
        >
          {passed && <Check aria-hidden="true" />}
          {passed
            ? t("setupPage.shortcutTestPassed")
            : t("setupPage.pressYourShortcutOnceToTestIt")}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("setupPage.thisChecksYourShortcutWithoutStartingA")}
        </p>
      </div>
      <div className="flex flex-col gap-4 border-t p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <Label htmlFor="setup-shortcut">{t("settingsPage.globalShortcut")}</Label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 basis-64">
              <ShortcutInput
                id="setup-shortcut"
                value={shortcut}
                disabled={busy || pending}
                onChange={onShortcut}
              />
            </div>
            {shortcut !== settings.shortcut ? (
              <Button
                variant="outline"
                disabled={busy || pending || shortcut === settings.shortcut}
                onClick={() => void action(() => onSettings({ ...settings, shortcut }))}
              >
                {t("setupPage.applyShortcut")}
              </Button>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-xs text-muted-foreground">
                <Check aria-hidden="true" />
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

function MicrophoneLevelMeter() {
  const { t } = useTranslation();
  const level = useAudioLevel();
  const inputLevel = Math.min(1, Math.max(0, level));
  return (
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
  );
}
