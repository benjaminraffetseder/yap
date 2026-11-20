import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AudioMeter } from "@/features/dictation/components/audio-meter";
import {
  useDictationActions,
  useDictationMetadata,
  useDictationStatus,
} from "@/features/dictation/hooks/use-dictation-state";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy } from "@/lib/backend";
import { Check, Loader2, Mic, Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function DictationPractice({
  disabled,
  onStart,
  compact = false,
}: {
  disabled: boolean;
  onStart: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { run } = useDictationActions();
  const status = useDictationStatus();
  const { diagnostic } = useDictationMetadata();
  const [pending, setPending] = useState(false);
  const recording = status.phase === "diagnostic-recording";
  const transcribing = status.phase === "diagnostic-transcribing";
  const busy = isBusy(status.phase);

  async function act(action: () => Promise<unknown>) {
    setPending(true);
    try {
      await run(action);
    } finally {
      setPending(false);
    }
  }

  const controls = (
    <>
      {recording && (
        <div className="flex flex-col gap-2">
          <AudioMeter
            label={t("diagnosticsPanel.dictationTestMicrophoneLevel")}
            className="max-w-none"
          />
          <p role="status" className="text-sm text-muted-foreground">
            {t("onboarding.sayThenStop")}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending || (!recording && (disabled || busy)) || (transcribing && !recording)}
          onClick={() =>
            void act(async () => {
              if (!recording) onStart();
              await (recording ? backend.stopDictationTest : backend.testDictation)();
            })
          }
        >
          {recording ? (
            <Square data-icon="inline-start" aria-hidden="true" />
          ) : transcribing ? (
            <Loader2
              data-icon="inline-start"
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Mic data-icon="inline-start" aria-hidden="true" />
          )}
          {recording
            ? t("diagnosticsPanel.stopDictationTest")
            : transcribing
              ? t("diagnosticsPanel.transcribingTest")
              : diagnostic.phase === "done"
                ? t("onboarding.practiceAgain")
                : t("onboarding.practiceDictation")}
        </Button>
        {(recording || transcribing) && (
          <Button variant="outline" disabled={pending} onClick={() => void act(backend.cancel)}>
            {t("promptsPage.cancelTest")}
          </Button>
        )}
      </div>
    </>
  );

  const result = diagnostic.phase && !recording && (
    <div aria-live="polite" className="flex flex-col gap-3">
      <p
        role={diagnostic.phase === "error" ? "alert" : "status"}
        className={
          diagnostic.phase === "error"
            ? "text-sm text-destructive"
            : diagnostic.phase === "done"
              ? "flex items-center gap-2 text-sm text-primary"
              : "text-sm text-muted-foreground"
        }
      >
        {diagnostic.phase === "done" && <Check aria-hidden="true" />}
        {nativeText(diagnostic.message)}
      </p>
      {diagnostic.transcript && (
        <div className="rounded-lg border bg-background p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {t("diagnosticsPanel.transcriptPreview")}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-7">{diagnostic.transcript}</p>
        </div>
      )}
      {diagnostic.details && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("diagnosticsPanel.technicalDetails")}</summary>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all">
            {diagnostic.details}
          </pre>
        </details>
      )}
    </div>
  );

  if (compact)
    return (
      <div className="flex flex-col gap-4">
        {controls}
        {result}
      </div>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("onboarding.practiceTitle")}</CardTitle>
        <CardDescription>{t("onboarding.practicePrivacy")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {controls}
        {result}
      </CardContent>
    </Card>
  );
}
