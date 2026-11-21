import { CopyButton } from "@/components/shared/copy-button";
import { MarkdownContent } from "@/components/shared/markdown-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatCitationContent } from "@/features/chat/components/chat-citation-content";
import { useChatVoice } from "@/features/chat/hooks/use-chat-voice";
import { referenceRanges, chatReplyText as replyText } from "@/features/chat/lib/chat-references";
import {
  useDictationPhase,
  useSavedConfiguration,
} from "@/features/dictation/hooks/use-dictation-state";
import { TranscriptDiff } from "@/features/transcripts/components/transcript-diff";
import { useSavedDraft } from "@/hooks/use-saved-draft";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  isBusy,
  isDesktop,
  message,
  type ChatMessage,
  type ChatReference,
  type ChatRequest,
  type GeneratedOutput,
  type Session,
  type SessionChat,
} from "@/lib/backend";
import { chatQuery, resourceKeys } from "@/lib/queries/resource-queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Events } from "@wailsio/runtime";
import {
  ArrowUp,
  Check,
  FilePenLine,
  Highlighter,
  Loader2,
  Mic,
  PanelRightClose,
  RotateCcw,
  Save,
  Square,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export type ChatSelection = { text: string; source: "transcript" | "original" };

function ChatAction({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" {...props} />}
        aria-label={label}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TranscriptionChat({
  session,
  open,
  editing,
  source,
  onSource,
  selection,
  onClearSelection,
  output,
  onClearOutput,
  onHighlight,
  onClose,
  onApplied,
}: {
  session: Session;
  open: boolean;
  editing: boolean;
  source: "transcript" | "original";
  onSource: (source: "transcript" | "original") => void;
  selection: ChatSelection | null;
  onClearSelection: () => void;
  output: GeneratedOutput | null;
  onClearOutput: () => void;
  onHighlight: (source: "transcript" | "original", references: ChatReference[]) => void;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = { ...useSavedConfiguration(), status: { phase: useDictationPhase() } };
  const queryClient = useQueryClient();
  const savedChat = useQuery(chatQuery(session.id));
  const chat: SessionChat = savedChat.data ?? {
    sessionId: session.id,
    messages: [],
    sources: [],
    summary: "",
    compactedThrough: 0,
  };
  const [draft, setDraft] = useSavedDraft(`chat:${session.id}`, "");
  const loading = savedChat.isPending;
  const loadError = savedChat.error ? message(savedChat.error) : "";
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [stream, setStream] = useState("");
  const [sendingText, setSendingText] = useState("");
  const [savingID, setSavingID] = useState("");
  const [savedIDs, setSavedIDs] = useState<Set<string>>(new Set());
  const [clearOpen, setClearOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [review, setReview] = useState<{
    message: ChatMessage;
    before: string;
    after: string;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const request = useRef<string | null>(null);
  const sourceEscape = useRef<Event | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const externalID = chat.messages.at(-1)?.state === "pending" ? chat.messages.at(-1)!.id : null;
  const externalRequest = useRef(externalID);
  externalRequest.current = externalID;
  const waiting = pending || !!externalID;
  const enabled = snapshot.textProcessing.enabled;
  const currentText = source === "original" ? session.rawTranscript : session.finalTranscript;
  const lastUser = chat.messages.filter((item) => item.role === "user").at(-1);
  const lastSource = chat.sources.find((item) => item.id === lastUser?.sourceId);
  const sourceChanged =
    !!lastSource && (lastSource.kind !== source || lastSource.text !== currentText);
  const invalidSelection =
    !!selection && (selection.source !== source || !currentText.includes(selection.text));
  const voice = useChatVoice(session.id, open, (text) => {
    setDraft((value) => (value.trim() ? `${value.trimEnd()} ${text}` : text));
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  });
  useEffect(() => {
    const field = input.current;
    if (!field || !open) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(160, Math.max(64, field.scrollHeight))}px`;
  }, [draft, open]);

  useEffect(() => {
    if (!open) {
      setSourceMenuOpen(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      root.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
      if (input.current?.disabled) root.current?.focus({ preventScroll: true });
      else input.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (request.current) void backend.cancelTextProcessing(request.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!isDesktop) return;
    const off = Events.On(
      "chat:progress",
      ({
        data,
      }: {
        data: { sessionId: string; requestId: string; content: string; compacting: boolean };
      }) => {
        if (
          data.sessionId !== session.id ||
          (data.requestId !== request.current && data.requestId !== externalRequest.current)
        )
          return;
        setStream(data.content);
        setCompacting(data.compacting);
      },
    );
    return () => off();
  }, [session.id]);
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [stream, chat.messages.length, sendingText]);
  useEffect(() => {
    if (selection || output) input.current?.focus();
  }, [selection, output]);

  async function refreshChat() {
    const filters = { queryKey: resourceKeys.chat(session.id) };
    // Mutations can settle after navigation or newer writes. Read current
    // persistence instead of caching an obsolete reply, including after errors.
    await queryClient.cancelQueries(filters);
    await queryClient.invalidateQueries(filters);
  }
  const sendMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ChatRequest }) =>
      backend.sendChat(id, session.id, payload),
    onSettled: refreshChat,
  });
  const saveMutation = useMutation({
    mutationFn: (id: string) => backend.saveChatReply(session.id, id),
  });
  const applyMutation = useMutation({
    mutationFn: ({ id, before }: { id: string; before: string }) =>
      backend.applyChatReply(session.id, id, before),
  });
  const clearMutation = useMutation({
    mutationFn: () => backend.clearChat(session.id),
    onSettled: refreshChat,
  });
  async function send(retry = false) {
    if (
      request.current ||
      voice.busy ||
      waiting ||
      loading ||
      loadError ||
      !enabled ||
      isBusy(snapshot.status.phase) ||
      (!retry && (!draft.trim() || invalidSelection))
    )
      return;
    const id = crypto.randomUUID();
    const payload: ChatRequest = {
      message: draft,
      source,
      selection: selection?.text ?? "",
      outputId: output?.id ?? "",
      retry,
    };
    request.current = id;
    follow.current = true;
    setPending(true);
    setStopping(false);
    setError("");
    setNotice("");
    setStream("");
    setSendingText(retry ? (lastUser?.content ?? "") : draft);
    try {
      await sendMutation.mutateAsync({ id, payload });
      if (!mounted.current) return;
      if (!retry) {
        setDraft("");
        onClearSelection();
        onClearOutput();
      }
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      request.current = null;
      if (mounted.current) {
        setPending(false);
        setStopping(false);
        setCompacting(false);
        setStream("");
        setSendingText("");
        input.current?.focus({ preventScroll: true });
      }
    }
  }
  async function stop() {
    const id = request.current ?? externalID;
    if (!id || stopping) return;
    setStopping(true);
    try {
      await backend.cancelTextProcessing(id);
    } catch (cause) {
      setError(message(cause));
      setStopping(false);
    }
  }
  function highlight(msg: ChatMessage, references = msg.references) {
    if (editing && references.length) {
      setNotice(t("chat.finishEditing"));
      return;
    }
    const version = chat.sources.find((item) => item.id === msg.sourceId);
    if (!version) return;
    const current = version.kind === "original" ? session.rawTranscript : session.finalTranscript;
    const valid = references.filter((ref) => referenceRanges(current, [ref]).length > 0);
    if (valid.length < references.length) setNotice(t("chat.passageChanged"));
    else setNotice("");
    if (valid.length) onHighlight(version.kind, valid);
  }
  async function save(msg: ChatMessage) {
    if (savingID) return;
    setSavingID(msg.id);
    setError("");
    try {
      await saveMutation.mutateAsync(msg.id);
      setSavedIDs((ids) => new Set([...ids, msg.id]));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSavingID("");
    }
  }
  function reviewReply(msg: ChatMessage) {
    if (editing) return;
    const replacement = replyText(msg.content);
    const selected = msg.selection;
    if (
      selected &&
      referenceRanges(session.finalTranscript, [{ number: 1, quote: selected }]).length !== 1
    ) {
      setNotice(t("chat.passageChanged"));
      return;
    }
    setError("");
    setReview({
      message: msg,
      before: session.finalTranscript,
      after: selected ? session.finalTranscript.replace(selected, replacement) : replacement,
    });
  }
  async function apply() {
    if (!review || applying || editing) return;
    setApplying(true);
    setError("");
    try {
      await applyMutation.mutateAsync({ id: review.message.id, before: review.before });
      setReview(null);
      setNotice(t("chat.applied"));
      onApplied();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setApplying(false);
    }
  }
  async function clear() {
    if (waiting || clearing) return;
    setClearing(true);
    setError("");
    try {
      await clearMutation.mutateAsync();
      setClearOpen(false);
      setNotice("");
      setSavedIDs(new Set());
      onHighlight(source, []);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setClearing(false);
    }
  }
  const canSend =
    isDesktop &&
    enabled &&
    !waiting &&
    !voice.busy &&
    !loading &&
    !loadError &&
    !isBusy(snapshot.status.phase) &&
    !!draft.trim() &&
    Array.from(draft).length <= 8000 &&
    !invalidSelection;
  const last = chat.messages.at(-1);

  return (
    <section
      ref={root}
      tabIndex={-1}
      id="transcription-chat"
      data-slot="chat-pane"
      hidden={!open}
      aria-label={t("chat.title")}
      className="flex h-[min(38rem,calc(100dvh-var(--recording-player-height,0px)-1.5rem))] min-h-0 min-w-0 scroll-mb-[var(--recording-player-height,0px)] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground lg:h-full"
      onKeyDown={(event) => {
        if (sourceEscape.current === event.nativeEvent) return;
        if (
          event.target instanceof Element &&
          event.target.closest('[data-slot="select-content"],[data-slot="dialog-content"]')
        )
          return;
        if (
          event.key === "Escape" &&
          !sourceMenuOpen &&
          !event.defaultPrevented &&
          !review &&
          !clearOpen
        ) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="flex min-h-10 shrink-0 items-center gap-1 border-b px-2 py-1">
        <Label htmlFor="chat-source" className="shrink-0 text-xs text-muted-foreground">
          {t("ux.chat.context")}
        </Label>
        <Select
          open={sourceMenuOpen}
          onOpenChange={(next, details) => {
            if (details.reason === "escape-key") {
              sourceEscape.current = details.event;
              details.event.preventDefault();
            }
            setSourceMenuOpen(next);
          }}
          items={[
            { value: "transcript", label: t("chat.savedTranscript") },
            { value: "original", label: t("historyEntryPage.originalTranscription") },
          ]}
          value={source}
          disabled={waiting || voice.busy}
          onValueChange={(value) => {
            if (value === "transcript" || value === "original") {
              onSource(value);
              onClearSelection();
            }
          }}
        >
          <SelectTrigger
            id="chat-source"
            aria-label={t("chat.source")}
            size="sm"
            className="min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs shadow-none dark:bg-transparent"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            <SelectItem value="transcript">{t("chat.savedTranscript")}</SelectItem>
            <SelectItem value="original">{t("historyEntryPage.originalTranscription")}</SelectItem>
          </SelectContent>
        </Select>
        <ChatAction
          label={t("chat.clear")}
          disabled={waiting || voice.busy || loading || !chat.messages.length}
          onClick={() => setClearOpen(true)}
        >
          <RotateCcw />
        </ChatAction>
        <ChatAction label={t("chat.close")} onClick={onClose}>
          <PanelRightClose />
        </ChatAction>
      </header>
      {(sourceChanged || chat.compactedThrough > 0) && (
        <div className="shrink-0 space-y-1 border-b px-3 py-2 text-[11px] text-muted-foreground">
          {sourceChanged && <p role="status">{t("chat.sourceUpdated")}</p>}
          {chat.compactedThrough > 0 && <p>{t("chat.compacted")}</p>}
        </div>
      )}
      <div
        ref={log}
        onScroll={() => {
          const node = log.current!;
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        }}
        role="log"
        aria-label={t("chat.conversation")}
        aria-live="off"
        className="min-h-12 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {loading && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("chat.loading")}
          </p>
        )}
        {loadError && (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>{nativeText(loadError)}</p>
            <Button size="xs" variant="outline" onClick={() => void savedChat.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {!loading && !loadError && !chat.messages.length && !pending && (
          <div className="space-y-3 py-2">
            <p className="text-xs leading-5 text-muted-foreground">{t("chat.empty")}</p>
            {!draft.trim() && (
              <div role="group" className="flex flex-wrap gap-2" aria-label={t("ux.chat.starters")}>
                {(["summary", "actions", "followUp"] as const).map((starter) => (
                  <Button
                    key={starter}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-9 max-w-full whitespace-normal text-left text-xs"
                    disabled={!enabled || waiting || voice.busy}
                    onClick={() => {
                      setDraft(t(`ux.chat.${starter}Message`));
                      input.current?.focus({ preventScroll: true });
                    }}
                  >
                    {t(`ux.chat.${starter}`)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {chat.messages.map((msg, index) => {
          const previous = index > 1 ? chat.messages[index - 2] : null;
          const refs = msg.references ?? [];
          return (
            <Fragment key={msg.id}>
              {msg.role === "user" && previous && previous.sourceId !== msg.sourceId && (
                <p className="border-t pt-2 text-[11px] text-muted-foreground">
                  {t("chat.sourceUpdated")}
                </p>
              )}
              <article
                aria-label={t(msg.role === "user" ? "chat.you" : "chat.assistant")}
                className={
                  msg.role === "user"
                    ? "ml-5 space-y-1.5 rounded-lg bg-muted/60 px-3 py-2"
                    : "space-y-1.5"
                }
              >
                {msg.selection && msg.role === "user" && (
                  <blockquote className="line-clamp-2 border-l-2 pl-2 text-xs text-muted-foreground">
                    {msg.selection}
                  </blockquote>
                )}
                {msg.outputText && (
                  <p className="text-[11px] text-muted-foreground">{t("chat.discussingOutput")}</p>
                )}
                {msg.content && (
                  <ChatCitationContent
                    text={msg.content}
                    references={refs}
                    onReference={(ref) => highlight(msg, [ref])}
                    className="text-sm leading-6"
                  />
                )}
                {msg.state === "complete" && msg.role === "assistant" && (
                  <div
                    data-slot="chat-reply-actions"
                    className="flex items-center gap-0.5 text-muted-foreground"
                  >
                    <CopyButton
                      iconOnly
                      variant="ghost"
                      text={replyText(msg.content)}
                      label={t("chat.copyReply")}
                    />
                    <ChatAction
                      label={t(savedIDs.has(msg.id) ? "chat.saved" : "chat.saveOutput")}
                      disabled={!!savingID || savedIDs.has(msg.id)}
                      onClick={() => void save(msg)}
                    >
                      {savingID === msg.id ? (
                        <Loader2 className="animate-spin motion-reduce:animate-none" />
                      ) : savedIDs.has(msg.id) ? (
                        <Check />
                      ) : (
                        <Save />
                      )}
                    </ChatAction>
                    {!!refs.length && (
                      <ChatAction
                        label={t("chat.highlightAll")}
                        disabled={editing}
                        onClick={() => highlight(msg)}
                      >
                        <Highlighter />
                      </ChatAction>
                    )}
                    <ChatAction
                      label={t("chat.reviewRewrite")}
                      disabled={waiting || voice.busy || editing}
                      onClick={() => reviewReply(msg)}
                    >
                      <FilePenLine />
                    </ChatAction>
                  </div>
                )}
                {(msg.state === "failed" || msg.state === "cancelled") && (
                  <p className="text-xs text-muted-foreground">
                    {msg.state === "cancelled"
                      ? t("chat.stopped")
                      : nativeText(msg.error ?? t("chat.failed"))}
                  </p>
                )}
              </article>
            </Fragment>
          );
        })}
        {pending && (
          <article className="space-y-3">
            <p className="ml-5 rounded-lg bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap break-words">
              {sendingText}
            </p>
            {stream && <MarkdownContent className="text-sm leading-6">{stream}</MarkdownContent>}
          </article>
        )}
        {waiting && (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              aria-hidden="true"
              className="size-3 animate-spin motion-reduce:animate-none"
            />
            {t(stopping ? "chat.stopping" : compacting ? "chat.compacting" : "chat.replying")}
          </p>
        )}
        {!pending && !!externalID && stream && <MarkdownContent>{stream}</MarkdownContent>}
        {!waiting && (last?.state === "failed" || last?.state === "cancelled") && (
          <Button
            size="xs"
            variant="outline"
            disabled={!enabled || voice.busy || isBusy(snapshot.status.phase)}
            onClick={() => void send(true)}
          >
            {t("chat.retry")}
          </Button>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t p-2">
        {editing && (
          <p className="px-1 text-[11px] text-muted-foreground">{t("chat.finishEditing")}</p>
        )}
        {!enabled && (
          <p className="px-1 text-xs text-muted-foreground">
            {t("chat.configure")}{" "}
            <Link to="/prompts" className="text-primary underline">
              {t("chat.openPrompts")}
            </Link>
          </p>
        )}
        {selection && (
          <div className="flex items-start gap-1 rounded-md bg-muted px-2 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t("chat.selection")}</p>
              <p className="line-clamp-2 break-words text-muted-foreground">{selection.text}</p>
            </div>
            <ChatAction
              label={t("chat.removeSelection")}
              disabled={waiting || voice.busy}
              onClick={onClearSelection}
            >
              <X />
            </ChatAction>
          </div>
        )}
        {invalidSelection && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {t("chat.selectionChanged")}
          </p>
        )}
        {output && (
          <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {t("chat.discussingOutput")}: {output.prompt.name}
            </span>
            <ChatAction
              label={t("chat.removeOutput")}
              disabled={waiting || voice.busy}
              onClick={onClearOutput}
            >
              <X />
            </ChatAction>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="overflow-hidden rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/40"
        >
          <Label htmlFor="chat-message" className="sr-only">
            {t("chat.message")}
          </Label>
          <Textarea
            ref={input}
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={waiting || !enabled || !!loadError}
            placeholder={t("chat.placeholder")}
            className="min-h-16 max-h-40 resize-none rounded-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) void send();
              }
            }}
          />
          <div className="flex min-h-10 items-center gap-1 px-1.5 pb-1.5">
            <ChatAction
              label={t(voice.phase === "recording" ? "chat.voiceStop" : "chat.voiceRecord")}
              aria-pressed={voice.phase === "recording"}
              disabled={
                !isDesktop ||
                !enabled ||
                waiting ||
                loading ||
                !!loadError ||
                voice.phase === "starting" ||
                voice.phase === "transcribing" ||
                (!voice.busy && isBusy(snapshot.status.phase))
              }
              onClick={() => void (voice.phase === "recording" ? voice.stop() : voice.start())}
            >
              {voice.phase === "starting" || voice.phase === "transcribing" ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : voice.phase === "recording" ? (
                <Square className="text-destructive" />
              ) : (
                <Mic />
              )}
            </ChatAction>
            {voice.busy && (
              <>
                <p
                  role="status"
                  className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                >
                  {t(
                    voice.phase === "recording" ? "chat.voiceListening" : "chat.voiceTranscribing",
                  )}
                </p>
                <ChatAction label={t("chat.voiceCancel")} onClick={() => void voice.cancel()}>
                  <X />
                </ChatAction>
              </>
            )}
            <div className="ml-auto">
              {waiting ? (
                <ChatAction label={t("chat.stop")} disabled={stopping} onClick={() => void stop()}>
                  <Square />
                </ChatAction>
              ) : (
                <ChatAction
                  label={t("chat.send")}
                  type="submit"
                  variant="default"
                  disabled={!canSend}
                >
                  <ArrowUp />
                </ChatAction>
              )}
            </div>
          </div>
        </form>
        {Array.from(draft).length > 8000 && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {t("chat.messageLimit")}
          </p>
        )}
        {(error || voice.error) && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {nativeText(error || voice.error)}
          </p>
        )}
        {notice && (
          <p role="status" className="px-1 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
      {clearOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !clearing) setClearOpen(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("chat.clear")}</DialogTitle>
              <DialogDescription>{t("chat.clearDescription")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={clearing} onClick={() => setClearOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button disabled={clearing} onClick={() => void clear()}>
                {t("chat.clear")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {review && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !applying) setReview(null);
          }}
        >
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("chat.reviewRewrite")}</DialogTitle>
              <DialogDescription>
                {t(
                  review.message.selection
                    ? "chat.reviewSelectionDescription"
                    : "chat.reviewDescription",
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[55dvh] overflow-y-auto">
              <TranscriptDiff before={review.before} after={review.after} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {nativeText(error)}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={applying} onClick={() => setReview(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={applying || editing || session.finalTranscript !== review.before}
                onClick={() => void apply()}
              >
                {t("chat.apply")}
              </Button>
            </DialogFooter>
            {session.finalTranscript !== review.before && (
              <p role="alert" className="text-xs text-destructive">
                {t("chat.reviewChanged")}
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
