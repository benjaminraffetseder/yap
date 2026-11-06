import { nativeText } from "@/i18n/native-text";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { InferenceStats } from "@/components/inference-stats";
import { MarkdownContent } from "@/components/markdown-content";
import { ProcessingSelectItems } from "@/components/processing-select-items";
import { CopyButton } from "@/components/copy-button";
import { TranscriptExportDialog } from "@/components/transcript-export-dialog";
import { Button } from "@/components/ui/button";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
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
import { Download, Loader2, RefreshCw, Sparkles, Trash2, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export function GeneratedOutputs({
  sessionID,
  unavailable,
}: {
  sessionID: string;
  unavailable: boolean;
}) {
  const { t } = useTranslation();
  const { snapshot } = useDictation();
  const { enabled } = snapshot.textProcessing;
  const options = processingOptions(snapshot.textProcessing);
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const [outputs, setOutputs] = useState<GeneratedOutput[]>([]);
  const seenOutputs = useRef<{ sessionID: string; ids: Set<string> } | null>(null);
  const [activeOutput, setActiveOutput] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const composerTrigger = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<GeneratedOutput | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const outputActionsTrigger = useRef<HTMLButtonElement>(null);
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
          const newest = [...value].sort(
            (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
          );
          const added =
            previous?.sessionID === sessionID
              ? newest.find((output) => !previous.ids.has(output.id))
              : undefined;
          setActiveOutput(
            (current) =>
              added?.id ??
              (value.some((output) => output.id === current) ? current : (newest[0]?.id ?? "")),
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
  const ordered = [...outputs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const output = ordered.find((item) => item.id === activeOutput) ?? ordered[0];
  const composerVisible = generation.pending || composerOpen || (!loading && !outputs.length);
  const outputOptions = ordered.map((item) => ({
    value: item.id,
    label: `${item.prompt.name}${item.chain ? ` · ${item.chain.name} ${item.chain.step}/${item.chain.total}` : ""} · ${new Date(item.createdAt).toLocaleString(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" })}`,
  }));
  const selectedIdentity = outputOptions.find((item) => item.value === output?.id)?.label;
  const sourceOutput = output?.chain?.sourceOutputId
    ? outputs.find((item) => item.id === output.chain?.sourceOutputId)
    : undefined;
  const sourceLabel =
    output?.chain?.input === "original"
      ? t("historyEntryPage.originalTranscription")
      : output?.chain && output.chain.input !== "transcript"
        ? sourceOutput
          ? t("generatedOutputs.stepLabel", {
              step: sourceOutput.chain?.step,
              prompt: sourceOutput.prompt.name,
            })
          : t("generatedOutputs.earlierStepSavedInputBelow")
        : t("generatedOutputs.savedTranscript");
  return (
    <section
      aria-label={t("generatedOutputs.generatedOutputs")}
      className="@container/outputs max-w-[72ch] space-y-4 text-base"
    >
      {composerVisible && (
        <section
          id="output-composer"
          aria-label={t("generatedOutputs.generateOutput")}
          className="max-w-[72ch] text-base space-y-4 rounded-xl border bg-card/30 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t("uiPolish.createOutput")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("uiPolish.outputDescription")}
              </p>
            </div>
            {!!outputs.length && !generation.pending && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setComposerOpen(false);
                  requestAnimationFrame(() => composerTrigger.current?.focus());
                }}
              >
                {t("common.cancel")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-2">
              <Label htmlFor="output-prompt">{t("generatedOutputs.outputPrompt")}</Label>
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
                  aria-description={selectedChain ? t("dictationProfiles.promptChain") : undefined}
                  className="w-full max-w-md"
                >
                  {selectedChain && <Workflow aria-hidden="true" className="size-4" />}
                  <SelectValue placeholder={t("generatedOutputs.chooseAPrompt")} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <ProcessingSelectItems options={options} />
                </SelectContent>
              </Select>
            </div>
            {generation.pending ? (
              <Button size="sm" variant="outline" onClick={() => void generation.cancel()}>
                {t("generatedOutputs.cancelGeneration")}
              </Button>
            ) : (
              <Button
                pressFeedback
                size="sm"
                disabled={!canGenerate || !selected}
                aria-label={
                  selectedChain
                    ? t("generatedOutputs.runChain")
                    : t("generatedOutputs.generateOutput")
                }
                onClick={() =>
                  void generate((id) => backend.generateOutput(id, sessionID, selected))
                }
              >
                <Sparkles aria-hidden="true" className="size-3.5" />
                {selectedChain ? t("generatedOutputs.runChain") : t("generatedOutputs.generate")}
              </Button>
            )}
          </div>
          {!enabled && (
            <Link
              to="/prompts?section=models"
              className="text-sm text-primary underline underline-offset-4"
            >
              {t("generatedOutputs.setUpTextModel")}
            </Link>
          )}
          {selectedChain && (
            <p className="text-xs leading-5 text-muted-foreground">
              {t("generatedOutputs.eachStepUsesItsChosenInputCompleted")}
            </p>
          )}
        </section>
      )}
      <div
        data-slot="output-toolbar"
        className="grid min-w-0 items-center gap-x-4 gap-y-2 @min-[38rem]/outputs:flex @min-[38rem]/outputs:flex-wrap"
      >
        <div className="flex min-w-0 max-w-full flex-col gap-2 @min-[38rem]/outputs:flex-[1_1_12rem]">
          {output && (
            <>
              <Label htmlFor="saved-output" className="sr-only">
                {t("uiPolish.savedOutput")}{" "}
                <span className="text-muted-foreground">({outputs.length})</span>
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-[1_1_12rem]">
                  <Select
                    items={outputOptions}
                    value={output.id}
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (value) setActiveOutput(value);
                    }}
                  >
                    <SelectTrigger
                      id="saved-output"
                      title={selectedIdentity}
                      aria-description={selectedIdentity}
                      className="h-auto min-h-10 w-full border-input bg-background/40 py-0 shadow-none hover:bg-accent/50 dark:bg-control/40 dark:hover:bg-accent/50"
                    >
                      <SelectValue className="min-w-0 leading-5" style={{ display: "block" }}>
                        <span className="block truncate text-sm font-medium">
                          {output.prompt.name}
                          {output.chain
                            ? ` · ${output.chain.name} ${output.chain.step}/${output.chain.total}`
                            : ""}
                        </span>
                        <time
                          dateTime={output.createdAt}
                          className="block truncate text-xs font-normal text-muted-foreground"
                        >
                          {new Date(output.createdAt).toLocaleString(i18n.resolvedLanguage, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
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
                      {outputOptions.map((item) => (
                        <SelectItem
                          key={item.value}
                          value={item.value}
                          className="[&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:whitespace-normal [&>:first-child]:[overflow-wrap:anywhere]"
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1.5">
          {output && !composerVisible && (
            <Button
              ref={composerTrigger}
              size="sm"
              variant="ghost"
              className="font-normal text-muted-foreground hover:text-foreground"
              aria-expanded={false}
              aria-controls="output-composer"
              onClick={() => setComposerOpen(true)}
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
              {t("uiPolish.newOutput")}
            </Button>
          )}
          {output && (
            <>
              <CopyButton
                key={output.id}
                compact
                text={output.text}
                label={t("generatedOutputs.copyOutput")}
                disabled={disabled}
              />
              <Button
                size="sm"
                variant="ghost"
                className="font-normal text-muted-foreground hover:text-foreground"
                disabled={!canGenerate}
                onClick={() =>
                  void generate((id) => backend.regenerateOutput(id, sessionID, output.id))
                }
              >
                <RefreshCw aria-hidden="true" />
                {t("generatedOutputs.regenerate")}
              </Button>
              <ActionMenu
                triggerRef={outputActionsTrigger}
                label={t("uiPolish.outputActions")}
                disabled={disabled}
              >
                <ActionMenuItem disabled={disabled} onClick={() => setExporting(output.id)}>
                  <Download aria-hidden="true" />
                  {t("transcriptExport.exportThisOutput")}
                </ActionMenuItem>
                <ActionMenuItem
                  destructive
                  disabled={disabled}
                  onClick={() => {
                    setDeleteError("");
                    setDeleting(output);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {t("generatedOutputs.deleteOutput")}
                </ActionMenuItem>
              </ActionMenu>
            </>
          )}
        </div>
      </div>
      {exporting && (
        <TranscriptExportDialog
          returnFocus={outputActionsTrigger}
          selection={{ sessionIds: [sessionID], allMatching: false, query: "" }}
          outputID={exporting}
          onClose={() => setExporting(null)}
        />
      )}
      {generation.pending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          {selectedChain
            ? nativeText(snapshot.status.message)
            : t("generatedOutputs.generatingOutput")}
        </p>
      )}
      {generation.error && (
        <p role="alert" className="text-sm text-destructive">
          {generation.error}
        </p>
      )}
      {generation.result && (
        <p role="status" className="text-sm text-primary">
          {selectedChain
            ? t("generatedOutputs.chainCompleteAllStepResultsSaved")
            : t("generatedOutputs.outputSaved")}
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("generatedOutputs.loadingOutputs")}
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {nativeText(error)}
          <Button size="sm" variant="outline" onClick={() => setReload((old) => old + 1)}>
            {t("generatedOutputs.retryOutputs")}
          </Button>
        </div>
      )}
      {!loading && !error && !output && (
        <p className="py-8 text-sm text-muted-foreground">
          {t("generatedOutputs.noGeneratedOutputsYet")}
        </p>
      )}
      {output && (
        <article
          aria-label={t("generatedOutputs.output", { name: output.prompt.name })}
          aria-busy={loading}
          className="max-w-[72ch] space-y-4 border-t py-4 text-base"
        >
          <div className="space-y-1 text-xs leading-5 text-muted-foreground">
            {output.chain && (
              <p>
                {output.chain.name} · {t("uiPolish.step")} {output.chain.step}/{output.chain.total}
              </p>
            )}
            <p>
              {t("uiPolish.generatedWith", { model: output.model })} ·{" "}
              {t("uiPolish.fromSource", { source: sourceLabel })}
            </p>
          </div>
          <MarkdownContent className="text-base leading-7">{output.text}</MarkdownContent>
          <details className="border-t pt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("uiPolish.sourceAndPrompt")}
            </summary>
            <div className="mt-4 space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{output.model}</span>
                <time dateTime={output.createdAt}>
                  {new Date(output.createdAt).toLocaleString(i18n.resolvedLanguage)}
                </time>
                <InferenceStats output={output} />
              </div>
              {output.chain && (
                <p className="text-xs text-muted-foreground">
                  {output.chain.name} · {t("uiPolish.step")} {output.chain.step}{" "}
                  {t("historyPage.of")} {output.chain.total}
                  {t("generatedOutputs.input")}
                  {output.chain.input === "original"
                    ? t("historyEntryPage.originalTranscription")
                    : output.chain.input === "transcript"
                      ? t("generatedOutputs.savedTranscript")
                      : (() => {
                          const source = outputs.find(
                            (item) => item.id === output.chain?.sourceOutputId,
                          );
                          return source
                            ? t("generatedOutputs.stepLabel", {
                                step: source.chain?.step,
                                prompt: source.prompt.name,
                              })
                            : t("generatedOutputs.earlierStepSavedInputBelow");
                        })()}
                </p>
              )}
              <div>
                <h4 className="text-sm font-medium">{t("generatedOutputs.inputText")}</h4>
                <MarkdownContent className="mt-2 text-sm leading-7 text-muted-foreground">
                  {output.input}
                </MarkdownContent>
              </div>
              <div>
                <h4 className="text-sm font-medium">{t("generatedOutputs.promptInstructions")}</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                  {output.prompt.instruction}
                </p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("generatedOutputs.regeneratingReusesTheSavedInputAndPrompt")}
              </p>
            </div>
          </details>
        </article>
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
            <DialogTitle>{t("generatedOutputs.deleteThisOutput")}</DialogTitle>
            <DialogDescription>
              {t("generatedOutputs.thisRemovesTheGeneratedOutputYourTranscription")}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deletingNow} onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={deletingNow} onClick={() => void remove()}>
              {deletingNow ? t("dictationProfiles.deleting") : t("generatedOutputs.deleteOutput")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
