import { useDictation } from "@/components/dictation-provider";
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
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import { backend, message, type BackupPreview, type BackupSummary } from "@/lib/backend";
import { Download, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function restoredMessage(summary: BackupSummary) {
  const skipped =
    summary.duplicateSessions +
    summary.duplicateOutputs +
    summary.skippedPrompts +
    (summary.skippedChains ?? 0) +
    summary.skippedVocabulary;
  const chains = summary.chains ? i18n.t("backupPanel.chainsCount", { count: summary.chains }) : "";
  return i18n.t("backupPanel.restoreSummary", {
    sessions: summary.sessions,
    outputs: summary.outputs,
    prompts: summary.prompts,
    chains: chains,
    vocabulary: summary.vocabulary,
    skipped: skipped ? i18n.t("backupPanel.keptCount", { count: skipped }) : "",
  });
}

export function BackupPanel({ disabled, unsaved }: { disabled: boolean; unsaved: boolean }) {
  const { t } = useTranslation();
  const { refresh, snapshot } = useDictation();
  const [audio, setAudio] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [working, setWorking] = useState<"export" | "preview" | "restore" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const previewID = useRef("");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (previewID.current) void backend.discardBackup(previewID.current).catch(() => {});
    };
  }, []);
  async function exportBackup() {
    setWorking("export");
    setError("");
    setNotice("");
    try {
      const result = await backend.exportBackup(audio);
      if (active.current && result)
        setNotice(
          t("backupPanel.backupSavedDictationsOutputsAndRecordings", {
            sessions: result.sessions,
            outputs: result.outputs,
            recordings: result.recordings,
            omitted: result.missingRecordings
              ? t("backupPanel.omittedCount", { count: result.missingRecordings })
              : "",
          }),
        );
    } catch (cause) {
      if (active.current) setError(message(cause));
    } finally {
      if (active.current) setWorking(null);
    }
  }
  async function chooseBackup() {
    setWorking("preview");
    setError("");
    setNotice("");
    setPreferences(false);
    try {
      const value = await backend.previewBackup();
      if (!active.current) {
        if (value) await backend.discardBackup(value.id);
        return;
      }
      previewID.current = value?.id ?? "";
      setPreview(value);
    } catch (cause) {
      if (active.current) setError(message(cause));
    } finally {
      if (active.current) setWorking(null);
    }
  }
  async function dismiss() {
    if (working) return;
    const id = previewID.current;
    previewID.current = "";
    setPreview(null);
    setError("");
    if (id) {
      try {
        await backend.discardBackup(id);
      } catch (cause) {
        if (active.current) setError(message(cause));
      }
    }
  }
  async function restore() {
    if (!preview || disabled || working) return;
    setWorking("restore");
    setError("");
    try {
      const result = await backend.restoreBackup(preview.id, preferences);
      // Restoration is committed even if refreshing the interface then fails.
      previewID.current = "";
      if (active.current) {
        setPreview(null);
        setNotice(restoredMessage(result));
        await refresh();
      }
    } catch (cause) {
      if (active.current) setError(message(cause));
    } finally {
      if (active.current) setWorking(null);
    }
  }
  const backupRunning = snapshot.status.phase === "backup";
  const operationMessage = backupRunning
    ? snapshot.status.message
    : working === "export"
      ? t("backupPanel.creatingBackup")
      : working === "preview"
        ? t("backupPanel.checkingBackup")
        : t("backupPanel.restoringBackup");
  const blocked = disabled || !!working || backupRunning;
  return (
    <section className="settings-section space-y-4" aria-labelledby="backup-heading">
      <h2 id="backup-heading" className="font-semibold">
        {t("backupPanel.backupRestore")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t("backupPanel.saveHistoryGeneratedOutputsPromptsChainsVocabulary")}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={audio} disabled={blocked} onCheckedChange={setAudio} />
        {t("backupPanel.includeRetainedRecordings")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={blocked} onClick={() => void exportBackup()}>
          {working === "export" ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Download className="size-4" />
          )}
          {t("backupPanel.exportBackup")}
        </Button>
        <Button variant="outline" disabled={blocked} onClick={() => void chooseBackup()}>
          {working === "preview" ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <Upload className="size-4" />
          )}
          {t("backupPanel.restoreBackup")}
        </Button>
      </div>
      {unsaved && (
        <p className="text-xs text-muted-foreground">
          {t("backupPanel.finishSavingSettingsBeforeUsingBackups")}
        </p>
      )}
      {(working || backupRunning) && (
        <div role="status" className="flex items-center gap-3 text-sm">
          <span>{operationMessage}</span>
          {backupRunning && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void backend.cancel().catch((cause) => setError(message(cause)))}
            >
              {t("backupPanel.cancelOperation")}
            </Button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      {error && !preview && (
        <p role="alert" className="text-sm text-destructive">
          {nativeText(error)}
        </p>
      )}
      <Dialog
        open={!!preview}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) void dismiss();
        }}
      >
        <DialogContent
          showCloseButton={!working}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{t("backupPanel.restoreBackup2")}</DialogTitle>
            <DialogDescription>
              {t("backupPanel.newEntriesWillBeAddedExistingDictations")}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <div className="min-w-0 space-y-1">
                <p className="break-all text-sm font-medium">{preview.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(preview.createdAt).toLocaleString(i18n.resolvedLanguage)}
                </p>
              </div>
              <dl className="divide-y rounded-lg border px-4">
                {[
                  ["Dictations", preview.summary.sessions, preview.summary.duplicateSessions],
                  [
                    t("generatedOutputs.generatedOutputs"),
                    preview.summary.outputs,
                    preview.summary.duplicateOutputs,
                  ],
                  [
                    t("chat.conversations"),
                    preview.summary.chats ?? 0,
                    preview.summary.skippedChats ?? 0,
                  ],
                  ["Prompts", preview.summary.prompts, preview.summary.skippedPrompts],
                  [
                    t("promptChainsEditor.promptChains"),
                    preview.summary.chains ?? 0,
                    preview.summary.skippedChains ?? 0,
                  ],
                  [
                    t("backupPanel.vocabularyTerms"),
                    preview.summary.vocabulary,
                    preview.summary.skippedVocabulary,
                  ],
                  ["Recordings", preview.summary.recordings, 0],
                ].map(([label, added, kept]) => (
                  <div
                    key={label}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <dt>{label}</dt>
                    <dd className="text-muted-foreground">
                      {added} {t("backupPanel.toAdd")}
                      {Number(kept) > 0 && (
                        <span>
                          {" "}
                          · {kept} {t("backupPanel.keptSkipped")}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={preferences}
                    disabled={blocked}
                    onCheckedChange={setPreferences}
                  />
                  {t("backupPanel.restorePortablePreferences")}
                </label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("backupPanel.language")}
                  {preview.preferences.language}
                  {t("backupPanel.recordingModeCleanupAutomaticPasteAndKeep")}
                </p>
              </div>
            </>
          )}
          {working === "restore" && (
            <div className="flex items-center gap-3" role="status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              <span className="text-sm">{t("backupPanel.restoringBackup")}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void backend.cancel().catch((cause) => setError(message(cause)))}
              >
                {t("backupPanel.cancelOperation")}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {nativeText(error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={!!working} onClick={() => void dismiss()}>
              {t("common.cancel")}
            </Button>
            <Button disabled={blocked || !preview} onClick={() => void restore()}>
              {t("backupPanel.restoreBackup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
