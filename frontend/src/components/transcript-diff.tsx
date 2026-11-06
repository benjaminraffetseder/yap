import { useTranslation } from "react-i18next";
import { transcriptDiff } from "@/lib/transcript-diff";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useRef, useState } from "react";

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
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ before, after, active: -1 });
  const active = selection.before === before && selection.after === after ? selection.active : -1;
  const changes = useMemo(() => {
    const starts = new Set<number>();
    let withinChange = false;
    parts.forEach((part, index) => {
      if (part.kind === "same") {
        if (part.text.trim()) withinChange = false;
      } else if (!withinChange) {
        starts.add(index);
        withinChange = true;
      }
    });
    return starts;
  }, [parts]);
  const selectedChange = active >= 0 ? [...changes][active] : undefined;
  function move(direction: number) {
    const targets = root.current?.querySelectorAll<HTMLElement>("[data-diff-change]");
    if (!targets?.length) return;
    const next =
      active < 0
        ? direction > 0
          ? 0
          : targets.length - 1
        : (active + direction + targets.length) % targets.length;
    setSelection({ before, after, active: next });
    targets[next].focus({ preventScroll: true });
    targets[next].scrollIntoView({ block: "center", behavior: "instant" });
  }
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
    <div ref={root} className="space-y-5">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-background py-2">
        <div
          className="flex flex-wrap gap-4 text-xs text-muted-foreground"
          aria-label={t("transcriptDiff.changeLegend")}
        >
          <span>
            <span className="rounded bg-rose-500/15 px-1 text-rose-800 line-through dark:text-rose-300">
              {t("transcriptDiff.removed")}
            </span>
          </span>
          <span>
            <span className="rounded bg-emerald-500/15 px-1 text-emerald-800 underline decoration-2 underline-offset-4 dark:text-emerald-300">
              {t("transcriptDiff.added")}
            </span>
          </span>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span role="status">
            {active < 0
              ? t("uiPolish.changeCount", { count: changes.size })
              : t("uiPolish.changePosition", { current: active + 1, count: changes.size })}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-label={t("uiPolish.previousChange")}
            className="h-auto min-h-8 max-w-full whitespace-normal text-foreground"
            onClick={() => move(-1)}
          >
            <ChevronUp aria-hidden="true" />
            {t("uiPolish.previous")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={t("uiPolish.nextChange")}
            className="h-auto min-h-8 max-w-full whitespace-normal text-foreground"
            onClick={() => move(1)}
          >
            <ChevronDown aria-hidden="true" />
            {t("common.next")}
          </Button>
        </div>
      </div>
      <div
        className={cn("whitespace-pre-wrap wrap-anywhere text-base leading-7", className)}
        aria-label={t("transcriptDiff.textChanges")}
      >
        {parts.map((part, index) =>
          part.kind === "removed" ? (
            <del
              key={index}
              data-diff-change={changes.has(index) || undefined}
              data-active-change={selectedChange === index || undefined}
              aria-current={selectedChange === index ? "true" : undefined}
              tabIndex={changes.has(index) ? -1 : undefined}
              className="rounded-sm bg-rose-500/15 px-0.5 text-rose-800 decoration-rose-500/70 data-[active-change=true]:outline-2 data-[active-change=true]:outline-offset-2 data-[active-change=true]:outline-ring focus:outline-2 focus:outline-offset-2 focus:outline-ring dark:text-rose-300"
            >
              <span className="sr-only">{t("transcriptDiff.removed2")} </span>
              {part.text}
            </del>
          ) : part.kind === "added" ? (
            <ins
              key={index}
              data-diff-change={changes.has(index) || undefined}
              data-active-change={selectedChange === index || undefined}
              aria-current={selectedChange === index ? "true" : undefined}
              tabIndex={changes.has(index) ? -1 : undefined}
              className="rounded-sm bg-emerald-500/15 px-0.5 text-emerald-800 decoration-emerald-500/70 decoration-2 underline-offset-4 data-[active-change=true]:outline-2 data-[active-change=true]:outline-offset-2 data-[active-change=true]:outline-ring focus:outline-2 focus:outline-offset-2 focus:outline-ring dark:text-emerald-300"
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
