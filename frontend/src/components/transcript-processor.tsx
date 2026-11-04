import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy } from "@/lib/backend";
import { useTextRequest } from "@/lib/use-text-request";
import { TextPanel } from "@/components/text-panel";
import { MarkdownContent } from "@/components/markdown-content";

export function TranscriptProcessor({
  input,
  onCancel,
  onUse,
}: {
  input: string;
  onCancel: () => void;
  onUse: (result: string) => void;
}) {
  const { t } = useTranslation();
  const { snapshot } = useDictation();
  const { prompts } = snapshot.textProcessing;
  const [selected, setSelected] = useState(prompts[0]?.id ?? "");
  const generation = useTextRequest();
  const select = useRef<HTMLButtonElement>(null);
  const options = prompts.map((prompt) => ({ value: prompt.id, label: prompt.name }));
  useEffect(() => {
    select.current?.focus();
  }, []);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("transcriptProcessor.processTranscript")}</DialogTitle>
        <DialogDescription>
          {t("transcriptProcessor.reviewTheGeneratedResultBeforeReplacingYour")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="process-prompt">{t("promptChainsEditor.prompt")}</Label>
        <Select
          items={options}
          value={selected || null}
          disabled={generation.pending}
          onValueChange={(value) => {
            if (value !== null) {
              setSelected(value);
              generation.clear();
            }
          }}
        >
          <SelectTrigger
            ref={select}
            id="process-prompt"
            className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"
          >
            <SelectValue placeholder={t("generatedOutputs.chooseAPrompt")} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {generation.pending ? (
        <div className="flex items-center gap-3" role="status">
          <span className="text-sm">{t("transcriptProcessor.processing")}</span>
          <Button variant="outline" onClick={() => void generation.cancel()}>
            {t("transcriptProcessor.cancelProcessing")}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          disabled={!selected || isBusy(snapshot.status.phase)}
          onClick={() => void generation.request((id) => backend.processText(id, input, selected))}
        >
          {generation.result
            ? t("transcriptProcessor.generateAgain")
            : t("transcriptProcessor.generatePreview")}
        </Button>
      )}
      <div className="grid items-start gap-4 md:grid-cols-2">
        <TextPanel
          title={t("generatedOutputs.inputText")}
          kind="source"
          description={t("transcriptProcessor.currentDraft")}
        >
          <MarkdownContent className="max-h-[40vh] overflow-y-auto">{input}</MarkdownContent>
        </TextPanel>
        <TextPanel
          title={t("homeResultPanel.generatedResult")}
          kind="result"
          description={prompts.find((prompt) => prompt.id === selected)?.name}
        >
          {generation.result ? (
            <MarkdownContent className="max-h-[40vh] overflow-y-auto">
              {generation.result}
            </MarkdownContent>
          ) : (
            <p className="text-sm text-muted-foreground">
              {generation.pending
                ? t("transcriptProcessor.generatingResult")
                : t("transcriptProcessor.generateAPreviewToSeeTheResult")}
            </p>
          )}
        </TextPanel>
      </div>
      {generation.error && (
        <p role="alert" className="text-sm text-destructive">
          {generation.error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("transcriptProcessor.backToTranscript")}
        </Button>
        <Button
          disabled={!generation.result || generation.pending}
          onClick={() => onUse(generation.result)}
        >
          {t("transcriptProcessor.replaceDraft")}
        </Button>
      </DialogFooter>
    </>
  );
}
