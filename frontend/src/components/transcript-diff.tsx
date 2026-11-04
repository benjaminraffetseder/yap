import { useTranslation } from "react-i18next";
import { transcriptDiff } from "@/lib/transcript-diff";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function TranscriptDiff({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const parts = useMemo(() => transcriptDiff(before, after), [before, after]);
  if (before === after)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="font-medium">{t("transcriptDiff.noChanges")}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("transcriptDiff.theTwoVersionsAreIdentical")}
        </p>
      </div>
    );
  return (
    <div className="space-y-5">
      <div
        className="flex flex-wrap gap-4 text-xs text-muted-foreground"
        aria-label={t("transcriptDiff.changeLegend")}
      >
        <span>
          <span className="rounded bg-rose-500/15 px-1 text-rose-700 line-through dark:text-rose-300">
            {t("transcriptDiff.removed")}
          </span>
        </span>
        <span>
          <span className="rounded bg-emerald-500/15 px-1 text-emerald-700 underline decoration-2 underline-offset-4 dark:text-emerald-300">
            {t("transcriptDiff.added")}
          </span>
        </span>
      </div>
      <div
        className={cn("whitespace-pre-wrap wrap-anywhere text-base leading-8", className)}
        aria-label={t("transcriptDiff.textChanges")}
      >
        {parts.map((part, index) =>
          part.kind === "removed" ? (
            <del
              key={index}
              className="rounded-sm bg-rose-500/15 px-0.5 text-rose-700 decoration-rose-500/70 dark:text-rose-300"
            >
              <span className="sr-only">{t("transcriptDiff.removed2")} </span>
              {part.text}
            </del>
          ) : part.kind === "added" ? (
            <ins
              key={index}
              className="rounded-sm bg-emerald-500/15 px-0.5 text-emerald-700 decoration-emerald-500/70 decoration-2 underline-offset-4 dark:text-emerald-300"
            >
              <span className="sr-only">{t("transcriptDiff.added2")} </span>
              {part.text}
            </ins>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </div>
    </div>
  );
}
