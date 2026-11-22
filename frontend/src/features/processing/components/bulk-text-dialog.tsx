import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toastManager } from "@/components/ui/toast";
import { useSavedConfiguration } from "@/features/dictation/hooks/use-dictation-state";
import { ProcessingCombobox } from "@/features/processing/components/processing-combobox";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  message,
  processingOptions,
  type BulkTextRequest,
  type TranscriptExportSelection,
} from "@/lib/backend";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function BulkTextDialog({
  action,
  selection,
  returnFocus,
  onClose,
}: {
  action: BulkTextRequest["action"];
  selection: TranscriptExportSelection;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useSavedConfiguration();
  const options = processingOptions(snapshot.textProcessing);
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const [replaceTitles, setReplaceTitles] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const [preparation, setPreparation] = useState<{
    selection: TranscriptExportSelection;
    ids: readonly string[] | null;
    pending: boolean;
    error: string;
  }>(() => ({
    selection,
    ids: selection.allMatching ? null : Object.freeze([...selection.sessionIds]),
    pending: selection.allMatching,
    error: "",
  }));
  const configured = snapshot.textProcessing.enabled && !!snapshot.textProcessing.model.trim();
  const validPrompt = options.some((option) => option.value === selected);
  const currentPreparation = preparation.selection === selection ? preparation : null;
  const frozenIds = currentPreparation?.ids ?? null;
  const preparing = selection.allMatching && (currentPreparation?.pending ?? true);
  const preparationError = currentPreparation?.error ?? "";

  useEffect(() => {
    let current = true;
    if (!selection.allMatching) {
      setPreparation({
        selection,
        ids: Object.freeze([...selection.sessionIds]),
        pending: false,
        error: "",
      });
      return () => {
        current = false;
      };
    }
    setPreparation({ selection, ids: null, pending: true, error: "" });
    // StrictMode's discarded setup must not start an uncancellable native read.
    void Promise.resolve()
      .then(() => (current ? backend.historySelectionIDs(selection.query) : undefined))
      .then((ids) => {
        if (!current || !ids) return;
        const excluded = new Set(selection.excludedSessionIds ?? []);
        setPreparation({
          selection,
          ids: Object.freeze(ids.filter((id) => !excluded.has(id))),
          pending: false,
          error: "",
        });
      })
      .catch((cause) => {
        if (!current) return;
        setPreparation({ selection, ids: null, pending: false, error: message(cause) });
      });
    return () => {
      current = false;
    };
  }, [selection, preparationAttempt]);

  async function queue() {
    if (submitting.current || preparing || preparationError || !frozenIds?.length) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const queued = await backend.queueBulkText({
        selection: {
          sessionIds: [...frozenIds],
          allMatching: false,
          query: "",
          excludedSessionIds: [],
        },
        action,
        promptId: action === "output" ? selected : "",
        replaceTitles,
      });
      toastManager.add({
        type: "success",
        title: queued ? t("bulkText.queued", { count: queued }) : t("bulkText.nothingToQueue"),
      });
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent finalFocus={returnFocus} showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            {action === "title" ? t("bulkText.generateTitles") : t("bulkText.runPromptOrChain")}
          </DialogTitle>
          <DialogDescription aria-busy={preparing}>
            {preparing
              ? t("bulkText.preparingSelection")
              : frozenIds
                ? t("bulkText.selected", { count: frozenIds.length })
                : null}{" "}
            {action === "title" ? t("bulkText.titleHelp") : t("bulkText.outputHelp")}
          </DialogDescription>
        </DialogHeader>
        {action === "title" ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={replaceTitles}
              disabled={pending}
              onCheckedChange={setReplaceTitles}
            />
            {t("bulkText.replaceTitles")}
          </label>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="bulk-text-prompt">{t("bulkText.promptOrChain")}</Label>
            <ProcessingCombobox
              id="bulk-text-prompt"
              options={options}
              value={validPrompt ? selected : null}
              disabled={pending || !configured || !options.length}
              onValueChange={setSelected}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("bulkText.queueHelp")}</p>
        {!configured && (
          <Link
            to="/prompts?section=models"
            onClick={onClose}
            className="text-sm text-primary underline underline-offset-4"
          >
            {t("generatedOutputs.setUpTextModel")}
          </Link>
        )}
        {preparationError && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {nativeText(preparationError)}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setPreparationAttempt((old) => old + 1)}
            >
              {t("common.retry")}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {nativeText(error)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={
              pending ||
              preparing ||
              !!preparationError ||
              !frozenIds?.length ||
              !configured ||
              (action === "output" && !validPrompt)
            }
            onClick={() => void queue()}
          >
            {pending ? t("bulkText.adding") : t("bulkText.addToQueue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
