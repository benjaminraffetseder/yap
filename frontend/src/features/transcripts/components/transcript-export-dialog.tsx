import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  message,
  type TranscriptExportPreview,
  type TranscriptExportSelection,
} from "@/lib/backend";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toastManager } from "@/components/ui/toast";

export function TranscriptExportDialog({
  selection,
  outputID,
  onClose,
  returnFocus,
}: {
  selection: TranscriptExportSelection;
  outputID?: string;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { t, i18n } = useTranslation();
  const [initialSelection] = useState(selection);
  const [preview, setPreview] = useState<TranscriptExportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [working, setWorking] = useState(false);
  const [format, setFormat] = useState("markdown");
  const [packaging, setPackaging] = useState("auto");
  const [transcript, setTranscript] = useState(!outputID);
  const [outputs, setOutputs] = useState(!!outputID);
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void backend
      .exportPreview(initialSelection)
      .then((value) => {
        if (!active) return;
        if (outputID && !value.outputs.some((output) => output.id === outputID)) {
          throw new Error(t("transcriptExport.outputUnavailable"));
        }
        setPreview(value);
        setSelectedOutputs(outputID ? [outputID] : value.outputs.map((output) => output.id));
        setLoading(false);
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
  }, [initialSelection, outputID, reload, t]);

  const single = preview?.sessionIds?.length === 1;
  const transcriptCount = transcript ? (preview?.sessionIds?.length ?? 0) : 0;
  const outputCount = outputs ? (single ? selectedOutputs.length : (preview?.outputCount ?? 0)) : 0;
  const fileCount = transcriptCount + outputCount;
  const destination =
    packaging === "auto" || (packaging === "file" && fileCount !== 1)
      ? fileCount === 1
        ? "file"
        : "zip"
      : packaging;
  const blocked =
    loading ||
    working ||
    !preview ||
    fileCount === 0 ||
    (outputs && single && selectedOutputs.length === 0);
  const outputChoices = (preview?.outputs ?? []).filter(
    (output) => !outputID || output.id === outputID,
  );
  const formatItems = [
    { value: "markdown", label: t("transcriptExport.markdown") },
    { value: "text", label: t("transcriptExport.plainText") },
  ];
  const destinationItems = [
    ...(fileCount === 1 ? [{ value: "file", label: t("transcriptExport.file") }] : []),
    { value: "zip", label: t("transcriptExport.zip") },
    { value: "folder", label: t("transcriptExport.folder") },
  ];

  async function exportFiles() {
    if (blocked || !preview) return;
    setWorking(true);
    setError("");
    try {
      const result = await backend.exportTranscripts({
        sessionIds: preview.sessionIds,
        format,
        destination,
        includeTranscript: transcript,
        includeOutputs: outputs,
        outputIds: single && outputs ? selectedOutputs : [],
      });
      if (result) {
        toastManager.add({
          type: "success",
          title: t("transcriptExport.saved", { count: result.files }),
          description: result.path,
        });
        onClose();
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !working) onClose();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        showCloseButton={!working}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {t(outputID ? "transcriptExport.exportOutput" : "transcriptExport.title")}
          </DialogTitle>
          <DialogDescription>{t("transcriptExport.description")}</DialogDescription>
        </DialogHeader>
        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {t("transcriptExport.loading")}
          </p>
        )}
        {preview && (
          <>
            <div className="space-y-2">
              <Label htmlFor="transcript-export-format">{t("transcriptExport.format")}</Label>
              <Select
                items={formatItems}
                value={format}
                disabled={working}
                onValueChange={(value) => {
                  if (value) setFormat(value);
                }}
              >
                <SelectTrigger id="transcript-export-format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {formatItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!outputID && (
              <fieldset disabled={working} className="space-y-3">
                <legend className="mb-3 text-sm font-medium">
                  {t("transcriptExport.include")}
                </legend>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={transcript}
                    disabled={working}
                    onCheckedChange={setTranscript}
                  />
                  <span>
                    {t("transcriptExport.savedTranscript")}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t("transcriptExport.savedTranscriptHelp")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={outputs}
                    disabled={working || preview.outputCount === 0}
                    onCheckedChange={setOutputs}
                  />
                  <span>
                    {t("transcriptExport.includeOutputs")}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {preview.outputCount
                        ? t("transcriptExport.availableOutputs", { count: preview.outputCount })
                        : t("transcriptExport.noOutputs")}
                    </span>
                  </span>
                </label>
              </fieldset>
            )}
            {single && outputs && outputChoices.length > 0 && (
              <fieldset disabled={working} className="min-w-0 space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  {t("transcriptExport.outputs")}
                </legend>
                {!outputID && outputChoices.length > 1 && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      disabled={working}
                      checked={selectedOutputs.length === outputChoices.length}
                      indeterminate={
                        selectedOutputs.length > 0 && selectedOutputs.length < outputChoices.length
                      }
                      onCheckedChange={(checked) =>
                        setSelectedOutputs(checked ? outputChoices.map((output) => output.id) : [])
                      }
                    />
                    {t("transcriptExport.selectAllOutputs")}
                  </label>
                )}
                <div className="max-h-48 space-y-3 overflow-y-auto rounded-lg border p-3">
                  {outputChoices.map((output) => (
                    <label key={output.id} className="flex items-start gap-2 text-sm">
                      {!outputID && (
                        <Checkbox
                          disabled={working}
                          checked={selectedOutputs.includes(output.id)}
                          onCheckedChange={(checked) =>
                            setSelectedOutputs((old) =>
                              checked ? [...old, output.id] : old.filter((id) => id !== output.id),
                            )
                          }
                        />
                      )}
                      <span className="min-w-0 break-words">
                        <span className="block font-medium">{output.name}</span>
                        {output.chainName && (
                          <span className="block text-xs text-muted-foreground">
                            {output.chainName} · {output.step}/{output.total}
                          </span>
                        )}
                        <time
                          dateTime={output.createdAt}
                          className="block text-xs text-muted-foreground"
                        >
                          {new Date(output.createdAt).toLocaleString(i18n.resolvedLanguage, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="space-y-2">
              <Label htmlFor="transcript-export-destination">
                {t("transcriptExport.destination")}
              </Label>
              <Select
                items={destinationItems}
                value={destination}
                disabled={working}
                onValueChange={(value) => {
                  if (value) setPackaging(value);
                }}
              >
                <SelectTrigger id="transcript-export-destination" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {destinationItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t(
                  destination === "file"
                    ? "transcriptExport.fileHelp"
                    : destination === "folder"
                      ? "transcriptExport.folderHelp"
                      : "transcriptExport.zipHelp",
                )}
              </p>
            </div>
            <p role="status" className="rounded-lg bg-muted/50 p-3 text-sm tabular-nums">
              {t("transcriptExport.summary", {
                transcripts: t("transcriptExport.transcripts", { count: transcriptCount }),
                outputs: t("transcriptExport.outputCount", { count: outputCount }),
                files: t("transcriptExport.files", { count: fileCount }),
              })}
            </p>
          </>
        )}
        {error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{nativeText(error)}</p>
            {!preview && !loading && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError("");
                  setLoading(true);
                  setReload((old) => old + 1);
                }}
              >
                {t("common.retry")}
              </Button>
            )}
          </div>
        )}
        {working && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("transcriptExport.exporting", { count: fileCount })}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={working} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={blocked} onClick={() => void exportFiles()}>
            {working ? (
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Download aria-hidden="true" className="size-4" />
            )}
            {t("historyEntryPage.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
