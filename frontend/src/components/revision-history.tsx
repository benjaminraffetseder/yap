import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { TranscriptDiff } from "@/components/transcript-diff";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  backend,
  message,
  type PromptChain,
  type Revision,
  type RevisionKind,
  type TextPrompt,
  type VocabularyEntry,
} from "@/lib/backend";
import { useEffect, useState } from "react";

function preview(kind: RevisionKind, value: string, prompts: TextPrompt[]): string {
  if (kind === "transcript") return value;
  const parsed = JSON.parse(value);
  if (kind === "prompt") return `${parsed.name}\n\n${parsed.instruction}`;
  if (kind === "vocabulary")
    return (
      (parsed as VocabularyEntry[])
        .map(
          (entry) =>
            `${entry.canonical}${entry.enabled ? "" : i18n.t("revisionHistory.disabled")}${entry.aliases.length ? ` — ${entry.aliases.join(", ")}` : ""}`,
        )
        .join("\n") || i18n.t("revisionHistory.emptyVocabulary")
    );
  const chain = parsed as PromptChain;
  return `${chain.name}\n\n${chain.steps
    .map((step, index) => {
      const source =
        step.input === "original"
          ? i18n.t("historyEntryPage.originalTranscription")
          : step.input === "transcript"
            ? i18n.t("generatedOutputs.savedTranscript")
            : i18n.t("revisionHistory.stepLabel", {
                step: chain.steps.findIndex((item) => item.id === step.input.slice(5)) + 1,
              });
      return `${index + 1}. ${prompts.find((prompt) => prompt.id === step.promptId)?.name ?? i18n.t("revisionHistory.unavailablePrompt")} · ${source}`;
    })
    .join("\n")}`;
}
function same(kind: RevisionKind, left: string, right: string) {
  if (kind === "transcript") return left === right;
  try {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));
  } catch {
    return left === right;
  }
}
function relative(stamp: string) {
  const seconds = Math.round((Date.parse(stamp) - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return format.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
}

export function RevisionHistory({
  kind,
  itemId,
  title,
  current,
  onClose,
  onRestore,
  validate,
  prompts = [],
}: {
  kind: RevisionKind;
  itemId: string;
  title: string;
  current: string;
  onClose: () => void;
  onRestore: (value: string) => void;
  validate?: (value: string) => string;
  prompts?: TextPrompt[];
}) {
  const { t } = useTranslation();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void backend
      .revisions(kind, itemId)
      .then((values) => {
        if (active) {
          setRevisions(values);
          setSelected(values[0] ?? null);
        }
      })
      .catch((cause) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind, itemId, request]);
  let before = "",
    after = "",
    reason = "";
  if (selected) {
    try {
      before = preview(kind, current, prompts);
      after = preview(kind, selected.value, prompts);
      reason = validate?.(selected.value) ?? "";
    } catch {
      reason = t("revisionHistory.thisVersionCannotBeRead");
    }
  }
  const isCurrent = !!selected && same(kind, current, selected.value);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t("revisionHistory.previewAnEarlierVersionAndRestoreIt")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p role="status">{t("revisionHistory.loadingVersions")}</p>
        ) : error ? (
          <div>
            <p role="alert" className="text-sm text-destructive">
              {nativeText(error)}
            </p>
            <Button variant="outline" onClick={() => setRequest((value) => value + 1)}>
              {t("common.retry")}
            </Button>
          </div>
        ) : !revisions.length ? (
          <p className="text-sm text-muted-foreground">
            {t("revisionHistory.noEarlierVersionsYetHistoryStartsWith")}
          </p>
        ) : (
          <div className="grid min-h-0 gap-4 overflow-y-auto md:grid-cols-[12rem_minmax(0,1fr)]">
            <nav aria-label={t("revisionHistory.versions")} className="space-y-1">
              {revisions.map((revision) => (
                <button
                  key={revision.id}
                  type="button"
                  aria-pressed={revision.id === selected?.id}
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
                  onClick={() => setSelected(revision)}
                >
                  <time
                    dateTime={revision.updatedAt}
                    title={new Date(revision.updatedAt).toLocaleString(i18n.resolvedLanguage)}
                  >
                    {relative(revision.updatedAt)}
                  </time>
                  {same(kind, current, revision.value) && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("revisionHistory.current")}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <section aria-label={t("revisionHistory.versionPreview")} className="min-w-0 space-y-3">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                {after}
              </pre>
              {(kind === "transcript" || kind === "prompt") && (
                <div className="rounded-md border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {t("revisionHistory.currentSelectedVersion")}
                  </p>
                  <TranscriptDiff before={before} after={after} />
                </div>
              )}
              {reason && (
                <p role="alert" className="text-sm text-destructive">
                  {reason}
                </p>
              )}
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            disabled={!selected || loading || !!error || isCurrent || !!reason}
            onClick={() => {
              if (selected && !reason) {
                onRestore(selected.value);
                onClose();
              }
            }}
          >
            {t("revisionHistory.restoreVersion")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
