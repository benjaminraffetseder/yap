import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Copy, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useDictation } from "@/components/dictation-provider";
import { TextPanel } from "@/components/text-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backend, isBusy, message, type GeneratedOutput } from "@/lib/backend";
import { useTextRequest } from "@/lib/use-text-request";

export function GeneratedOutputs({
  sessionID,
  unavailable,
}: {
  sessionID: string;
  unavailable: boolean;
}) {
  const { snapshot, run } = useDictation();
  const { enabled, prompts } = snapshot.textProcessing;
  const [selected, setSelected] = useState(prompts[0]?.id ?? "");
  const [outputs, setOutputs] = useState<GeneratedOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<GeneratedOutput | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const generation = useTextRequest();
  useEffect(() => {
    if (!prompts.some((prompt) => prompt.id === selected)) setSelected(prompts[0]?.id ?? "");
  }, [prompts, selected]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void backend
      .generatedOutputs(sessionID)
      .then((value) => {
        if (active) {
          setOutputs(value);
          setLoading(false);
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
  }, [sessionID, snapshot.history, reload]);
  const disabled = unavailable || loading || !!error || deletingNow || generation.pending;
  const modelBusy = isBusy(snapshot.status.phase);
  const canGenerate = !disabled && !modelBusy && enabled;
  async function generate(action: (id: string) => Promise<string>) {
    await generation.request(action);
    setReload((old) => old + 1);
  }
  async function remove() {
    if (!deleting || deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await backend.deleteOutput(sessionID, deleting.id);
      setDeleting(null);
      generation.clear();
      setReload((old) => old + 1);
    } catch (cause) {
      setDeleteError(message(cause));
    } finally {
      setDeletingNow(false);
    }
  }
  const options = prompts.map((prompt) => ({ value: prompt.id, label: prompt.name }));
  return (
    <section aria-label="Generated outputs" className="space-y-5">
      <div className="space-y-2.5 border-b pb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid w-full max-w-64 gap-1.5">
            <Label htmlFor="output-prompt" className="text-xs font-normal text-muted-foreground">
              Output prompt
            </Label>
            <Select
              items={options}
              value={selected || null}
              disabled={!canGenerate || !prompts.length}
              onValueChange={(value) => {
                if (value) {
                  setSelected(value);
                  generation.clear();
                }
              }}
            >
              <SelectTrigger
                id="output-prompt"
                className="w-full bg-transparent text-xs data-[size=default]:h-8 dark:bg-transparent"
              >
                <SelectValue placeholder="Choose a prompt" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                <div className="p-1">
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </div>
              </SelectContent>
            </Select>
          </div>
          {generation.pending ? (
            <div className="flex flex-wrap items-center gap-3">
              <span role="status" className="text-xs text-muted-foreground">
                Generating output…
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => void generation.cancel()}
              >
                Cancel generation
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="shadow-none"
              disabled={!canGenerate || !selected}
              onClick={() => void generate((id) => backend.generateOutput(id, sessionID, selected))}
            >
              <Sparkles className="size-3.5 text-muted-foreground" />
              Generate output
            </Button>
          )}
          {!enabled && (
            <Link to="/prompts" className="pb-1.5 text-xs text-muted-foreground underline">
              Set up text model
            </Link>
          )}
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          Uses your saved transcription. Each output is kept separately.
        </p>
      </div>
      {generation.error && (
        <p role="alert" className="text-sm text-destructive">
          {generation.error}
        </p>
      )}
      {generation.result && (
        <p role="status" className="text-sm text-primary">
          Output saved.
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading outputs…
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {error}
          <Button size="sm" variant="outline" onClick={() => setReload((old) => old + 1)}>
            Retry outputs
          </Button>
        </div>
      )}
      {!loading && !error && !outputs.length && (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          No generated outputs yet.
        </p>
      )}
      <div aria-busy={loading} className="space-y-4">
        {outputs.map((output) => (
          <article key={output.id} aria-label={`${output.prompt.name} output`}>
            <TextPanel
              title={output.prompt.name}
              kind="result"
              description={`${output.model} · ${new Date(output.createdAt).toLocaleString()}`}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void run(() => backend.copy(output.text), false)}
                >
                  <Copy className="size-3.5" />
                  Copy output
                </Button>
              }
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-7">{output.text}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canGenerate}
                  onClick={() =>
                    void generate((id) => backend.regenerateOutput(id, sessionID, output.id))
                  }
                >
                  <RefreshCw className="size-3.5" />
                  Regenerate
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  className="ml-auto text-destructive"
                  onClick={() => {
                    setDeleteError("");
                    setDeleting(output);
                  }}
                >
                  <Trash2 className="size-3.5" />
                  Delete output
                </Button>
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Input and prompt</summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <h4 className="font-semibold">Input text</h4>
                    <p className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words leading-6">
                      {output.input}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-semibold">Prompt instructions</h4>
                    <p className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-words leading-6">
                      {output.prompt.instruction}
                    </p>
                  </div>
                </div>
              </details>
            </TextPanel>
          </article>
        ))}
      </div>
      {!!outputs.length && (
        <p className="text-xs text-muted-foreground">
          Regenerating reuses the saved input and prompt with your current model. Earlier outputs
          are kept.
        </p>
      )}
      <Dialog
        open={!!deleting}
        disablePointerDismissal
        onOpenChange={(value) => {
          if (!value && !deletingNow) setDeleting(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this output?</DialogTitle>
            <DialogDescription>
              This removes the generated output. Your transcription and other outputs are kept.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deletingNow} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingNow} onClick={() => void remove()}>
              {deletingNow ? "Deleting…" : "Delete output"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
