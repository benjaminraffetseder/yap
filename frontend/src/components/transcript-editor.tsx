import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { AutoSaveStatus } from "@/components/auto-save-status";
import { useDictation } from "@/components/dictation-provider";
import { MarkdownContent } from "@/components/markdown-content";
import { RevisionHistory } from "@/components/revision-history";
import { TextPanel } from "@/components/text-panel";
import { TranscriptDiff } from "@/components/transcript-diff";
import { TranscriptProcessor } from "@/components/transcript-processor";
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
import { backend, isBusy, isDesktop, message, type Session } from "@/lib/backend";
import { useAutoSave } from "@/lib/use-auto-save";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { useEffect, useRef, useState, type RefObject } from "react";
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
  const [saved, setSaved] = useState(initial);
  const [text, setText, draftState] = useSavedDraft(`transcript:${session.id}`, saved);
  const [closing, setClosing] = useState(false);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [processing, setProcessing] = useState(false);
  const [referenceTab, setReferenceTab] = useState("original");
  const { snapshot } = useDictation();
  const busy = isBusy(snapshot.status.phase);
  const input = useRef<HTMLTextAreaElement>(null);
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
      await backend.saveTranscript(session.id, text);
      draftState.markSubmitted(text);
      setSaved(text);
      onSaved();
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    draftKey: text,
    dirty: draftState.dirty,
    canSave: isDesktop && !reason,
    save,
    delay: 1000,
  });
  const saving = autoSave.saving;
  async function close() {
    if (closing || adding) return;
    setClosing(true);
    if (!draftState.dirty || reason || (await autoSave.retry())) onClose();
    setClosing(false);
  }
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !adding) {
          if (processing) setProcessing(false);
          else if (term !== null) setTerm(null);
          else void close();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={input}
        finalFocus={returnFocus}
        className={
          processing || term !== null
            ? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl"
            : "flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw_-_2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        }
      >
        {processing ? (
          <TranscriptProcessor
            input={text}
            onCancel={() => setProcessing(false)}
            onUse={(result) => {
              setText(result);
              setSelection("");
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
        ) : (
          <>
            <DialogHeader className="shrink-0 px-5 pt-5 pb-6 text-left sm:px-7 sm:pt-7">
              <DialogTitle className="text-xl">{t("historyEntryPage.editTranscript")}</DialogTitle>
              <DialogDescription>
                {t("transcriptEditor.changesUpdateTheSavedTextTheOriginal")}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-5 overflow-y-auto px-5 pb-6 sm:px-7">
              <div className="grid items-start gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <section
                  aria-label={t("transcriptEditor.editableText")}
                  className="min-w-0 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">{t("transcriptEditor.yourDraft")}</h3>
                    <span className="text-xs text-muted-foreground">
                      {t("transcriptEditor.wordCount", {
                        count: text.trim().split(/\s+/).filter(Boolean).length,
                      })}
                    </span>
                  </div>
                  <Label htmlFor="transcript-editor" className="sr-only">
                    {t("transcriptEditor.editableText")}
                  </Label>
                  <textarea
                    ref={input}
                    id="transcript-editor"
                    value={text}
                    disabled={closing}
                    maxLength={100000}
                    rows={12}
                    aria-invalid={!!error}
                    aria-describedby={error ? "transcript-save-error" : undefined}
                    className="min-h-64 max-h-[50vh] w-full resize-y rounded-xl border border-input bg-card px-5 py-4 text-base leading-8 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                    onChange={(event) => {
                      setText(event.target.value);
                      setSelection("");
                    }}
                    onSelect={(event) => {
                      const field = event.currentTarget;
                      const selected = field.value
                        .slice(field.selectionStart, field.selectionEnd)
                        .trim();
                      setSelection(
                        selected &&
                          Array.from(selected).length <= 80 &&
                          // eslint-disable-next-line no-control-regex -- reject control characters in vocabulary selections
                          !/[\u0000-\u001f\u007f-\u009f]/.test(selected)
                          ? selected
                          : "",
                      );
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        void autoSave.retry();
                      }
                    }}
                  />
                </section>
                <Tabs
                  value={referenceTab}
                  onValueChange={(value) => setReferenceTab(String(value))}
                  className="min-w-0 gap-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <TabsList
                      aria-label={t("transcriptEditor.editorReference")}
                      className="group-data-[orientation=horizontal]/tabs:h-8"
                    >
                      <TabsTrigger value="original" className="px-3 text-xs">
                        {t("historyEntryPage.original")}
                      </TabsTrigger>
                      {dirty && (
                        <TabsTrigger value="changes" className="px-3 text-xs">
                          {t("historyEntryPage.changes")}
                        </TabsTrigger>
                      )}
                    </TabsList>
                    <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
                      {t("promptsPage.versionHistory")}
                    </Button>
                  </div>
                  <TabsContent value="original" keepMounted>
                    <TextPanel
                      title={t("historyEntryPage.originalTranscription")}
                      kind="source"
                      description={t("transcriptEditor.fromTheRecordingReadOnly")}
                    >
                      <MarkdownContent className="max-h-[50vh] overflow-y-auto text-base leading-8">
                        {session.rawTranscript}
                      </MarkdownContent>
                    </TextPanel>
                  </TabsContent>
                  {dirty && (
                    <TabsContent value="changes" keepMounted>
                      <TextPanel
                        title={t("transcriptEditor.draftChanges")}
                        kind="source"
                        description={t("transcriptEditor.savedTextYourDraft")}
                      >
                        <div className="max-h-[50vh] overflow-y-auto">
                          <TranscriptDiff before={initial} after={text} />
                        </div>
                      </TextPanel>
                    </TabsContent>
                  )}
                </Tabs>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
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
                  {t("transcriptEditor.processText")}
                </Button>
                {!snapshot.textProcessing.enabled && (
                  <Link
                    to="/prompts"
                    onClick={() => void close()}
                    className="text-xs text-muted-foreground underline"
                  >
                    {t("generatedOutputs.setUpTextModel")}
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isDesktop || !selection || saving || busy}
                  onClick={() => {
                    setNotice("");
                    setTerm(selection);
                  }}
                >
                  {t("transcriptEditor.addToVocabulary")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t("transcriptEditor.selectANameOrTermInThe")}
                </span>
              </div>
              {notice && (
                <p role="status" className="text-sm text-muted-foreground">
                  {notice}
                </p>
              )}
              {error && (
                <p id="transcript-save-error" role="alert" className="text-sm text-destructive">
                  {nativeText(error)}
                </p>
              )}
            </div>
            <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-4 sm:justify-between sm:px-7">
              <AutoSaveStatus
                status={autoSave.status}
                reason={reason}
                retry={autoSave.retry}
                discard={() => setText(saved)}
                disabled={closing}
              />
              <Button variant="outline" disabled={closing} onClick={() => void close()}>
                {t("dictationProfiles.done")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
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
  const { t } = useTranslation();
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
