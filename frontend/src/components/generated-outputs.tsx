import { ChatCitationContent } from "@/components/chat-citation-content";
import { CopyButton } from "@/components/copy-button";
import { useDictation } from "@/components/dictation-provider";
import { InferenceStats } from "@/components/inference-stats";
import { MarkdownContent } from "@/components/markdown-content";
import { ProcessingSelectItems } from "@/components/processing-select-items";
import { TranscriptExportDialog } from "@/components/transcript-export-dialog";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  isBusy,
  message,
  processingOptions,
  type ChatReference,
  type GeneratedOutput,
} from "@/lib/backend";
import { useTextRequest } from "@/lib/use-text-request";
import {
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function GeneratedOutputs({
  sessionID,
  unavailable,
  onDiscuss,
  onReveal,
}: {
  sessionID: string;
  unavailable: boolean;
  onDiscuss?: (output: GeneratedOutput) => void;
  onReveal?: (output: GeneratedOutput, references: ChatReference[]) => void;
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
  const promptTrigger = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deleting, setDeleting] = useState<GeneratedOutput | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const outputActionsTrigger = useRef<HTMLButtonElement>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // The backend saves outputs and reports activity even after navigation.
  const generation = useTextRequest({ cancelOnUnmount: false });
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
  const generationStatus = selectedChain
    ? nativeText(snapshot.status.message)
    : t("generatedOutputs.generatingOutput");
  const outputOptions = ordered.map((item) => ({
    value: item.id,
    label: `${item.prompt.name}${item.chain ? ` · ${item.chain.name} ${item.chain.step}/${item.chain.total}` : ""} · ${new Date(item.createdAt).toLocaleString(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" })}`,
    output: item,
  }));
  const selectedIdentity = outputOptions.find((item) => item.value === output?.id)?.label;
  const sourceOutput = output?.chain?.sourceOutputId
    ? outputs.find((item) => item.id === output.chain?.sourceOutputId)
    : undefined;
  const sourceLabel =
    output?.citations?.source === "original" || output?.chain?.input === "original"
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
      className="@container/outputs min-w-0 space-y-5 text-base"
    >
      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent
          id="output-composer"
          initialFocus={promptTrigger}
          finalFocus={composerTrigger}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        >
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>{t("uiPolish.createOutput")}</DialogTitle>
            <DialogDescription>{t("uiPolish.outputDescription")}</DialogDescription>
          </DialogHeader>
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canGenerate || !selected) return;
              setComposerOpen(false);
              void generate((id) => backend.generateOutput(id, sessionID, selected));
            }}
          >
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="output-prompt" className="text-xs text-muted-foreground">
                {t("generatedOutputs.outputPrompt")}
              </Label>
              <Select
                items={options}
                value={selected || null}
                disabled={!canGenerate || !options.length}
                onValueChange={(value) => {
                  if (value) {
                    setSelected(value);
                  }
                }}
              >
                <SelectTrigger
                  ref={promptTrigger}
                  id="output-prompt"
                  aria-description={selectedChain ? t("dictationProfiles.promptChain") : undefined}
                  className="w-full bg-background data-[size=default]:h-9 dark:bg-control"
                >
                  {selectedChain && <Workflow aria-hidden="true" className="size-4" />}
                  <SelectValue
                    className="min-w-0 truncate"
                    placeholder={t("generatedOutputs.chooseAPrompt")}
                  />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <ProcessingSelectItems options={options} />
                </SelectContent>
              </Select>
            </div>
            {!enabled && (
              <Link
                to="/prompts?section=models"
                onClick={() => setComposerOpen(false)}
                className="block text-sm text-primary underline underline-offset-4"
              >
                {t("generatedOutputs.setUpTextModel")}
              </Link>
            )}
            {selectedChain && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t("generatedOutputs.eachStepUsesItsChosenInputCompleted")}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setComposerOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                pressFeedback
                disabled={!canGenerate || !selected}
                aria-label={
                  selectedChain
                    ? t("generatedOutputs.runChain")
                    : t("generatedOutputs.generateOutput")
                }
              >
                <Sparkles aria-hidden="true" className="size-3.5" />
                {selectedChain ? t("generatedOutputs.runChain") : t("generatedOutputs.generate")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div
        data-slot="output-toolbar"
        className="flex min-w-0 flex-col gap-3 @min-[28rem]/outputs:flex-row @min-[28rem]/outputs:items-center"
      >
        <div className="min-w-0 flex-1">
          {output ? (
            <>
              <Label htmlFor="saved-output" className="sr-only">
                {t("uiPolish.savedOutput")}{" "}
                <span className="text-muted-foreground">({outputs.length})</span>
              </Label>
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
                  className="h-auto min-h-14 w-full gap-3 border-border bg-card/50 px-3 py-2 shadow-none hover:bg-accent/50 data-popup-open:border-ring dark:bg-card/50 dark:hover:bg-accent/50"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                  >
                    {output.chain ? (
                      <Workflow className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                  <SelectValue className="min-w-0 leading-5" style={{ display: "block" }}>
                    <span className="block truncate text-sm font-medium">{output.prompt.name}</span>
                    <span
                      role={generation.pending ? "status" : undefined}
                      className="block truncate text-xs font-normal text-muted-foreground"
                    >
                      {generation.pending ? (
                        generationStatus
                      ) : (
                        <>
                          {output.chain &&
                            `${output.chain.name} · ${output.chain.step}/${output.chain.total} · `}
                          <time dateTime={output.createdAt}>
                            {new Date(output.createdAt).toLocaleString(i18n.resolvedLanguage, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </>
                      )}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  align="start"
                  className="p-1"
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
                      aria-label={item.label}
                      className="[&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:whitespace-normal [&>:first-child]:[overflow-wrap:anywhere]"
                    >
                      <div className="min-w-0 space-y-0.5 py-1">
                        <span className="block font-medium">{item.output.prompt.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.output.chain &&
                            `${item.output.chain.name} · ${item.output.chain.step}/${item.output.chain.total} · `}
                          <time dateTime={item.output.createdAt}>
                            {new Date(item.output.createdAt).toLocaleString(i18n.resolvedLanguage, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <p
              role={loading || generation.pending ? "status" : undefined}
              className="flex min-h-14 items-center gap-2 text-sm text-muted-foreground"
            >
              {(loading || generation.pending) && (
                <Loader2
                  aria-hidden="true"
                  className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                />
              )}
              {loading
                ? t("generatedOutputs.loadingOutputs")
                : generation.pending
                  ? generationStatus
                  : t("generatedOutputs.noGeneratedOutputsYet")}
            </p>
          )}
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  ref={composerTrigger}
                  pressFeedback
                  size="icon-sm"
                  variant="outline"
                  className="shadow-none"
                  disabled={
                    unavailable || deletingNow || (!generation.pending && (loading || !!error))
                  }
                />
              }
              aria-label={
                generation.pending
                  ? t("generatedOutputs.cancelGeneration")
                  : t("uiPolish.newOutput")
              }
              aria-haspopup={generation.pending ? undefined : "dialog"}
              aria-expanded={generation.pending ? undefined : composerOpen}
              aria-controls={generation.pending ? undefined : "output-composer"}
              onClick={() => {
                if (generation.pending) void generation.cancel();
                else {
                  setComposerOpen(true);
                }
              }}
            >
              {generation.pending ? (
                <Square aria-hidden="true" className="size-3.5" />
              ) : (
                <Plus aria-hidden="true" className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {generation.pending
                ? t("generatedOutputs.cancelGeneration")
                : t("uiPolish.newOutput")}
            </TooltipContent>
          </Tooltip>
          {output && (
            <>
              <CopyButton
                key={output.id}
                iconOnly
                text={output.text}
                label={t("generatedOutputs.copyOutput")}
                disabled={disabled}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      pressFeedback
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={!canGenerate || output.prompt.id === "chat"}
                    />
                  }
                  aria-label={t("generatedOutputs.regenerate")}
                  disabled={!canGenerate || output.prompt.id === "chat"}
                  onClick={() =>
                    void generate((id) => backend.regenerateOutput(id, sessionID, output.id))
                  }
                >
                  <RefreshCw aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>{t("generatedOutputs.regenerate")}</TooltipContent>
              </Tooltip>
              <ActionMenu
                triggerRef={outputActionsTrigger}
                label={t("uiPolish.outputActions")}
                disabled={disabled}
              >
                {onDiscuss && (
                  <ActionMenuItem disabled={disabled} onClick={() => onDiscuss(output)}>
                    <MessageSquare aria-hidden="true" />
                    {t("chat.discussOutput")}
                  </ActionMenuItem>
                )}
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
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          {nativeText(error)}
          <Button size="sm" variant="outline" onClick={() => setReload((old) => old + 1)}>
            {t("generatedOutputs.retryOutputs")}
          </Button>
        </div>
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
          {output.citations && onReveal ? (
            <ChatCitationContent
              text={output.text}
              references={output.citations.references ?? []}
              onReference={(ref) => onReveal(output, [ref])}
              className="text-base leading-7"
            />
          ) : (
            <MarkdownContent className="text-base leading-7">{output.text}</MarkdownContent>
          )}
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
