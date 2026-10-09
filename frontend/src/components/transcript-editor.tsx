import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router";
import { TranscriptProcessor } from "@/components/transcript-processor";
import { TextPanel } from "@/components/text-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy, isDesktop, message, type Session } from "@/lib/backend";

export function TranscriptEditor({
  session,
  returnFocus,
  onClose,
  onSaved,
}: {
  session: Session;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = session.finalTranscript ?? session.rawTranscript;
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const { snapshot } = useDictation();
  const busy = isBusy(snapshot.status.phase);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (term === null && !processing) input.current?.focus();
  }, [term, processing]);
  const dirty = text !== initial;
  const canSave = dirty && !!text.trim() && !saving;
  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await backend.saveTranscript(session.id, text);
      onSaved();
    } catch (cause) {
      setError(message(cause));
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !saving && !adding) {
          if (processing) setProcessing(false);
          else if (term !== null) setTerm(null);
          else onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={input}
        finalFocus={returnFocus}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl"
      >
        {processing ? (
          <TranscriptProcessor
            input={text}
            onCancel={() => setProcessing(false)}
            onUse={(result) => {
              setText(result);
              setSelection("");
              setProcessing(false);
              setNotice("Result applied to draft. Save to update History.");
            }}
          />
        ) : term !== null ? (
          <VocabularyTermForm
            selected={term}
            busy={busy}
            onBusy={setAdding}
            onCancel={() => setTerm(null)}
            onSaved={() => {
              setTerm(null);
              setNotice("Added to vocabulary");
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Edit transcript</DialogTitle>
              <DialogDescription>
                Changes update the saved text. The original transcription is preserved.
              </DialogDescription>
            </DialogHeader>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <TextPanel title="Editable text" kind="result">
                <Label htmlFor="transcript-editor" className="sr-only">
                  Editable text
                </Label>
                <textarea
                  ref={input}
                  id="transcript-editor"
                  value={text}
                  disabled={saving}
                  maxLength={100000}
                  rows={9}
                  aria-invalid={!!error}
                  aria-describedby={error ? "transcript-save-error" : undefined}
                  className="min-h-40 max-h-[45vh] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-7 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                  onChange={(event) => {
                    setText(event.target.value);
                    setSelection("");
                  }}
                  onSelect={(event) => {
                    const field = event.currentTarget;
                    const selected = field.value
                      .slice(field.selectionStart, field.selectionEnd)
                      .trim();
                    // eslint-disable-next-line no-control-regex -- reject control characters in vocabulary selections
                    setSelection(
                      selected &&
                        Array.from(selected).length <= 80 &&
                        !/[\u0000-\u001f\u007f-\u009f]/.test(selected)
                        ? selected
                        : "",
                    );
                  }}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault();
                      void save();
                    }
                  }}
                />
              </TextPanel>
              <TextPanel
                title="Original transcription"
                kind="source"
                description="From the recording · read only"
              >
                <p className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7">
                  {session.rawTranscript}
                </p>
              </TextPanel>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={
                  !isDesktop ||
                  saving ||
                  busy ||
                  !text.trim() ||
                  !snapshot.textProcessing.enabled ||
                  !snapshot.textProcessing.prompts.length
                }
                onClick={() => {
                  setNotice("");
                  setProcessing(true);
                }}
              >
                Process text
              </Button>
              {!snapshot.textProcessing.enabled && (
                <Link
                  to="/prompts"
                  onClick={onClose}
                  className="text-xs text-muted-foreground underline"
                >
                  Set up text model
                </Link>
              )}
              <Button
                variant="outline"
                disabled={!isDesktop || !selection || saving || busy}
                onClick={() => {
                  setNotice("");
                  setTerm(selection);
                }}
              >
                Add to vocabulary
              </Button>
              <span className="text-xs text-muted-foreground">
                Select a name or term in the transcript.
              </span>
            </div>
            {notice && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            {error && (
              <p id="transcript-save-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!canSave} onClick={() => void save()}>
                {saving ? "Saving…" : "Save transcript"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VocabularyTermForm({
  selected,
  busy,
  onBusy,
  onCancel,
  onSaved,
}: {
  selected: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [canonical, setCanonical] = useState(selected);
  const [aliases, setAliases] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  async function save() {
    if (saving || busy || !canonical.trim()) return;
    setSaving(true);
    onBusy(true);
    setError("");
    try {
      await backend.addVocabularyTerm(
        canonical,
        aliases
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean),
      );
      onSaved();
    } catch (cause) {
      setError(message(cause));
      setSaving(false);
    } finally {
      onBusy(false);
    }
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          void save();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Add to vocabulary</DialogTitle>
        <DialogDescription>
          Applies to future dictations. Your transcript draft stays open.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="correction-term">Preferred spelling</Label>
        <Input
          ref={input}
          id="correction-term"
          maxLength={80}
          value={canonical}
          disabled={saving}
          onChange={(event) => setCanonical(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="correction-aliases">Aliases (comma-separated)</Label>
        <Input
          id="correction-aliases"
          placeholder="Optional alternative spellings"
          value={aliases}
          disabled={saving}
          onChange={(event) => setAliases(event.target.value)}
        />
      </div>
      {busy && (
        <p className="text-sm text-muted-foreground">
          Finish the current operation before adding a term.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || busy || !canonical.trim()}>
          {saving ? "Saving…" : "Save term"}
        </Button>
      </DialogFooter>
    </form>
  );
}
