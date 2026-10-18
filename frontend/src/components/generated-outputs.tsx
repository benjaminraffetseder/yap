import { useDictation } from "@/components/dictation-provider";
import { MarkdownContent } from "@/components/markdown-content";
import { TextPanel } from "@/components/text-panel";
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
import { backend, isBusy, message, processingOptions, type GeneratedOutput } from "@/lib/backend";
import { useTextRequest } from "@/lib/use-text-request";
import { Copy, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { MotionReveal } from "@/components/motion-reveal";
import { Link } from "react-router";

export function GeneratedOutputs({
  sessionID,
  unavailable,
}: {
  sessionID: string;
  unavailable: boolean;
}) {
  const { snapshot, run } = useDictation();
  const { enabled } = snapshot.textProcessing;
  const options = processingOptions(snapshot.textProcessing);
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const [outputs, setOutputs] = useState<GeneratedOutput[]>([]);
  const seenOutputs = useRef<{ sessionID: string; ids: Set<string> } | null>(null);
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<GeneratedOutput | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const generation = useTextRequest();
  useEffect(() => {
    if (!processingOptions(snapshot.textProcessing).some((option) => option.value === selected))
      setSelected(processingOptions(snapshot.textProcessing)[0]?.value ?? "");
  }, [snapshot.textProcessing, selected]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void backend
      .generatedOutputs(sessionID)
      .then((value) => {
        if (active) {
          const previous = seenOutputs.current;
          // The first fetch is existing history, not a newly generated result.
          setEnteringIds(
            new Set(
              previous?.sessionID === sessionID
                ? value.filter((output) => !previous.ids.has(output.id)).map((output) => output.id)
                : [],
            ),
          );
          seenOutputs.current = { sessionID, ids: new Set(value.map((output) => output.id)) };
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
  const selectedChain = (snapshot.textProcessing.chains ?? []).find(
    (chain) => chain.id === selected,
  );
  return (
    <section aria-label="Generated outputs" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border bg-muted/15 p-1">
            <Label htmlFor="output-prompt" className="sr-only">
              Output prompt
            </Label>
            <Select
              items={options}
              value={selected || null}
              disabled={!canGenerate || !options.length}
              onValueChange={(value) => {
                if (value) {
                  setSelected(value);
                  generation.clear();
                }
              }}
            >
              <SelectTrigger
                id="output-prompt"
                className="w-28 min-w-0 border-transparent bg-transparent text-xs data-[size=default]:h-8 hover:bg-muted/50 sm:w-44 dark:bg-transparent"
              >
                <SelectValue className="min-w-0" placeholder="Choose a prompt" />
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
            {generation.pending ? (
              <div className="flex flex-wrap items-center gap-1">
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <Loader2
                    aria-hidden="true"
                    className="size-3 animate-spin motion-reduce:animate-none"
                  />
                  {selectedChain ? snapshot.status.message : "Generating output…"}
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
                pressFeedback
                size="sm"
                variant="ghost"
                aria-label={selectedChain ? "Run chain" : "Generate output"}
                className="bg-primary/10 text-xs text-primary hover:bg-primary/15 hover:text-primary"
                disabled={!canGenerate || !selected}
                onClick={() =>
                  void generate((id) => backend.generateOutput(id, sessionID, selected))
                }
              >
                <Sparkles className="size-3.5" />
                {selectedChain ? "Run chain" : "Generate"}
              </Button>
            )}
          </div>
          {!enabled && (
            <Link
              to="/prompts"
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              Set up text model
            </Link>
          )}
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {selectedChain
            ? "Each step uses its chosen input. Completed results are saved separately, even if a later step fails."
            : "Uses your saved transcript. New outputs are saved separately."}
        </p>
      </div>
      {generation.error && (
        <p role="alert" className="text-sm text-destructive">
          {generation.error}
        </p>
      )}
      {generation.result && (
        <p role="status" className="text-sm text-primary">
          {selectedChain ? "Chain complete. All step results saved." : "Output saved."}
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
        <AnimatePresence>
          {outputs.map((output) => (
            <MotionReveal
              key={`${sessionID}:${output.id}`}
              preset="output"
              from="translateY(8px)"
              enter={enteringIds.has(output.id)}
            >
              <article aria-label={`${output.prompt.name} output`}>
                <TextPanel
                  variant="reading"
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
                  {output.chain?.runId && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      {output.chain.name} · Step {output.chain.step} of {output.chain.total}
                      {" · Input: "}
                      {output.chain.input === "original"
                        ? "Original transcription"
                        : output.chain.input === "transcript"
                          ? "Saved transcript"
                          : (() => {
                              const source = outputs.find(
                                (item) => item.id === output.chain?.sourceOutputId,
                              );
                              return source
                                ? `Step ${source.chain?.step}: ${source.prompt.name}`
                                : "Earlier step (saved input below)";
                            })()}
                    </p>
                  )}
                  <MarkdownContent className="text-base leading-8">{output.text}</MarkdownContent>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      pressFeedback
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
                    <summary className="cursor-pointer text-muted-foreground">
                      Input and prompt
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <h4 className="font-semibold">Input text</h4>
                        <MarkdownContent className="mt-1 max-h-52 overflow-auto text-xs leading-6">
                          {output.input}
                        </MarkdownContent>
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
            </MotionReveal>
          ))}
        </AnimatePresence>
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
