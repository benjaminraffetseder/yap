import { MarkdownContent } from "@/components/shared/markdown-content";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatSourceText } from "@/features/chat/components/chat-source-text";
import {
  useDictationActions,
  useDictationActivity,
  useDictationConnection,
} from "@/features/dictation/hooks/use-dictation-state";
import {
  ContentEditor,
  type ContentEditorHandle,
} from "@/features/transcripts/components/content-editor";
import { InferenceStats } from "@/features/transcripts/components/inference-stats";
import { TranscriptContextMenu } from "@/features/transcripts/components/transcript-context-menu";
import { useSavedDraft } from "@/hooks/use-saved-draft";
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy, isDesktop, type HomeResult } from "@/lib/backend";
import { hasOpenKeyboardOverlay } from "@/lib/keyboard-shortcuts";
import { homeResultQuery, resourceKeys } from "@/lib/queries/resource-queries";
import { isCancelledError, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, Copy, Loader2, Pencil, Save, X } from "lucide-react";
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

function copyText(result: HomeResult, action: string) {
  return action === "copy"
    ? result.text
    : result.outputs.find((output) => `copy:${output.id}` === action)?.text;
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
  const { refresh } = useDictationActions();
  const { loading } = useDictationConnection();
  const snapshot = { status: useDictationActivity() };
  const [editing, setEditing] = useState<HomeResult | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copiedReceipt, setCopiedReceipt] = useState<{ action: string; context: string } | null>(
    null,
  );
  const busy = loading || isBusy(snapshot.status.phase);
  const queryClient = useQueryClient();
  const home = useQuery({ ...homeResultQuery, enabled: isDesktop && !busy && !pending });
  const result = home.data ?? null;
  const fetchError = home.isError || refreshFailed;
  const command = useMutation({
    mutationFn: ({ target, action, text }: { target: HomeResult; action: string; text: string }) =>
      backend.homeResultAction(target.session.id, target.revision, action, text),
  });
  const [view, setView] = useState("result");
  const visibleView = view === "outputs" && result?.outputs.length ? "outputs" : "result";
  const actionPending = useRef(false);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const current = useRef(result);
  const latestBusy = useRef(busy);
  const copyRequest = useRef(0);
  // Copy itself advances the native revision. Keep confirmation only while its
  // text and visible context stay identical; validate the revision on reply.
  const copyContext = useMemo(
    () =>
      JSON.stringify([
        result?.session.id,
        result?.text,
        result?.outputs.map((output) => [output.id, output.text]),
        visibleView,
        !!editing,
        busy,
      ]),
    [result, visibleView, editing, busy],
  );
  const copiedAction = copiedReceipt?.context === copyContext ? copiedReceipt.action : "";
  const latestCopyContext = useRef(copyContext);
  const mounted = useRef(true);
  const copyShortcut = useRef({ enabled: false, copy: () => {} });
  copyShortcut.current = {
    enabled: !!result && !editing && visibleView === "result" && !busy && !pending && !fetchError,
    copy: () => {
      if (result) void act(result, "copy");
    },
  };
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        !copyShortcut.current.enabled ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        !event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "c" ||
        hasOpenKeyboardOverlay() ||
        window.getSelection()?.isCollapsed === false ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, [contenteditable="true"]'))
      )
        return;
      event.preventDefault();
      copyShortcut.current.copy();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const actionNotice = copiedAction
    ? t("homeResultPanel.copiedToClipboardPasteManuallyWhenReady")
    : notice;
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
    latestCopyContext.current = copyContext;
    copyRequest.current += 1;
    setCopiedReceipt(null);
  }, [copyContext]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      copyRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    const accepted =
      snapshot.status.phase === "recording" ||
      (!!snapshot.status.importId &&
        ["transcribing", "downloading"].includes(snapshot.status.phase));
    if (!accepted) return;
    // Status is emitted only after capture/import acceptance. Other busy phases
    // and rejected starts must not expire temporary text. Keep an open editor
    // as a stale draft, separate from the expired result and its actions.
    void queryClient.cancelQueries({ queryKey: resourceKeys.home });
    queryClient.setQueryData<HomeResult | null>(resourceKeys.home, (value) =>
      value && !value.saved ? null : value,
    );
    setNotice("");
    setError("");
    setRefreshFailed(false);
  }, [snapshot.status.phase, snapshot.status.importId, snapshot.status.startedAt, queryClient]);

  async function readResult() {
    setRefreshFailed(false);
    // Commands require a real native read, regardless of cached freshness.
    return queryClient.fetchQuery({ ...homeResultQuery, staleTime: 0 });
  }

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
    const request = ++copyRequest.current;
    const requestedContext = latestCopyContext.current;
    const requestedText = copyText(target, action);
    setCopiedReceipt(null);
    setPending(true);
    setError("");
    setNotice("");
    try {
      await queryClient.cancelQueries({ queryKey: resourceKeys.home });
      await command.mutateAsync({ target, action, text });
    } catch {
      setError(
        action === "edit"
          ? t("homeResultPanel.couldnTApplyThisEditYourDraft")
          : t("homeResultPanel.couldnTCompleteThisActionYourText"),
      );
      actionPending.current = false;
      void queryClient.invalidateQueries({ queryKey: resourceKeys.home });
      setPending(false);
      return false;
    }
    if (action === "dismiss") {
      // A replacement may have loaded after navigation while this reply waited.
      queryClient.setQueryData<HomeResult | null>(resourceKeys.home, (value) =>
        value?.session.id === target.session.id && value.revision === target.revision
          ? null
          : value,
      );
      setRefreshFailed(false);
      actionPending.current = false;
      setPending(false);
      fallbackFocus.current?.focus();
      return true;
    }
    // A committed save/edit is successful even when the subsequent refresh
    // fails. Disable further actions until the identity can be read again.
    queryClient.setQueryData<HomeResult | null>(resourceKeys.home, (value) =>
      value &&
      value.session.id === target.session.id &&
      value.revision === target.revision &&
      !latestBusy.current &&
      action === "save"
        ? { ...value, saved: true, outcomes: { ...value.outcomes, history: "saved" } }
        : value,
    );
    const confirmedCopy =
      action.startsWith("copy") &&
      mounted.current &&
      request === copyRequest.current &&
      requestedContext === latestCopyContext.current &&
      current.current?.session.id === target.session.id &&
      current.current?.revision === target.revision &&
      copyText(current.current, action) === requestedText;
    if (confirmedCopy) setCopiedReceipt({ action, context: requestedContext });
    setNotice(
      action.startsWith("copy")
        ? ""
        : action === "edit"
          ? target.saved
            ? t("homeResultPanel.changesSavedToHistory")
            : t("homeResultPanel.changesKeptInMemorySaveToHistory")
          : t("homeResultPanel.savedToHistory"),
    );
    try {
      if (!latestBusy.current) await readResult();
      setRefreshFailed(false);
      await refresh();
    } catch (cause) {
      if (!isCancelledError(cause)) setRefreshFailed(true);
    } finally {
      actionPending.current = false;
      setPending(false);
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
    return actionNotice ? (
      <p role="status" className="text-sm text-muted-foreground">
        {actionNotice}
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
      className={`@container/home-result flex flex-col overflow-clip ${embedded ? "rounded-b-2xl bg-transparent" : "rounded-2xl border bg-card"} [overflow-wrap:anywhere] ${result || editing ? "min-h-min flex-1" : "shrink-0"}`}
    >
      {!editing && (
        <header
          data-slot="home-result-header"
          className={`flex shrink-0 flex-wrap items-start justify-between gap-2 px-5 py-3 @max-[20rem]/home-result:gap-[8px] @max-[20rem]/home-result:px-[16px] @max-[20rem]/home-result:py-[12px] @max-[12rem]/home-result:gap-[6px] @max-[12rem]/home-result:py-[8px] @max-[280px]/home-result:grid @max-[280px]/home-result:grid-cols-1 sm:px-7 ${embedded ? "home-reading-inset" : ""}`}
        >
          <div className="flex min-w-0 flex-[1_1_14rem] flex-col items-start gap-x-3 gap-y-1 @max-[20rem]/home-result:flex-[1_1_6rem] @max-[20rem]/home-result:flex-row @max-[20rem]/home-result:flex-wrap @max-[20rem]/home-result:items-baseline @max-[20rem]/home-result:gap-x-[12px] @max-[12rem]/home-result:flex-[1_1_0] @max-[12rem]/home-result:gap-y-[4px]">
            <h2
              tabIndex={-1}
              className="max-w-full text-lg font-medium tracking-[-0.04em] outline-none @min-[28rem]/home-result:text-xl @max-[12rem]/home-result:text-base"
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
                    className="rounded underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
                {(result.outcomes.clipboard === "complete" ||
                  result.outcomes.paste === "requested") && (
                  <span
                    data-slot="home-result-receipt"
                    className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    {result.outcomes.clipboard === "complete" && (
                      <span className="inline-flex items-center gap-1">
                        <Check aria-hidden="true" className="size-3.5 shrink-0" />
                        {t("ux.home.clipboardComplete")}
                      </span>
                    )}
                    {result.outcomes.paste === "requested" && (
                      <span>{t("ux.home.pasteRequested")}</span>
                    )}
                  </span>
                )}
                {visibleView === "result" && (
                  <span className="sr-only @min-[28rem]/home-result:not-sr-only">
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
              className="flex max-w-full flex-wrap items-center gap-[6px] self-start"
            >
              {visibleView === "result" && (
                <>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    title={t(
                      copiedAction === "copy" ? "ux.home.copied" : "homeResultPanel.copyShortcut",
                    )}
                    aria-keyshortcuts="Control+Shift+C Meta+Shift+C"
                    className="@max-[20rem]/home-result:size-[44px]"
                    disabled={unavailable}
                    onClick={() => void act(result, "copy")}
                  >
                    {copiedAction === "copy" ? (
                      <Check aria-hidden="true" data-icon="inline-start" />
                    ) : (
                      <Copy aria-hidden="true" data-icon="inline-start" />
                    )}
                    <span className="sr-only">
                      {t(copiedAction === "copy" ? "ux.home.copied" : "common.copy")}
                    </span>
                  </Button>
                  <Button
                    ref={editTrigger}
                    size="icon-sm"
                    variant="ghost"
                    title={t("homeResultPanel.editResult")}
                    className="@max-[20rem]/home-result:size-[44px]"
                    disabled={unavailable}
                    onClick={() => {
                      setError("");
                      setNotice("");
                      setEditing(result);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    <span className="sr-only">{t("homeResultPanel.editResult")}</span>
                  </Button>
                </>
              )}
              {!result.saved && (
                <Button
                  size="icon-sm"
                  title={t("homeResultPanel.saveToHistory")}
                  className="@max-[20rem]/home-result:size-[44px]"
                  disabled={unavailable}
                  onClick={() => void act(result, "save")}
                >
                  <Save aria-hidden="true" />
                  <span className="sr-only">{t("homeResultPanel.saveToHistory")}</span>
                </Button>
              )}
              {result.saved && (
                <Link
                  data-slot="button"
                  to={`/history/${encodeURIComponent(result.session.id)}`}
                  title={t("ux.home.openTranscript")}
                  className={buttonVariants({
                    size: "icon-sm",
                    variant: "ghost",
                    className: "@max-[20rem]/home-result:size-[44px]",
                  })}
                >
                  <ArrowUpRight aria-hidden="true" data-icon="inline-start" />
                  <span className="sr-only">{t("ux.home.openTranscript")}</span>
                </Link>
              )}
              <Button
                size="icon-sm"
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
            className="box-content min-h-[7rem] flex-1 scroll-mt-24 overflow-y-auto px-5 py-4 [contain:size] @max-[20rem]/home-result:px-4 @max-[20rem]/home-result:py-[12px] @max-[12rem]/home-result:px-[16px] sm:px-7"
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
                  <ChatSourceText text={result.text} references={[]} />
                )}
              </div>
            </TranscriptContextMenu>
          </TabsContent>
          <TabsContent
            value="outputs"
            className="box-content min-h-[7rem] flex-1 scroll-mt-24 space-y-7 overflow-y-auto px-5 py-4 [contain:size] @max-[20rem]/home-result:px-4 @max-[20rem]/home-result:py-[12px] @max-[12rem]/home-result:px-[16px] sm:px-7"
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
                    size="icon-sm"
                    variant="outline"
                    aria-label={t(
                      copiedAction === `copy:${output.id}`
                        ? "ux.home.copied"
                        : "generatedOutputs.copyOutput",
                    )}
                    title={t(
                      copiedAction === `copy:${output.id}`
                        ? "ux.home.copied"
                        : "generatedOutputs.copyOutput",
                    )}
                    className="@max-[20rem]/home-result:size-[44px]"
                    disabled={unavailable}
                    onClick={() => void act(result, `copy:${output.id}`)}
                  >
                    {copiedAction === `copy:${output.id}` ? (
                      <Check aria-hidden="true" data-icon="inline-start" />
                    ) : (
                      <Copy aria-hidden="true" data-icon="inline-start" />
                    )}
                    <span className="sr-only">
                      {t(
                        copiedAction === `copy:${output.id}`
                          ? "ux.home.copied"
                          : "generatedOutputs.copyOutput",
                      )}
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
      {!editing && (actionNotice || error || fetchError) && (
        <div className="shrink-0 space-y-2 border-t px-5 py-3 @max-[20rem]/home-result:py-[8px] sm:px-7">
          {actionNotice && (
            <p role="status" className="text-xs leading-5 text-muted-foreground">
              {actionNotice}
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
                onClick={() => void readResult().catch(() => {})}
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
          onRefresh={() => void readResult().catch(() => {})}
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
    if (await draftState.entry.submit(() => onSubmit(text))) {
      onCancel();
    }
  }
  const input = useRef<ContentEditorHandle>(null);
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
          hasOpenKeyboardOverlay() ||
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
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
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
      <div className="flex min-h-[8rem] flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4 [contain:size] sm:px-7">
        <label htmlFor="home-result-draft" className="sr-only">
          {t("homeResultPanel.yourText")}
        </label>
        <div className="w-full max-w-[calc(72ch+2rem+2px)] text-base">
          <ContentEditor
            ref={input}
            id="home-result-draft"
            value={text}
            onChange={setText}
            disabled={pending || stale || readFailed}
            describedBy={describedBy}
            label={t("homeResultPanel.yourText")}
            onSave={() => {
              if (!composing.current && !busy && !invalid && !stale && text !== result.text)
                void submit();
            }}
            onClose={() => {
              if (!pending && !composing.current) cancel();
            }}
            autoFocus
          />
        </div>
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
