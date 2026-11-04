import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { useDictation } from "@/components/dictation-provider";
import { backend, duration } from "@/lib/backend";
import { AudioLines, Loader2, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
export function RecordingStatus() {
  const { t } = useTranslation();
  const {
    snapshot: { status, floatingIndicator, recordingSaveHistory },
    level,
    run,
    microphoneTestVisible,
  } = useDictation();
  const [now, setNow] = useState(Date.now());
  const recording = status.phase === "recording";
  const diagnostic = status.phase.startsWith("diagnostic-");
  const testing = status.phase === "mic-test" || diagnostic;
  const capturing =
    recording || status.phase === "mic-test" || status.phase === "diagnostic-recording";
  useEffect(() => {
    if (!capturing) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [capturing]);
  if (
    status.importId ||
    (status.phase === "mic-test" && microphoneTestVisible) ||
    (!testing && floatingIndicator) ||
    (!capturing && status.phase !== "transcribing" && status.phase !== "diagnostic-transcribing")
  )
    return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-[var(--sidebar-width)] right-0 z-50 flex justify-center px-4 transition-[left] duration-200 motion-reduce:transition-none group-has-[[data-slot=history-selection-bar]]/layout:bottom-32">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex max-w-full items-center gap-4 rounded-2xl border bg-card px-5 py-3 shadow-xl"
      >
        {capturing ? (
          <AudioLines className="size-5 text-primary" style={{ opacity: 0.4 + level * 0.6 }} />
        ) : (
          <Loader2 className="size-5 animate-spin motion-reduce:animate-none text-primary" />
        )}
        <span className="text-sm font-medium">
          {capturing
            ? `${diagnostic ? t("recordingStatus.dictationTest") : testing ? t("recordingStatus.microphoneTest") : t("homePage.recording")} · ${duration(Math.max(0, now - status.startedAt))}`
            : diagnostic
              ? t("diagnosticsPanel.transcribingTest")
              : nativeText(status.message)}
          {recording && (
            <span className="ml-2 text-xs text-muted-foreground">
              {recordingSaveHistory
                ? t("homePage.savingToHistory")
                : t("homePage.notSavingToHistory")}
            </span>
          )}
        </span>
        {capturing && (
          <button
            aria-label={
              diagnostic
                ? t("recordingStatus.stopTestRecording")
                : testing
                  ? t("recordingStatus.stopMicrophoneTest")
                  : t("homePage.stopRecording")
            }
            className="rounded-lg p-2 hover:bg-accent"
            onClick={() =>
              void run(
                diagnostic
                  ? backend.stopDictationTest
                  : testing
                    ? backend.stopMicTest
                    : backend.stop,
              )
            }
          >
            <Square className="size-3.5 fill-current" />
          </button>
        )}
        <button
          aria-label={t("common.cancel")}
          className="rounded-lg p-2 hover:bg-accent"
          onClick={() => void run(backend.cancel)}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
