import { nativeText } from "@/i18n/native-text";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "@/components/audio-player";
import { useDictation } from "@/components/dictation-provider";
import { GeneratedOutputs } from "@/components/generated-outputs";
import { InferenceStats } from "@/components/inference-stats";
import { MarkdownContent } from "@/components/markdown-content";
import { TextPanel } from "@/components/text-panel";
import { TranscriptDiff } from "@/components/transcript-diff";
import { TranscriptEditor } from "@/components/transcript-editor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { backend, duration, isDesktop, message, type Session } from "@/lib/backend";
import { deleteTranscriptions } from "@/lib/delete-transcriptions";
import {
  ArrowLeft,
  AudioLines,
  Copy,
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
  return (
    <div className="space-y-3" style={audio ? { paddingBottom: playerHeight } : undefined}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
            <Link
              to={back}
              title={t("historyEntryPage.backToHistory")}
              className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span className="sr-only">{t("historyEntryPage.backToHistory")}</span>
            </Link>
            <div className="min-w-0">
              <h1
                ref={title}
                tabIndex={-1}
                className="text-xl font-semibold tracking-tight outline-none"
              >
                {t("historyEntryPage.dictation")}
              </h1>
              {entry && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
                  <span>{new Date(entry.createdAt).toLocaleString(i18n.resolvedLanguage)}</span>
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
                  {entry.audioPath && !audio && (
                    <Button
                      ref={playTrigger}
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={unavailable || loadingAudio}
                      onClick={() => void play()}
                    >
                      {loadingAudio ? (
                        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <AudioLines className="size-3" />
                      )}
                      {t("historyEntryPage.playRecording")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          {entry && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <InferenceStats session={entry} />
              <Button
                size="sm"
                variant="outline"
                aria-label={t("historyEntryPage.editTranscript")}
                disabled={unavailable}
                onClick={(event) => {
                  editTrigger.current = event.currentTarget;
                  setEditing(entry);
                }}
              >
                <Pencil className="size-3.5" />
                {t("common.edit")}
                <span className="hidden sm:inline"> {t("historyEntryPage.transcript")}</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={
                  changed
                    ? t("historyEntryPage.exportResult")
                    : t("historyEntryPage.exportTranscription")
                }
                disabled={unavailable}
                onClick={() => void run(() => backend.export(id), false)}
              >
                <Download className="size-3.5" />
                {t("historyEntryPage.export")}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("common.delete")}
                title={t("historyEntryPage.deleteDictation")}
                disabled={unavailable}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => void remove()}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
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
      {entry && (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(String(value))}
          className="min-w-0 gap-6"
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
              action={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unavailable}
                  onClick={() => void run(() => backend.copy(text), false)}
                >
                  <Copy className="size-3.5" />
                  {changed
                    ? t("historyEntryPage.copyResult")
                    : t("historyEntryPage.copyTranscription")}
                </Button>
              }
            >
              <MarkdownContent className="text-base leading-8">{text}</MarkdownContent>
            </TextPanel>
          </TabsContent>
          <TabsContent value="original" keepMounted>
            <TextPanel
              title={t("historyEntryPage.originalTranscription")}
              variant="reading"
              kind="source"
              description={t("historyEntryPage.fromTheRecordingReadOnly")}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unavailable}
                  onClick={() => void run(() => backend.copy(entry.rawTranscript), false)}
                >
                  <Copy className="size-3.5" />
                  {t("historyEntryPage.copyOriginal")}
                </Button>
              }
            >
              <MarkdownContent className="text-base leading-8">
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
        <TranscriptEditor
          session={editing}
          returnFocus={editTrigger}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setReload((old) => old + 1);
            void run(refresh, false);
          }}
        />
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
