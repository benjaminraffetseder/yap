import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  AudioLines,
  CalendarDays,
  Clock3,
  Copy,
  Download,
  FileText,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TextPanel } from "@/components/text-panel";
import { TranscriptEditor } from "@/components/transcript-editor";
import { GeneratedOutputs } from "@/components/generated-outputs";
import { useDictation } from "@/components/dictation-provider";
import { backend, duration, isDesktop, message, type Session } from "@/lib/backend";

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
    <div className="space-y-6">
      <Link
        to={back}
        className="inline-flex items-center gap-2 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to History
      </Link>
      <header className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1
            ref={title}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight outline-none"
          >
            Dictation
          </h1>
          {entry && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={unavailable}
                onClick={(event) => {
                  editTrigger.current = event.currentTarget;
                  setEditing(entry);
                }}
              >
                <Pencil className="size-3.5" />
                Edit transcript
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={unavailable}
                onClick={() => void run(() => backend.export(id), false)}
              >
                <Download className="size-3.5" />
                {changed ? "Export result" : "Export transcription"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={unavailable}
                className="text-destructive"
                onClick={() => {
                  setDeleteError("");
                  setDeleting(true);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          )}
        </div>
        {entry && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {new Date(entry.createdAt).toLocaleString()}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock3 className="size-3.5" aria-hidden="true" />
              {duration(entry.durationMs)}
            </span>
            <span className="rounded-md border bg-card px-2 py-1 font-mono text-[11px]">
              {entry.speechModel}
            </span>
            {entry.audioPath && !audio && (
              <Button
                size="sm"
                variant="outline"
                disabled={unavailable || loadingAudio}
                onClick={() => void play()}
              >
                {loadingAudio ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <AudioLines className="size-3.5" />
                )}
                Play recording
              </Button>
            )}
          </div>
        )}
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
        <Tabs defaultValue="transcription" className="min-w-0 gap-6" aria-busy={loading}>
          <div className="sticky top-0 z-10 overflow-x-auto border-b bg-background pt-2 pb-1">
            <TabsList
              variant="line"
              aria-label="Dictation contents"
              className="group-data-[orientation=horizontal]/tabs:h-11"
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
            </TabsList>
          </div>
          <TabsContent value="transcription" keepMounted>
            <TextPanel
              title={changed ? "Result" : "Transcription"}
              kind={changed ? "result" : "source"}
              description={changed ? "Edited or processed text" : undefined}
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
              <p className="whitespace-pre-wrap break-words text-sm leading-7">{text}</p>
            </TextPanel>
          </TabsContent>
          <TabsContent value="original" keepMounted>
            <TextPanel
              title="Original transcription"
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
              <p className="whitespace-pre-wrap break-words text-sm leading-7">
                {entry.rawTranscript}
              </p>
            </TextPanel>
          </TabsContent>
          <TabsContent value="outputs" keepMounted>
            <GeneratedOutputs sessionID={id} unavailable={unavailable} />
          </TabsContent>
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
