import { useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useDictation } from "@/components/dictation-provider";
import { ProcessingSelectItems } from "@/components/processing-select-items";
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
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  message,
  processingOptions,
  type BulkTextRequest,
  type TranscriptExportSelection,
} from "@/lib/backend";

export function BulkTextDialog({
  action,
  selection,
  count,
  returnFocus,
  onClose,
}: {
  action: BulkTextRequest["action"];
  selection: TranscriptExportSelection;
  count: number;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { snapshot } = useDictation();
  const options = processingOptions(snapshot.textProcessing);
  const [selected, setSelected] = useState(options[0]?.value ?? "");
  const [replaceTitles, setReplaceTitles] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const configured = snapshot.textProcessing.enabled && !!snapshot.textProcessing.model.trim();
  const validPrompt = options.some((option) => option.value === selected);

  async function queue() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const queued = await backend.queueBulkText({
        selection,
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
          <DialogDescription>
            {t("bulkText.selected", { count })}{" "}
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
            <Select
              items={options}
              value={validPrompt ? selected : null}
              disabled={pending || !configured || !options.length}
              onValueChange={(value) => {
                if (value) setSelected(value);
              }}
            >
              <SelectTrigger id="bulk-text-prompt" className="w-full">
                <SelectValue placeholder={t("generatedOutputs.chooseAPrompt")} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <ProcessingSelectItems options={options} />
              </SelectContent>
            </Select>
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
            disabled={pending || !configured || (action === "output" && !validPrompt)}
            onClick={() => void queue()}
          >
            {pending ? t("bulkText.adding") : t("bulkText.addToQueue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
