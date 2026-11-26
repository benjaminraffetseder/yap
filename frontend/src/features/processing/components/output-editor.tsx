import { AutoSaveStatus } from "@/components/shared/auto-save-status";
import { CopyButton } from "@/components/shared/copy-button";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import {
  ContentEditor,
  type ContentEditorHandle,
} from "@/features/transcripts/components/content-editor";
import { RevisionHistory } from "@/features/transcripts/components/revision-history";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useContentDraft } from "@/hooks/use-content-draft";
import { nativeText } from "@/i18n/native-text";
import { backend, message, type GeneratedOutput } from "@/lib/backend";
import { resourceKeys } from "@/lib/queries/resource-queries";
import { useResourceReadVersion } from "@/lib/queries/saved-queries";
import { useQueryClient } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function OutputEditor({
  output,
  disabled,
  onClose,
}: {
  output: GeneratedOutput;
  disabled?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = resourceKeys.outputs(output.sessionId);
  const readVersion = useResourceReadVersion(queryKey);
  const [text, setText, draft] = useContentDraft(
    `output:${output.sessionId}:${output.id}`,
    output.text,
    readVersion,
  );
  const editor = useRef<ContentEditorHandle>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const [closing, setClosing] = useState(false);
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
      await draft.entry.submit((value) => {
        let boundary: number | undefined;
        const writing = (async () => {
          await queryClient.cancelQueries({ queryKey });
          try {
            await backend.saveOutput(output.sessionId, output.id, value, draft.expectedText());
            draft.acknowledge(value);
          } finally {
            boundary = queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0;
            // A failed follow-up read must not replay a successful native write.
            await queryClient.invalidateQueries({ queryKey });
          }
        })();
        return Object.assign(writing, { savedReadBoundary: () => boundary });
      });
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    ...draft.autosave,
    canSave: !disabled && !reason,
    save,
    delay: 1000,
  });
  async function close() {
    if (closing) return;
    setClosing(true);
    if (!draft.dirty || (!reason && (await draft.retry(autoSave.retry)))) onClose();
    setClosing(false);
  }
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={t("contentEditor.editingOutput")}
      data-slot="output-editor"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background py-2">
        <h2 className="text-sm font-semibold text-primary">{t("contentEditor.editingOutput")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <AutoSaveStatus
            compact
            status={autoSave.status}
            reason={reason}
            retry={() => draft.retry(autoSave.retry)}
            discard={() => {
              setText(draft.baseline);
              draft.resetExpected();
              setError("");
            }}
            disabled={closing}
          />
          <CopyButton text={text} label={t("common.copy")} variant="ghost" disabled={!!reason} />
          <ActionMenu label={t("uiPolish.editingTools")} disabled={closing}>
            <ActionMenuItem onClick={() => setHistory(true)}>
              <History />
              {t("promptsPage.versionHistory")}
            </ActionMenuItem>
            <ActionMenuItem
              disabled={text === (output.originalText ?? output.text)}
              onClick={() => setText(output.originalText ?? output.text)}
            >
              <RotateCcw />
              {t("contentEditor.restoreOriginal")}
            </ActionMenuItem>
          </ActionMenu>
          <Button size="sm" onClick={() => void close()} disabled={closing || !!reason}>
            {t("dictationProfiles.done")}
          </Button>
        </div>
      </header>
      <ContentEditor
        ref={editor}
        id={`output-editor-${output.id}`}
        value={text}
        onChange={setText}
        label={t("contentEditor.editingOutput")}
        disabled={disabled || closing}
        invalid={!!error}
        describedBy={error ? `output-error-${output.id}` : undefined}
        onSave={() => void draft.retry(autoSave.retry)}
        onClose={() => void close()}
        autoFocus
      />
      {error && (
        <p id={`output-error-${output.id}`} role="alert" className="text-sm text-destructive">
          {nativeText(error)}
        </p>
      )}
      {history && (
        <RevisionHistory
          kind="output"
          itemId={output.id}
          title={t("contentEditor.outputVersionHistory")}
          current={text}
          onClose={() => setHistory(false)}
          onRestore={(value) => {
            setText(value);
            setHistory(false);
            editor.current?.focus();
          }}
        />
      )}
    </section>
  );
}
