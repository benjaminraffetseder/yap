import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useDictation } from "@/components/dictation-provider";
import { InferenceStats } from "@/components/inference-stats";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backend, isBusy, isDesktop, type HomeResult } from "@/lib/backend";
import { Check, Copy, Loader2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

function recoveryWarning(result: HomeResult) {
  const outcome = result.outcomes;
  if (outcome.history === "failed")
    return i18n.t("homeResultPanel.notSavedToHistorySaveThisResult");
  if (outcome.processing === "failed" || outcome.processing === "cancelled")
    return i18n.t("homeResultPanel.processingRecovery", {
      outcome: nativeText(outcome.processing).toLowerCase(),
      action: result.saved
        ? i18n.t("homeResultPanel.openHistory")
        : i18n.t("homeResultPanel.saveToHistory"),
    });
  if (outcome.clipboard === "failed") return i18n.t("homeResultPanel.copyFailedTryCopyAgain");
  if (outcome.paste === "failed")
    return i18n.t("homeResultPanel.automaticPasteFailedCopyThenPasteManually");
  return "";
}

export function HomeResultPanel({
  fallbackFocus,
}: {
  fallbackFocus: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation();
  const { snapshot, loading, refresh } = useDictation();
  const [result, setResult] = useState<HomeResult | null>(null);
  const [editing, setEditing] = useState<HomeResult | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const request = useRef(0);
  const actionPending = useRef(false);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const current = useRef(result);
  const busy = loading || isBusy(snapshot.status.phase);
  const latestBusy = useRef(busy);
  useEffect(() => {
    current.current = result;
    latestBusy.current = busy;
  }, [result, busy]);

  useEffect(() => {
    const accepted =
      snapshot.status.phase === "recording" ||
      (!!snapshot.status.importId &&
        ["transcribing", "downloading"].includes(snapshot.status.phase));
    if (!accepted) return;
    // Status is emitted only after capture/import acceptance. Other busy phases
    // and rejected starts must not expire temporary text. Keep an open editor
    // as a stale draft, separate from the expired result and its actions.
    setResult((value) => (value && !value.saved ? null : value));
    setNotice("");
    setError("");
    setFetchError(false);
  }, [snapshot.status.phase, snapshot.status.importId, snapshot.status.startedAt]);

  useEffect(() => {
    if (!isDesktop || busy || actionPending.current) return;
    const version = ++request.current;
    let active = true;
    void backend
      .homeResult()
      .then((value) => {
        if (!active || version !== request.current) return;
        setResult(value);
        setFetchError(false);
      })
      .catch(() => {
        if (active && version === request.current) setFetchError(true);
      });
    return () => {
      active = false;
    };
  }, [snapshot.history, snapshot.latestResult, snapshot.status, busy, reload]);

  async function act(target: HomeResult, action: string, text = "") {
    if (actionPending.current || latestBusy.current || fetchError) return false;
    if (
      current.current?.session.id !== target.session.id ||
      current.current?.revision !== target.revision
    ) {
      setError(t("homeResultPanel.thisResultChangedYourDraftIsKept"));
      return false;
    }
    actionPending.current = true;
    request.current++;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await backend.homeResultAction(target.session.id, target.revision, action, text);
    } catch {
      setError(
        action === "edit"
          ? t("homeResultPanel.couldnTApplyThisEditYourDraft")
          : t("homeResultPanel.couldnTCompleteThisActionYourText"),
      );
      actionPending.current = false;
      setPending(false);
      setReload((value) => value + 1);
      return false;
    }
    if (action === "dismiss") {
      setResult(null);
      setFetchError(false);
      actionPending.current = false;
      setPending(false);
      fallbackFocus.current?.focus();
      return true;
    }
    // A committed save/edit is successful even when the subsequent refresh
    // fails. Disable further actions until the identity can be read again.
    setResult((value) =>
      value && action === "save"
        ? { ...value, saved: true, outcomes: { ...value.outcomes, history: "saved" } }
        : value,
    );
    setNotice(
      action.startsWith("copy")
        ? t("homeResultPanel.copiedToClipboardPasteManuallyWhenReady")
        : action === "edit"
          ? target.saved
            ? t("homeResultPanel.changesSavedToHistory")
            : t("homeResultPanel.changesKeptInMemorySaveToHistory")
          : t("homeResultPanel.savedToHistory"),
    );
    try {
      const value = await backend.homeResult();
      setResult(value);
      setFetchError(false);
      await refresh();
    } catch {
      setFetchError(true);
    } finally {
      actionPending.current = false;
      setPending(false);
      setReload((value) => value + 1);
    }
    return true;
  }

  if (!result && !fetchError && !editing)
    return notice ? (
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
    ) : null;
  const unavailable = busy || pending || fetchError;
  const warning = result ? recoveryWarning(result) : "";
  return (
    <section
      aria-label={
        result
          ? result.saved
            ? t("homeResultPanel.latestSavedResult")
            : t("homeResultPanel.temporaryLatestResult")
          : t("homeResultPanel.latestResult")
      }
      className="@container/home-result min-w-0 overflow-hidden rounded-xl border bg-card/60 [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-1"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-3 pt-5 @min-[28rem]/home-result:px-6">
        <div className="min-w-0">
          <h2 tabIndex={-1} className="text-sm font-semibold outline-none">
            {t("homeResultPanel.latestResult")}
          </h2>
          {result && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {result.saved
                ? t("homeResultPanel.savedInHistoryEditsPreserveOriginalRecognition")
                : t("homeResultPanel.temporaryKeptInMemoryUntilTheNext")}
            </p>
          )}
        </div>
        {result && (
          <div className="flex shrink-0 items-center gap-2">
            <InferenceStats session={result.session} outputs={result.outputs} />
            {result.saved && (
              <Link
                to={`/history/${encodeURIComponent(result.session.id)}`}
                className="text-xs leading-6 text-muted-foreground underline underline-offset-4"
              >
                {t("homeResultPanel.openInHistory")}
              </Link>
            )}
          </div>
        )}
      </header>
      {result && (
        <>
          <div className="space-y-4 px-3 py-4 @min-[28rem]/home-result:px-6">
            <p className="text-xs font-medium text-muted-foreground">
              {result.outputId
                ? t("homeResultPanel.generatedResult")
                : t("homeResultPanel.transcript")}
            </p>
            <p
              tabIndex={0}
              aria-label={t("homeResultPanel.resultText")}
              className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {result.text}
            </p>
            {warning && (
              <p role="alert" className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                {warning}
              </p>
            )}
            {!!result.outputs.length && (
              <details className="text-xs leading-6 text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">
                  {t("homeResultPanel.originalGeneratedOutputs")}
                  {result.outputs.length})
                </summary>
                {result.outputs.map((output) => (
                  <div key={output.id} className="mt-3 min-w-0 space-y-2 border-l pl-3">
                    <p className="break-words font-medium">
                      {output.chain?.step
                        ? t("homeResultPanel.step", { step: output.chain.step })
                        : ""}
                      {output.prompt.name}
                    </p>
                    <p
                      tabIndex={0}
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words"
                    >
                      {output.text}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unavailable}
                      onClick={() => void act(result, `copy:${output.id}`)}
                    >
                      {t("generatedOutputs.copyOutput")}
                    </Button>
                  </div>
                ))}
              </details>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-3 @min-[28rem]/home-result:px-6">
            <Button
              size="sm"
              variant="outline"
              disabled={unavailable}
              onClick={() => void act(result, "copy")}
            >
              <Copy aria-hidden="true" />
              {t("common.copy")}
            </Button>
            <Button
              ref={editTrigger}
              size="sm"
              variant="outline"
              disabled={unavailable}
              onClick={() => {
                setError("");
                setNotice("");
                setEditing(result);
              }}
            >
              <Pencil aria-hidden="true" />
              {t("homeResultPanel.editResult")}
            </Button>
            {!result.saved && (
              <Button size="sm" disabled={unavailable} onClick={() => void act(result, "save")}>
                {t("homeResultPanel.saveToHistory")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={unavailable}
              onClick={() => void act(result, "dismiss")}
            >
              {t("homeResultPanel.dismiss")}
            </Button>
            {pending && (
              <Loader2
                aria-label={t("homeResultPanel.resultActionInProgress")}
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            )}
            {busy && (
              <span className="text-xs text-muted-foreground">
                {t("homeResultPanel.availableAfterTheCurrentOperation")}
              </span>
            )}
          </footer>
        </>
      )}
      {notice && (
        <p
          role="status"
          className="px-3 pb-4 text-xs leading-5 text-muted-foreground @min-[28rem]/home-result:px-6"
        >
          {notice}
        </p>
      )}
      {error && !editing && (
        <p
          role="alert"
          className="px-3 pb-4 text-sm text-destructive @min-[28rem]/home-result:px-6"
        >
          {nativeText(error)}
        </p>
      )}
      {fetchError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 px-3 pb-4 text-sm @min-[28rem]/home-result:px-6"
        >
          {t("homeResultPanel.couldnTRefreshTheResultAnyCompleted")}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pending}
            onClick={() => setReload((value) => value + 1)}
          >
            {t("homeResultPanel.refreshResult")}
          </Button>
        </div>
      )}
      {editing && (
        <HomeResultEditor
          result={editing}
          busy={unavailable}
          pending={pending}
          readFailed={fetchError}
          onRefresh={() => setReload((value) => value + 1)}
          error={error}
          stale={!result || result.revision !== editing.revision}
          returnFocus={editTrigger}
          fallbackFocus={fallbackFocus}
          onCancel={() => {
            setEditing(null);
            setError("");
          }}
          onSubmit={async (text) => {
            if (await act(editing, "edit", text)) setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function HomeResultEditor({
  result,
  busy,
  pending,
  readFailed,
  onRefresh,
  error,
  stale,
  returnFocus,
  fallbackFocus,
  onCancel,
  onSubmit,
}: {
  result: HomeResult;
  busy: boolean;
  pending: boolean;
  readFailed: boolean;
  onRefresh: () => void;
  error: string;
  stale: boolean;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
  fallbackFocus: React.RefObject<HTMLHeadingElement | null>;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(result.text);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const invalid = !text.trim() || text.includes("\0") || Array.from(text).length > 100000;
  const describedBy =
    [
      stale || readFailed || busy ? "home-result-edit-state" : "",
      invalid ? "home-result-edit-validation" : "",
      error ? "home-result-edit-error" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={describedBy}
        initialFocus={input}
        finalFocus={() =>
          returnFocus.current?.isConnected && !returnFocus.current.disabled
            ? returnFocus.current
            : fallbackFocus.current
        }
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader className="text-left">
          <DialogTitle>{t("homeResultPanel.editResult")}</DialogTitle>
        </DialogHeader>
        <label htmlFor="home-result-draft" className="text-sm font-medium">
          {t("homeResultPanel.yourText")}
        </label>
        <textarea
          ref={input}
          id="home-result-draft"
          value={text}
          rows={7}
          disabled={pending}
          aria-describedby={describedBy}
          className="min-h-28 w-full shrink-0 resize-y rounded-lg border bg-card px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey) &&
              !event.nativeEvent.isComposing &&
              !composing.current &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              if (!busy && !invalid && !stale && text !== result.text) void onSubmit(text);
            }
          }}
        />
        {(stale || readFailed || busy) && (
          <p id="home-result-edit-state" className="text-xs leading-5 text-muted-foreground">
            {stale
              ? t("homeResultPanel.theResultChangedYourDraftIsKept")
              : readFailed
                ? t("homeResultPanel.couldNotRefreshYourDraftIsKept")
                : pending
                  ? t("homeResultPanel.applyingChanges")
                  : t("homeResultPanel.waitForTheCurrentOperationYourDraft")}
          </p>
        )}
        {readFailed && (
          <Button variant="outline" size="sm" disabled={pending} onClick={onRefresh}>
            {t("homeResultPanel.refreshResult")}
          </Button>
        )}
        {invalid && (
          <p id="home-result-edit-validation" role="alert" className="text-xs text-destructive">
            {t("homeResultPanel.enter1100000CharactersWithoutNull")}
          </p>
        )}
        {error && (
          <p id="home-result-edit-error" role="alert" className="text-sm text-destructive">
            {nativeText(error)}
          </p>
        )}
        <DialogFooter className="shrink-0">
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || invalid || stale || text === result.text}
            onClick={() => {
              if (!composing.current) void onSubmit(text);
            }}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {t("homeResultPanel.applyChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
