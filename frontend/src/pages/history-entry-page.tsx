import { useDictation } from "@/components/dictation-provider";
import { GeneratedOutputs } from "@/components/generated-outputs";
import { MarkdownContent } from "@/components/markdown-content";
import { TextPanel } from "@/components/text-panel";
import { TranscriptDiff } from "@/components/transcript-diff";
import { TranscriptEditor } from "@/components/transcript-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { backend, duration, isDesktop, message, type Session } from "@/lib/backend";
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
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

export function HistoryEntryPage() {
  const { id = "" } = useParams();
  return <EntryDetail key={id} id={id} />;
}

function EntryDetail({ id }: { id: string }) {
  const { snapshot, loading: connecting, run, refresh } = useDictation();
  const navigate = useNavigate();
  const location = useLocation();
  const back = `/history${location.search}`;
  const [entry, setEntry] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isDesktop);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState("transcription");
  const editTrigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [audio, setAudio] = useState("");
  const [loadingAudio, setLoadingAudio] = useState(false);
  useEffect(() => {
    title.current?.focus();
  }, []);
  useEffect(() => {
    if (!isDesktop || connecting) return;
    let active = true;
    setLoading(true);
    setError("");
    void backend
      .session(id)
      .then((value) => {
        if (active) {
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
  async function remove() {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await backend.removeSessions([id]);
      await run(refresh, false);
      navigate(back, { replace: true });
    } catch (cause) {
      setDeleteError(message(cause));
      setReload((old) => old + 1);
      setDeletingNow(false);
    }
  }
  return (
    <div className="space-y-3">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
            <Link
              to={back}
              title="Back to History"
              className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span className="sr-only">Back to History</span>
            </Link>
            <div className="min-w-0">
              <h1
                ref={title}
                tabIndex={-1}
                className="text-xl font-semibold tracking-tight outline-none"
              >
                Dictation
              </h1>
              {entry && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
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
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={unavailable || loadingAudio}
                      onClick={() => void play()}
                    >
                      {loadingAudio ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <AudioLines className="size-3" />
                      )}
                      Play recording
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
          {entry && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                aria-label="Edit transcript"
                disabled={unavailable}
                onClick={(event) => {
                  editTrigger.current = event.currentTarget;
                  setEditing(entry);
                }}
              >
                <Pencil className="size-3.5" />
                Edit<span className="hidden sm:inline"> transcript</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={changed ? "Export result" : "Export transcription"}
                disabled={unavailable}
                onClick={() => void run(() => backend.export(id), false)}
              >
                <Download className="size-3.5" />
                Export
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete"
                title="Delete dictation"
                disabled={unavailable}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setDeleteError("");
                  setDeleting(true);
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
        {audio && <audio controls autoPlay src={audio} className="h-10 w-full" />}
      </header>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading dictation…
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {error}
          <Button size="sm" variant="outline" onClick={() => setReload((old) => old + 1)}>
            Retry
          </Button>
        </div>
      )}
      {!loading && !error && !entry && (
        <section className="space-y-2 rounded-xl border border-dashed p-6">
          <h2 className="text-sm font-semibold">Dictation not found</h2>
          <p className="text-sm text-muted-foreground">It may have been deleted from History.</p>
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
              aria-label="Dictation contents"
              className="group-data-[orientation=horizontal]/tabs:h-10"
            >
              <TabsTrigger
                value="transcription"
                className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
              >
                <FileText className="hidden size-4 sm:block" aria-hidden="true" />
                Transcription
              </TabsTrigger>
              <TabsTrigger
                value="original"
                className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
              >
                <AudioLines className="hidden size-4 sm:block" aria-hidden="true" />
                Original
              </TabsTrigger>
              <TabsTrigger
                value="outputs"
                className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
              >
                <Sparkles className="hidden size-4 sm:block" aria-hidden="true" />
                Outputs
              </TabsTrigger>
              {changed && (
                <TabsTrigger
                  value="changes"
                  className="px-2 text-xs data-active:text-primary after:bg-primary sm:px-3 sm:text-sm"
                >
                  <GitCompareArrows className="hidden size-4 sm:block" aria-hidden="true" />
                  Changes
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <TabsContent value="transcription" keepMounted>
            <TextPanel
              title={changed ? "Result" : "Transcription"}
              variant="reading"
              kind={changed ? "result" : "source"}
              description={`${text.trim().split(/\s+/).filter(Boolean).length} words · ${changed ? "Edited or processed text" : "Saved transcription"}`}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unavailable}
                  onClick={() => void run(() => backend.copy(text), false)}
                >
                  <Copy className="size-3.5" />
                  {changed ? "Copy result" : "Copy transcription"}
                </Button>
              }
            >
              <MarkdownContent className="text-base leading-8">{text}</MarkdownContent>
            </TextPanel>
          </TabsContent>
          <TabsContent value="original" keepMounted>
            <TextPanel
              title="Original transcription"
              variant="reading"
              kind="source"
              description="From the recording · Read only"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unavailable}
                  onClick={() => void run(() => backend.copy(entry.rawTranscript), false)}
                >
                  <Copy className="size-3.5" />
                  Copy original
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
                title="Changes"
                kind="result"
                variant="reading"
                description="Original recording → Current transcription · Text comparison"
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
            setEditing(null);
            setReload((old) => old + 1);
            void run(refresh, false);
          }}
        />
      )}
      <Dialog
        open={deleting}
        disablePointerDismissal
        onOpenChange={(value) => {
          if (!value && !deletingNow) setDeleting(false);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this dictation?</DialogTitle>
            <DialogDescription>
              The transcript and retained audio will be permanently removed from this device.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deletingNow} onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingNow} onClick={() => void remove()}>
              {deletingNow ? "Deleting…" : "Delete dictation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
