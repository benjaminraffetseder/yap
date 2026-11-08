import { useDictation } from "@/components/dictation-provider";
import { InferenceStats } from "@/components/inference-stats";
import { MarkdownContent } from "@/components/markdown-content";
import { TranscriptContextMenu } from "@/components/transcript-context-menu";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy, isDesktop, type HomeResult } from "@/lib/backend";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { Check, Copy, Loader2, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  onPresenceChange,
  embedded = false,
}: {
  fallbackFocus: React.RefObject<HTMLElement | null>;
  onPresenceChange?: (present: boolean) => void;
  embedded?: boolean;
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
  const [view, setView] = useState("result");
  const visibleView = view === "outputs" && result?.outputs.length ? "outputs" : "result";
  const request = useRef(0);
  const actionPending = useRef(false);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const current = useRef(result);
  const busy = loading || isBusy(snapshot.status.phase);
  const latestBusy = useRef(busy);
  const present = !!(result || fetchError || editing);
  useEffect(() => onPresenceChange?.(present), [present, onPresenceChange]);
  useEffect(() => setView("result"), [result?.session.id]);
  useEffect(() => {
    const showResult = () => setView("result");
    window.addEventListener("yap:show-result", showResult);
    return () => window.removeEventListener("yap:show-result", showResult);
  }, []);
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

  function closeEditor() {
    setEditing(null);
    setError("");
    requestAnimationFrame(() => {
      const trigger = editTrigger.current;
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
      else fallbackFocus.current?.focus();
    });
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
      data-slot="home-result-panel"
      data-home-document={!!(result || editing) || undefined}
      aria-label={
        result
          ? result.saved
            ? t("homeResultPanel.latestSavedResult")
            : t("homeResultPanel.temporaryLatestResult")
          : t("homeResultPanel.latestResult")
      }
      className={`@container/home-result flex flex-col overflow-clip ${embedded ? "rounded-b-2xl bg-transparent" : "rounded-2xl border bg-card"} [overflow-wrap:anywhere] [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-9 [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal @max-[20rem]/home-result:[&_[data-slot=button]]:min-h-[44px] ${result || editing ? "min-h-min flex-1" : "shrink-0"}`}
    >
      {!editing && (
        <header
          data-slot="home-result-header"
          className={`flex shrink-0 flex-wrap items-start justify-between gap-2 px-5 py-3 @max-[20rem]/home-result:gap-[8px] @max-[20rem]/home-result:px-[16px] @max-[20rem]/home-result:py-[12px] @max-[12rem]/home-result:gap-[6px] @max-[12rem]/home-result:py-[8px] @max-[280px]/home-result:grid @max-[280px]/home-result:grid-cols-1 sm:px-7 ${embedded ? "home-reading-inset" : ""}`}
        >
          <div className="flex min-w-0 flex-[1_1_14rem] flex-wrap items-baseline gap-x-3 gap-y-1 @max-[20rem]/home-result:flex-[1_1_6rem] @max-[20rem]/home-result:gap-x-[12px] @max-[12rem]/home-result:flex-[1_1_0] @max-[12rem]/home-result:gap-y-[4px]">
            <h2
              tabIndex={-1}
              className="max-w-full text-lg font-semibold tracking-tight outline-none @min-[28rem]/home-result:text-xl @max-[12rem]/home-result:text-base"
            >
              {result?.session.title || (
                <>
                  <span className="@max-[12rem]/home-result:sr-only">
                    {t("homeResultPanel.latestResult")}
                  </span>
                  <span aria-hidden="true" className="hidden @max-[12rem]/home-result:inline">
                    {t("historyEntryPage.result")}
                  </span>
                </>
              )}
            </h2>
            {result && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
                {result.saved ? (
                  <Link
                    to={`/history/${encodeURIComponent(result.session.id)}`}
                    aria-description={t("homeResultPanel.openInHistory")}
                    aria-label={t("uiPolish.savedInHistory")}
                    title={t("homeResultPanel.openInHistory")}
                    className="rounded underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="@max-[12rem]/home-result:sr-only">
                      {t("uiPolish.savedInHistory")}
                    </span>
                    <span className="hidden items-center gap-1 @max-[12rem]/home-result:inline-flex">
                      <Check aria-hidden="true" className="size-3.5" />
                      {t("common.history")}
                    </span>
                  </Link>
                ) : (
                  <span>{t("homeResultPanel.temporaryKeptInMemoryUntilTheNext")}</span>
                )}
                {visibleView === "result" && (
                  <span className="sr-only @min-[40rem]/home-result:not-sr-only">
                    {t("uiPolish.homeWordCount", {
                      count: result.text.trim() ? result.text.trim().split(/\s+/u).length : 0,
                    })}
                  </span>
                )}
                <InferenceStats session={result.session} outputs={result.outputs} />
              </div>
            )}
          </div>
          {result && (
            <div
              data-slot="home-result-actions"
              className="flex max-w-full flex-wrap items-center gap-[6px]"
            >
              {visibleView === "result" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    title={t("common.copy")}
                    className="@max-[20rem]/home-result:w-[44px] @max-[20rem]/home-result:min-w-[44px] @max-[20rem]/home-result:px-0"
                    disabled={unavailable}
                    onClick={() => void act(result, "copy")}
                  >
                    <Copy aria-hidden="true" />
                    <span className="@max-[20rem]/home-result:sr-only">{t("common.copy")}</span>
                  </Button>
                  <Button
                    ref={editTrigger}
                    size="sm"
                    variant="ghost"
                    title={t("homeResultPanel.editResult")}
                    className="@max-[20rem]/home-result:w-[44px] @max-[20rem]/home-result:min-w-[44px] @max-[20rem]/home-result:px-0"
                    disabled={unavailable}
                    onClick={() => {
                      setError("");
                      setNotice("");
                      setEditing(result);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    <span className="@max-[20rem]/home-result:sr-only">
                      {t("homeResultPanel.editResult")}
                    </span>
                  </Button>
                </>
              )}
              {!result.saved && (
                <Button size="sm" disabled={unavailable} onClick={() => void act(result, "save")}>
                  {t("homeResultPanel.saveToHistory")}
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("homeResultPanel.dismiss")}
                title={t("homeResultPanel.dismiss")}
                className="@max-[20rem]/home-result:size-[44px]"
                disabled={unavailable}
                onClick={() => void act(result, "dismiss")}
              >
                <X aria-hidden="true" className="size-4" />
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
            </div>
          )}
        </header>
      )}
      {warning && !editing && (
        <p
          role="alert"
          className="mx-5 mb-4 shrink-0 text-xs leading-5 text-amber-700 sm:mx-7 dark:text-amber-400"
        >
          {warning}
        </p>
      )}
      {result && !editing && (
        <Tabs
          value={visibleView}
          onValueChange={(value) => setView(String(value))}
          className="min-h-min flex-1 gap-0"
        >
          <div
            data-slot="home-result-picker"
            className="sticky top-0 z-20 hidden shrink-0 border-b bg-card px-4 py-1 @max-[12rem]/home-result:block @max-[12rem]/home-result:px-[16px]"
          >
            {result.outputs.length ? (
              <Select
                items={[
                  {
                    value: "result",
                    label: result.outputId
                      ? t("homeResultPanel.generatedResult")
                      : t("homeResultPanel.transcript"),
                  },
                  {
                    value: "outputs",
                    label: `${t("uiPolish.homeOriginalOutputs")} (${result.outputs.length})`,
                  },
                ]}
                value={visibleView}
                onValueChange={(value) => {
                  if (value) setView(value);
                }}
              >
                <SelectTrigger
                  aria-label={t("uiPolish.homeResultViews")}
                  className="min-h-[44px] w-full py-[8px] data-[size=default]:h-auto @max-[280px]/home-result:gap-[8px] @max-[280px]/home-result:px-[8px] @max-[280px]/home-result:[&_svg]:size-[20px]"
                >
                  <SelectValue
                    className="min-w-0"
                    style={{ display: "block", whiteSpace: "normal" }}
                  >
                    {visibleView === "outputs" ? (
                      <>
                        {t("uiPolish.homeOriginalOutputs")}
                        <span className="sr-only"> ({result.outputs.length})</span>
                      </>
                    ) : result.outputId ? (
                      t("homeResultPanel.generatedResult")
                    ) : (
                      t("homeResultPanel.transcript")
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  align="start"
                  style={{
                    width: "max-content",
                    minWidth: "var(--anchor-width)",
                    maxWidth: "calc(100vw - 2rem)",
                  }}
                >
                  <SelectItem
                    value="result"
                    className="[&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:whitespace-normal [&>:first-child]:[overflow-wrap:anywhere]"
                  >
                    {result.outputId
                      ? t("homeResultPanel.generatedResult")
                      : t("homeResultPanel.transcript")}
                  </SelectItem>
                  <SelectItem
                    value="outputs"
                    className="[&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:whitespace-normal [&>:first-child]:[overflow-wrap:anywhere]"
                  >
                    {t("uiPolish.homeOriginalOutputs")} ({result.outputs.length})
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="flex min-h-9 items-center text-sm font-medium">
                {result.outputId
                  ? t("homeResultPanel.generatedResult")
                  : t("homeResultPanel.transcript")}
              </p>
            )}
          </div>
          <TabsList
            variant="line"
            aria-label={t("uiPolish.homeResultViews")}
            className="sticky top-0 z-20 grid w-full shrink-0 grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] justify-start gap-1 border-b bg-card px-5 group-data-[orientation=horizontal]/tabs:h-auto @max-[12rem]/home-result:hidden @max-[20rem]/home-result:px-4 @min-[28rem]/home-result:flex @min-[28rem]/home-result:gap-3 sm:px-7"
          >
            <TabsTrigger
              value="result"
              className="h-auto min-h-10 min-w-0 whitespace-normal text-left @max-[20rem]/home-result:min-h-[48px] @min-[28rem]/home-result:flex-none"
            >
              {result.outputId
                ? t("homeResultPanel.generatedResult")
                : t("homeResultPanel.transcript")}
            </TabsTrigger>
            {!!result.outputs.length && (
              <TabsTrigger
                value="outputs"
                className="h-auto min-h-10 min-w-0 whitespace-normal text-left @max-[20rem]/home-result:min-h-[48px] @min-[28rem]/home-result:flex-none"
              >
                {t("uiPolish.homeOriginalOutputs")}{" "}
                <span className="ml-1 font-normal text-muted-foreground">
                  {result.outputs.length}
                </span>
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent
            value="result"
            className="box-content min-h-[3.5rem] flex-1 scroll-mt-24 overflow-y-auto px-5 py-4 [contain:size] @max-[20rem]/home-result:px-4 @max-[20rem]/home-result:py-[12px] @max-[12rem]/home-result:px-[16px] sm:px-7"
          >
            <TranscriptContextMenu
              key={`${result.session.id}:${result.revision}`}
              text={result.text}
              returnFocus={reading}
              disabled={unavailable}
              onApply={!result.outputId ? (text) => act(result, "edit", text) : undefined}
            >
              <div
                id="home-result-text"
                ref={reading}
                tabIndex={0}
                aria-label={t("homeResultPanel.resultText")}
                className="max-w-[72ch] rounded-sm text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {result.outputId ? (
                  <MarkdownContent className="text-base leading-7">{result.text}</MarkdownContent>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{result.text}</p>
                )}
              </div>
            </TranscriptContextMenu>
          </TabsContent>
          <TabsContent
            value="outputs"
            className="box-content min-h-[3.5rem] flex-1 scroll-mt-24 space-y-7 overflow-y-auto px-5 py-4 [contain:size] @max-[20rem]/home-result:px-4 @max-[20rem]/home-result:py-[12px] @max-[12rem]/home-result:px-[16px] sm:px-7"
          >
            {result.outputs.map((output) => (
              <article
                key={output.id}
                aria-label={t("generatedOutputs.output", { name: output.prompt.name })}
                className="space-y-3"
              >
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">
                    {output.chain?.step
                      ? t("homeResultPanel.step", { step: output.chain.step })
                      : ""}
                    {output.prompt.name}
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={t("generatedOutputs.copyOutput")}
                    title={t("generatedOutputs.copyOutput")}
                    className="@max-[20rem]/home-result:w-[44px] @max-[20rem]/home-result:min-w-[44px] @max-[20rem]/home-result:px-0"
                    disabled={unavailable}
                    onClick={() => void act(result, `copy:${output.id}`)}
                  >
                    <Copy aria-hidden="true" />
                    <span className="@max-[20rem]/home-result:sr-only">
                      {t("generatedOutputs.copyOutput")}
                    </span>
                  </Button>
                </header>
                <MarkdownContent className="max-w-[72ch] text-base leading-7">
                  {output.text}
                </MarkdownContent>
              </article>
            ))}
            <p className="text-xs leading-5 text-muted-foreground">
              {t("uiPolish.homeOutputsPreserved")}
            </p>
          </TabsContent>
        </Tabs>
      )}
      {!editing && (notice || error || fetchError) && (
        <div className="shrink-0 space-y-2 border-t px-5 py-3 @max-[20rem]/home-result:py-[8px] sm:px-7">
          {notice && (
            <p role="status" className="text-xs leading-5 text-muted-foreground">
              {notice}
            </p>
          )}
          {error && !editing && (
            <p role="alert" className="text-sm text-destructive">
              {nativeText(error)}
            </p>
          )}
          {fetchError && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
              {t("homeResultPanel.couldnTRefreshTheResultAnyCompleted")}
              <Button
                variant="outline"
                size="sm"
                disabled={busy || pending}
                onClick={() => setReload((value) => value + 1)}
              >
                {t("homeResultPanel.refreshResult")}
              </Button>
              <Link
                to="/history"
                className="rounded underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("homeResultPanel.openHistory")}
              </Link>
            </div>
          )}
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
          onCancel={closeEditor}
          onSubmit={(text) => act(editing, "edit", text)}
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
  onCancel: () => void;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const baseline = useMemo(
    () => [result.session.id, result.revision, result.text] as const,
    [result.session.id, result.revision, result.text],
  );
  const [draft, setDraft, draftState] = useSavedDraft("home-result-edit", baseline);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const sameResult = draft[0] === result.session.id && draft[1] === result.revision;
  const text = sameResult ? draft[2] : result.text;
  // Keep the draft across navigation, but never reuse it for another result or revision.
  useEffect(() => {
    if (!sameResult) setDraft(baseline);
  }, [sameResult, baseline, setDraft]);
  function setText(value: string) {
    setDraft([result.session.id, result.revision, value]);
  }
  function cancel() {
    setDraft(baseline);
    onCancel();
  }
  async function submit() {
    if (await onSubmit(text)) {
      draftState.markSubmitted([result.session.id, result.revision, text]);
      onCancel();
    }
  }
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const invalid = !text.trim() || text.includes("\0") || Array.from(text).length > 100000;
  const describedBy =
    [
      "home-result-edit-scope",
      stale || readFailed || busy ? "home-result-edit-state" : "",
      invalid ? "home-result-edit-validation" : "",
      error ? "home-result-edit-error" : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <section
      aria-labelledby="home-result-editor-title"
      aria-describedby={describedBy}
      className="flex min-h-min flex-1 flex-col"
      onKeyDown={(event) => {
        if (
          correctionOpen ||
          event.defaultPrevented ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        if (
          event.key === "Escape" &&
          !pending &&
          !composing.current &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-5 py-3 sm:px-7">
        <div>
          <h2 id="home-result-editor-title" className="text-xl font-semibold tracking-tight">
            {t("homeResultPanel.editResult")}
          </h2>
          <p id="home-result-edit-scope" className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {t(
              result.saved ? "uiPolish.homeSavedEditorScope" : "uiPolish.homeTemporaryEditorScope",
            )}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={busy || invalid || stale || text === result.text}
            onClick={() => {
              if (!composing.current) void submit();
            }}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {t("homeResultPanel.applyChanges")}
          </Button>
        </div>
      </header>
      <div className="flex min-h-[8rem] flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 [contain:size] sm:px-7">
        <label htmlFor="home-result-draft" className="sr-only">
          {t("homeResultPanel.yourText")}
        </label>
        <TranscriptContextMenu
          text={text}
          returnFocus={input}
          disabled={busy || pending || stale || readFailed}
          onDialogOpenChange={setCorrectionOpen}
          onApply={(value) => {
            setText(value);
            return true;
          }}
        >
          <textarea
            ref={input}
            id="home-result-draft"
            value={text}
            rows={7}
            disabled={pending}
            aria-describedby={describedBy}
            className="min-h-[3.5rem] w-full max-w-[calc(72ch+2rem+2px)] flex-1 resize-none rounded-lg border bg-transparent px-4 py-3 text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            onChange={(event) => {
              setText(event.target.value);
            }}
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
                if (!busy && !invalid && !stale && text !== result.text) void submit();
              }
            }}
          />
        </TranscriptContextMenu>
        {(stale || readFailed || busy) && (
          <p
            id="home-result-edit-state"
            className="shrink-0 text-xs leading-5 text-muted-foreground"
          >
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
          <Button
            className="shrink-0 self-start"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onRefresh}
          >
            {t("homeResultPanel.refreshResult")}
          </Button>
        )}
        {invalid && (
          <p
            id="home-result-edit-validation"
            role="alert"
            className="shrink-0 text-xs text-destructive"
          >
            {t("homeResultPanel.enter1100000CharactersWithoutNull")}
          </p>
        )}
        {error && (
          <p id="home-result-edit-error" role="alert" className="shrink-0 text-sm text-destructive">
            {nativeText(error)}
          </p>
        )}
      </div>
    </section>
  );
}
