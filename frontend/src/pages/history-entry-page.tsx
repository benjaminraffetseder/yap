import { nativeText } from "@/i18n/native-text";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/copy-button";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { AudioPlayer } from "@/components/audio-player";
import { useDictation } from "@/components/dictation-provider";
import { GeneratedOutputs } from "@/components/generated-outputs";
import { InferenceStats } from "@/components/inference-stats";
import { MarkdownContent } from "@/components/markdown-content";
import { TextPanel } from "@/components/text-panel";
import { TranscriptDiff } from "@/components/transcript-diff";
import { TranscriptEditor } from "@/components/transcript-editor";
import { SessionTitleAction } from "@/components/session-title-action";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { backend, duration, isDesktop, message, type Session } from "@/lib/backend";
import { deleteTranscriptions } from "@/lib/delete-transcriptions";
import {
  ArrowLeft,
  AudioLines,
  Download,
  FileText,
  GitCompareArrows,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

export function HistoryEntryPage() {
  const { id = "" } = useParams();
  return <EntryDetail key={id} id={id} />;
}

function EntryDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { snapshot, loading: connecting, run, refresh } = useDictation();
  const navigate = useNavigate();
  const location = useLocation();
  const back = `/history${location.search}`;
  const [entry, setEntry] = useState<Session | null>(null);
  const entryLoaded = useRef(false);
  const [loading, setLoading] = useState(isDesktop);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState("transcription");
  const editTrigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [audio, setAudio] = useState("");
  const [loadingAudio, setLoadingAudio] = useState(false);
  const playTrigger = useRef<HTMLButtonElement>(null);
  const playerDock = useRef<HTMLDivElement>(null);
  const [playerHeight, setPlayerHeight] = useState(0);
  useLayoutEffect(() => {
    if (!audio || !playerDock.current) return;
    const dock = playerDock.current;
    const measure = () => setPlayerHeight(Math.ceil(dock.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock, { box: "border-box" });
    return () => observer.disconnect();
  }, [audio]);
  useEffect(() => {
    title.current?.focus();
  }, []);
  useEffect(() => {
    if (!isDesktop || connecting) return;
    let active = true;
    if (!entryLoaded.current) setLoading(true);
    setError("");
    void backend
      .session(id)
      .then((value) => {
        if (active) {
          entryLoaded.current = !!value;
          setEntry(value);
          setLoading(false);
          if (!value) setAudio("");
        }
      })
      .catch((cause) => {
        if (active) {
          setError(message(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id, snapshot.history, connecting, reload]);
  const unavailable = !isDesktop || loading || !!error || deletingNow;
  const text = entry?.finalTranscript ?? entry?.rawTranscript ?? "";
  const changed = !!entry && text !== entry.rawTranscript;
  if (!changed && activeTab === "changes") setActiveTab("transcription");
  async function play() {
    setLoadingAudio(true);
    await run(async () => {
      setAudio(await backend.audio(id));
    }, false);
    setLoadingAudio(false);
  }
  function closeAudio() {
    setAudio("");
    requestAnimationFrame(() => {
      const trigger = playTrigger.current;
      if (trigger && !trigger.disabled) trigger.focus({ preventScroll: true });
      else title.current?.focus({ preventScroll: true });
    });
  }
  async function remove() {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await deleteTranscriptions([id], () => run(refresh, false));
      navigate(back, { replace: true });
      void run(refresh, false);
    } catch (cause) {
      setDeleteError(message(cause));
      setReload((old) => old + 1);
      setDeletingNow(false);
    }
  }
  const firstLine = (entry?.finalTranscript ?? entry?.rawTranscript ?? "")
    .trim()
    .split(/\r?\n/)[0]
    .replace(/\s+/g, " ");
  const titleCharacters = Array.from(firstLine);
  const titlePrefix = titleCharacters.slice(0, 60).join("");
  const sessionTitle =
    titleCharacters.length > 60
      ? `${(titlePrefix.replace(/\s+\S*$/, "").trimEnd() || titlePrefix).replace(/[\s,;:–—-]+$/, "")}…`
      : firstLine;
  return (
    <div className="space-y-4" style={audio ? { paddingBottom: playerHeight } : undefined}>
      <header className="group @container/detail">
        <div className="flex min-w-0 items-start gap-[12px]">
          <Link
            to={back}
            title={t("historyEntryPage.backToHistory")}
            className="mt-0.5 inline-flex size-[min(2rem,44px)] shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("historyEntryPage.backToHistory")}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <div
              className={
                entry && !editing
                  ? "grid items-start gap-x-3 gap-y-2 @min-[44rem]/detail:grid-cols-[minmax(0,1fr)_auto]"
                  : "min-w-0"
              }
            >
              <div
                data-slot="dictation-title"
                className="min-w-0 text-lg leading-7 text-balance break-words @min-[44rem]/detail:text-xl [&_[data-dictation-title-action]]:align-middle @max-[44rem]/detail:[&_[data-dictation-title-action]]:size-[44px]"
              >
                <h1
                  ref={title}
                  tabIndex={-1}
                  className="inline font-semibold tracking-tight outline-none"
                >
                  {entry?.title || sessionTitle || t("historyEntryPage.dictation")}
                </h1>
                {entry && !editing && (
                  <>
                    {" "}
                    <SessionTitleAction
                      contextual
                      entry={entry}
                      disabled={unavailable}
                      onSaved={(value) => {
                        setEntry((current) => (current ? { ...current, title: value } : current));
                        void run(refresh, false);
                      }}
                    />
                  </>
                )}
              </div>
              {entry && !editing && (
                <div
                  data-slot="detail-primary-actions"
                  className="flex max-w-full flex-wrap items-center gap-1.5 @min-[44rem]/detail:justify-end"
                >
                  {activeTab !== "outputs" && (
                    <CopyButton
                      compact
                      text={activeTab === "original" ? entry.rawTranscript : text}
                      label={
                        activeTab === "original"
                          ? t("historyEntryPage.copyOriginal")
                          : changed
                            ? t("historyEntryPage.copyResult")
                            : t("historyEntryPage.copyTranscription")
                      }
                      disabled={unavailable}
                    />
                  )}

                  <Button
                    ref={editTrigger}
                    size="sm"
                    variant="outline"
                    className="h-auto min-h-8 max-w-full whitespace-normal @max-[44rem]/detail:px-[8px]"
                    aria-label={
                      activeTab === "original"
                        ? t("uiPolish.editSavedTranscript")
                        : t("historyEntryPage.editTranscript")
                    }
                    aria-description={
                      activeTab === "original" ? t("uiPolish.originalPreserved") : undefined
                    }
                    disabled={unavailable}
                    onClick={() => setEditing(entry)}
                  >
                    <Pencil className="size-3.5" />
                    {activeTab === "original" ? (
                      t("uiPolish.editSavedTranscript")
                    ) : (
                      <>
                        <span className="sm:hidden">{t("common.edit")}</span>
                        <span className="hidden sm:inline">
                          {t("historyEntryPage.editTranscript")}
                        </span>
                      </>
                    )}
                  </Button>

                  <ActionMenu disabled={unavailable} label={t("uiPolish.dictationActions")}>
                    <ActionMenuItem
                      disabled={unavailable}
                      onClick={() => void run(() => backend.export(id), false)}
                    >
                      <Download aria-hidden="true" />
                      {t("historyEntryPage.export")}
                    </ActionMenuItem>
                    <ActionMenuItem
                      destructive
                      disabled={unavailable}
                      onClick={() => void remove()}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("historyEntryPage.deleteDictation")}
                    </ActionMenuItem>
                  </ActionMenu>
                </div>
              )}
            </div>
            {entry && (
              <div
                data-slot="detail-metadata"
                className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
              >
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString(i18n.resolvedLanguage, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
                <span aria-hidden="true" className="text-border">
                  ·
                </span>
                <span>{duration(entry.durationMs)}</span>
                <span aria-hidden="true" className="text-border">
                  ·
                </span>
                <span className="max-w-48 truncate" title={entry.speechModel}>
                  {entry.speechModel}
                </span>

                {!editing && (
                  <>
                    <InferenceStats session={entry} />
                    {entry.audioPath && !audio && (
                      <Button
                        ref={playTrigger}
                        size="sm"
                        variant="ghost"
                        className="h-auto min-h-7 max-w-full px-1 text-left text-xs font-normal whitespace-normal text-muted-foreground hover:text-foreground"
                        disabled={unavailable || loadingAudio}
                        onClick={() => void play()}
                      >
                        {loadingAudio ? (
                          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <AudioLines className="size-3.5" />
                        )}
                        {t("historyEntryPage.playRecording")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {deleteError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteError}
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("historyEntryPage.loadingDictation")}
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {nativeText(error)}
          <Button size="sm" variant="outline" onClick={() => setReload((old) => old + 1)}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {!loading && !error && !entry && (
        <section className="space-y-2 rounded-xl border border-dashed p-6">
          <h2 className="text-sm font-semibold">{t("historyEntryPage.dictationNotFound")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("historyEntryPage.itMayHaveBeenDeletedFromHistory")}
          </p>
        </section>
      )}
      {/* Keep output requests mounted while the inline editor is open. */}
      {entry && (
        <Tabs
          hidden={!!editing}
          value={activeTab}
          onValueChange={(value) => setActiveTab(String(value))}
          className="min-w-0 gap-4 sm:pl-11"
          aria-busy={loading}
        >
          <div className="sticky top-0 z-10 overflow-x-auto border-b bg-background pb-1">
            <TabsList
              variant="line"
              aria-label={t("historyEntryPage.dictationContents")}
              className="group-data-[orientation=horizontal]/tabs:h-10"
            >
              <TabsTrigger
                value="transcription"
                className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
              >
                <FileText className="hidden size-4 sm:block" aria-hidden="true" />
                {t("historyEntryPage.transcription")}
              </TabsTrigger>
              <TabsTrigger
                value="original"
                className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
              >
                <AudioLines className="hidden size-4 sm:block" aria-hidden="true" />
                {t("historyEntryPage.original")}
              </TabsTrigger>
              <TabsTrigger
                value="outputs"
                className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
              >
                <Sparkles className="hidden size-4 sm:block" aria-hidden="true" />
                {t("historyEntryPage.outputs")}
              </TabsTrigger>
              {changed && (
                <TabsTrigger
                  value="changes"
                  className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
                >
                  <GitCompareArrows className="hidden size-4 sm:block" aria-hidden="true" />
                  {t("historyEntryPage.changes")}
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <TabsContent value="transcription" keepMounted>
            <TextPanel
              title={changed ? t("historyEntryPage.result") : t("historyEntryPage.transcription")}
              variant="reading"
              kind={changed ? "result" : "source"}
              description={t("historyEntryPage.wordCount", {
                count: text.trim().split(/\s+/).filter(Boolean).length,
                type: changed
                  ? t("historyEntryPage.editedOrProcessedText")
                  : t("historyEntryPage.savedTranscription"),
              })}
            >
              <MarkdownContent className="text-base leading-7">{text}</MarkdownContent>
            </TextPanel>
          </TabsContent>
          <TabsContent value="original" keepMounted>
            <TextPanel
              title={t("historyEntryPage.originalTranscription")}
              variant="reading"
              kind="source"
              description={t("historyEntryPage.fromTheRecordingReadOnly")}
            >
              <MarkdownContent className="text-base leading-7">
                {entry.rawTranscript}
              </MarkdownContent>
            </TextPanel>
          </TabsContent>
          <TabsContent value="outputs" keepMounted>
            <GeneratedOutputs sessionID={id} unavailable={unavailable} />
          </TabsContent>
          {changed && (
            <TabsContent value="changes" keepMounted>
              <TextPanel
                title={t("historyEntryPage.changes")}
                kind="result"
                variant="reading"
                description={t(
                  "historyEntryPage.originalRecordingCurrentTranscriptionTextComparison",
                )}
              >
                <TranscriptDiff before={entry.rawTranscript} after={text} />
              </TextPanel>
            </TabsContent>
          )}
        </Tabs>
      )}
      {editing && (
        <div className="min-w-0 sm:pl-11">
          <TranscriptEditor
            session={editing}
            returnFocus={editTrigger}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setReload((old) => old + 1);
              void run(refresh, false);
            }}
          />
        </div>
      )}
      {audio && (
        <div
          ref={playerDock}
          data-slot="recording-player-dock"
          className="pointer-events-none fixed right-0 bottom-0 left-[var(--sidebar-width,0px)] z-30 pb-[max(1rem,env(safe-area-inset-bottom))] group-has-[[data-slot=import-queue-fab]]/layout:pb-24"
        >
          <div className="mx-auto max-w-5xl px-3 sm:px-10 lg:px-20">
            <AudioPlayer
              src={audio}
              durationMs={entry?.durationMs}
              autoPlay
              onClose={closeAudio}
              className="pointer-events-auto bg-card shadow-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}
