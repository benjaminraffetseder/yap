import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy, isDesktop, message, type DiagnosticCheck } from "@/lib/backend";

export function DiagnosticsPanel({ disabled = false }: { disabled?: boolean }) {
  const { snapshot, run, level } = useDictation();
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const result = snapshot.diagnostic;
  const recording = snapshot.status.phase === "diagnostic-recording";
  const transcribing = snapshot.status.phase === "diagnostic-transcribing";
  const busy = isBusy(snapshot.status.phase);
  const settingsKey = [
    snapshot.settings.whisperPath,
    snapshot.settings.modelPath,
    snapshot.settings.microphoneId,
  ].join("\u0000");
  async function refreshChecks() {
    if (!isDesktop) return;
    const id = ++request.current;
    setChecking(true);
    setCheckError("");
    try {
      const value = await backend.diagnosticChecks();
      if (id === request.current) setChecks(value);
    } catch (cause) {
      if (id === request.current) setCheckError(message(cause));
    } finally {
      if (id === request.current) setChecking(false);
    }
  }
  useEffect(() => {
    void refreshChecks();
    const onFocus = () => {
      void refreshChecks();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      request.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [settingsKey]);
  async function act(action: () => Promise<unknown>) {
    setPending(true);
    await run(action);
    setPending(false);
  }
  return (
    <section className="settings-section space-y-5" aria-labelledby="diagnostics-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="diagnostics-title" className="font-semibold">
          Dictation diagnostics
        </h2>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh diagnostics"
          disabled={!isDesktop || checking || busy || pending}
          onClick={() => void refreshChecks()}
        >
          <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {checks.length > 0 && (
        <dl className="grid gap-4 sm:grid-cols-3">
          {checks.map((check) => (
            <div key={check.id} className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">{check.name}</dt>
              <dd className={`mt-1 break-words text-sm ${check.ready ? "" : "text-destructive"}`}>
                {check.message}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {checkError && (
        <p role="alert" className="text-sm text-destructive">
          {checkError}
        </p>
      )}
      {disabled && (
        <p className="text-xs text-muted-foreground">Save settings before testing the changes.</p>
      )}
      <p className="text-sm text-muted-foreground">
        Say a short sentence to verify your saved runtime and model. Test audio is deleted; the
        preview stays out of History and the clipboard.
      </p>
      {recording && (
        <div className="space-y-2">
          <meter
            aria-label="Dictation test microphone level"
            className="h-4 w-full"
            min={0}
            max={1}
            value={level}
          />
          <p role="status" className="text-sm">
            Say a short sentence, then stop the test. Recording stops after 10 seconds.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            !isDesktop ||
            pending ||
            (!recording &&
              (disabled ||
                busy ||
                checking ||
                !!checkError ||
                checks.length === 0 ||
                checks.some((check) => !check.ready)))
          }
          onClick={() => void act(recording ? backend.stopDictationTest : backend.testDictation)}
        >
          {recording ? (
            <>
              <Square className="size-4" />
              Stop dictation test
            </>
          ) : transcribing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Transcribing test…
            </>
          ) : (
            "Test dictation"
          )}
        </Button>
        {(recording || transcribing) && (
          <Button variant="outline" disabled={pending} onClick={() => void act(backend.cancel)}>
            Cancel test
          </Button>
        )}
      </div>
      {result.phase && !recording && (
        <div aria-live="polite" className="space-y-3">
          <p
            role={result.phase === "error" ? "alert" : "status"}
            className={`flex items-start gap-2 text-sm ${result.phase === "error" ? "text-destructive" : result.phase === "done" ? "text-primary" : "text-muted-foreground"}`}
          >
            {result.phase === "done" && <Check className="mt-0.5 size-4 shrink-0" />}
            {result.message}
          </p>
          {result.transcript && (
            <div className="rounded-lg border bg-background p-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Transcript preview</p>
              <p className="whitespace-pre-wrap text-sm leading-7">{result.transcript}</p>
            </div>
          )}
          {result.details && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {result.details}
              </pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
