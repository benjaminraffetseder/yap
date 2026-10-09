import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ArrowLeft, AudioLines, Copy, Download, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <header className="space-y-2">
        <h1
          ref={title}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight outline-none"
        >
          Dictation
        </h1>
        {entry && (
          <p className="text-xs text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()} · {duration(entry.durationMs)} ·{" "}
            {entry.speechModel}
          </p>
        )}
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
        <>
          <div
            aria-busy={loading}
            className={`grid items-start gap-4 ${changed ? "lg:grid-cols-2" : ""}`}
          >
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
            {changed && (
              <TextPanel
                title="Original transcription"
                kind="source"
                description="From the recording"
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
            )}
          </div>
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
            <Button
              size="sm"
              variant="ghost"
              disabled={unavailable}
              className="ml-auto text-destructive"
              onClick={() => {
                setDeleteError("");
                setDeleting(true);
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
          {audio && <audio controls autoPlay src={audio} className="h-10 w-full" />}
          <GeneratedOutputs sessionID={id} unavailable={unavailable} />
        </>
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
