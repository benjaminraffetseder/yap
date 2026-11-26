import { AutoSaveStatus } from "@/components/shared/auto-save-status";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useDictationPhase,
  useSavedConfiguration,
} from "@/features/dictation/hooks/use-dictation-state";
import { TranscriptProcessor } from "@/features/processing/components/transcript-processor";
import {
  ContentEditor,
  type ContentEditorHandle,
} from "@/features/transcripts/components/content-editor";
import { RevisionHistory } from "@/features/transcripts/components/revision-history";
import { TextPanel } from "@/features/transcripts/components/text-panel";
import { TranscriptDiff } from "@/features/transcripts/components/transcript-diff";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useContentDraft } from "@/hooks/use-content-draft";
import { nativeText } from "@/i18n/native-text";
import { backend, isBusy, isDesktop, message, type Session } from "@/lib/backend";
import { resourceKeys } from "@/lib/queries/resource-queries";
import { useResourceReadVersion, useSavedActions } from "@/lib/queries/saved-queries";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

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
  const { t } = useTranslation();
  const initial = session.finalTranscript ?? session.rawTranscript;
  const queryClient = useQueryClient();
  const queryKey = resourceKeys.session(session.id);
  const readVersion = useResourceReadVersion(queryKey);
  const [text, setText, draftState] = useContentDraft(
    `transcript:${session.id}`,
    initial,
    readVersion,
  );
  const [closing, setClosing] = useState(false);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const [referenceTab, setReferenceTab] = useState("original");
  const [compare, setCompare] = useState(false);
  const snapshot = { ...useSavedConfiguration(), status: { phase: useDictationPhase() } };
  const busy = isBusy(snapshot.status.phase);
  const input = useRef<ContentEditorHandle>(null);
  useEffect(() => {
    if (term === null && !processing) input.current?.focus();
  }, [term, processing]);
  const dirty = text !== initial;
  if (!dirty && referenceTab === "changes") setReferenceTab("original");
  const reason = !text.trim()
    ? t("transcriptEditor.enterTranscriptText")
    : text.includes("\0")
      ? t("transcriptEditor.removeNullCharactersFromTheTranscript")
      : Array.from(text).length > 100000
        ? t("transcriptEditor.useAtMost100000Characters")
        : "";
  async function save() {
    setError("");
    try {
      await draftState.entry.submit((value) => {
        let boundary: number | undefined;
        const writing = (async () => {
          await queryClient.cancelQueries({ queryKey });
          try {
            await backend.saveTranscriptChecked(session.id, value, draftState.expectedText());
            draftState.acknowledge(value);
          } finally {
            boundary = queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;
            await queryClient.invalidateQueries({ queryKey });
          }
        })();
        return Object.assign(writing, { savedReadBoundary: () => boundary });
      });
      onSaved();
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    ...draftState.autosave,
    canSave: isDesktop && !reason,
    save,
    delay: 1000,
  });
  const saving = autoSave.saving;
  async function close() {
    if (closing || adding) return;
    setClosing(true);
    if (!draftState.dirty || reason || (await draftState.retry(autoSave.retry))) {
      onClose();
      requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true }));
    }
    setClosing(false);
  }
  return (
    <section
      aria-label={t("historyEntryPage.editTranscript")}
      data-slot="transcript-editor"
      className="space-y-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-background py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-primary">{t("uiPolish.editingTranscript")}</h2>
          <p className="text-xs text-muted-foreground">{t("uiPolish.historyEditorScope")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AutoSaveStatus
            compact
            status={autoSave.status}
            reason={reason}
            retry={() => draftState.retry(autoSave.retry)}
            discard={() => {
              setText(draftState.baseline);
              draftState.resetExpected();
              setError("");
            }}
            disabled={closing}
          />
          <Button size="sm" disabled={closing} onClick={() => void close()}>
            {t("dictationProfiles.done")}
          </Button>
        </div>
      </header>
      <div
        className={
          compare
            ? "@container/editor space-y-3"
            : "@container/editor max-w-[calc(72ch+2rem+2px)] space-y-3 text-base"
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-auto min-h-8 max-w-full text-left font-normal whitespace-normal text-muted-foreground hover:text-foreground"
            disabled={!snapshot.textProcessing.enabled || busy || saving}
            onClick={() => {
              setNotice("");
              setProcessing(true);
            }}
          >
            {t("transcriptEditor.processText")}
          </Button>
          <Button
            size="sm"
            variant={compare ? "secondary" : "ghost"}
            className={`h-auto min-h-8 max-w-full text-left font-normal whitespace-normal ${compare ? "" : "text-muted-foreground hover:text-foreground"}`}
            aria-expanded={compare}
            aria-controls="editor-reference"
            onClick={() => setCompare(!compare)}
          >
            {t("uiPolish.compareOriginal")}
          </Button>
          <ActionMenu label={t("uiPolish.editingTools")} text={t("uiPolish.tools")}>
            <ActionMenuItem onClick={() => setHistory(true)}>
              {t("promptsPage.versionHistory")}
            </ActionMenuItem>
          </ActionMenu>
        </div>
        <div className={compare ? "grid min-w-0 gap-6 @min-[48rem]/editor:grid-cols-2" : "min-w-0"}>
          <div className="min-w-0 space-y-3">
            <Label
              htmlFor="transcript-editor"
              className={compare ? "flex min-h-8 items-center text-sm" : "sr-only"}
            >
              {t("transcriptEditor.yourDraft")}
            </Label>
            <ContentEditor
              ref={input}
              id="transcript-editor"
              value={text}
              onChange={setText}
              disabled={closing}
              label={t("transcriptEditor.editableText")}
              invalid={!!error}
              describedBy={error ? "transcript-save-error" : undefined}
              onSave={() => void draftState.retry(autoSave.retry)}
              onClose={() => void close()}
              onAddToVocabulary={(selected) => {
                setNotice("");
                setTerm(selected);
              }}
              autoFocus
            />
            {error && (
              <p id="transcript-save-error" role="alert" className="text-sm text-destructive">
                {nativeText(error)}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <p>{t("transcriptEditor.selectANameOrTermInThe")}</p>
              <span className="ml-auto tabular-nums">
                {t("transcriptEditor.wordCount", {
                  count: text.trim().split(/\s+/).filter(Boolean).length,
                })}
              </span>
            </div>
            {!snapshot.textProcessing.enabled && (
              <Link
                to="/prompts"
                onClick={() => void close()}
                className="text-xs text-primary underline underline-offset-4"
              >
                {t("generatedOutputs.setUpTextModel")}
              </Link>
            )}
          </div>
          {compare && (
            <aside className="order-first min-w-0 self-start @min-[48rem]/editor:sticky @min-[48rem]/editor:top-24 @min-[48rem]/editor:order-last">
              <Tabs
                id="editor-reference"
                value={referenceTab}
                onValueChange={(v) => setReferenceTab(String(v))}
                className="max-h-[24rem] min-w-0 gap-3 overflow-y-auto @min-[48rem]/editor:max-h-[calc(100dvh-10rem)]"
              >
                <TabsList aria-label={t("transcriptEditor.editorReference")}>
                  <TabsTrigger value="original">{t("historyEntryPage.original")}</TabsTrigger>
                  {dirty && (
                    <TabsTrigger value="changes">{t("historyEntryPage.changes")}</TabsTrigger>
                  )}
                </TabsList>
                <TabsContent
                  value="original"
                  className="rounded-lg border border-input bg-card/30 px-4 py-3"
                >
                  <p className="sr-only">{t("transcriptEditor.fromTheRecordingReadOnly")}</p>
                  <div
                    data-slot="editor-original"
                    role="region"
                    aria-label={t("historyEntryPage.originalTranscription")}
                    className="whitespace-pre-wrap break-words text-base leading-7"
                  >
                    {session.rawTranscript}
                  </div>
                </TabsContent>
                {dirty && (
                  <TabsContent value="changes">
                    <TextPanel
                      title={t("transcriptEditor.draftChanges")}
                      kind="result"
                      variant="reading"
                      description={t("transcriptEditor.savedTextYourDraft")}
                    >
                      <TranscriptDiff before={initial} after={text} />
                    </TextPanel>
                  </TabsContent>
                )}
              </Tabs>
            </aside>
          )}
        </div>
      </div>
      <Dialog
        open={processing || term !== null}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !adding) {
            setProcessing(false);
            setTerm(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"
          finalFocus={() => {
            input.current?.focus();
            return false;
          }}
        >
          {processing ? (
            <TranscriptProcessor
              input={text}
              onCancel={() => setProcessing(false)}
              onUse={(result) => {
                setText(result);
                setProcessing(false);
                setNotice(t("transcriptEditor.resultAppliedChangesSaveAutomatically"));
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
                setNotice(t("transcriptEditor.addedToVocabulary"));
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {history && (
        <RevisionHistory
          kind="transcript"
          itemId={session.id}
          title={t("transcriptEditor.transcriptVersionHistory")}
          current={text}
          onClose={() => setHistory(false)}
          onRestore={setText}
        />
      )}
    </section>
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
  const { t } = useTranslation();
  const savedActions = useSavedActions();
  const [canonical, setCanonical] = useState(selected.trim());
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
      await savedActions.addVocabularyTerm(
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
        <DialogTitle>{t("transcriptEditor.addToVocabulary")}</DialogTitle>
        <DialogDescription>
          {t("transcriptEditor.appliesToFutureDictationsYourTranscriptDraft")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="correction-term">{t("vocabularyPage.preferredSpelling")}</Label>
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
        <Label htmlFor="correction-aliases">{t("vocabularyPage.aliasesCommaSeparated")}</Label>
        <Input
          id="correction-aliases"
          placeholder={t("transcriptEditor.optionalAlternativeSpellings")}
          value={aliases}
          disabled={saving}
          onChange={(event) => setAliases(event.target.value)}
        />
      </div>
      {busy && (
        <p className="text-sm text-muted-foreground">
          {t("transcriptEditor.finishTheCurrentOperationBeforeAddingA")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {nativeText(error)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={saving || busy || !canonical.trim()}>
          {saving ? t("autoSaveStatus.saving") : t("transcriptEditor.saveTerm")}
        </Button>
      </DialogFooter>
    </form>
  );
}
