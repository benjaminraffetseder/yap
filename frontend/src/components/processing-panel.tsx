import { Activity, CircleAlert, Loader2, Minus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { BulkTextQueue } from "@/components/bulk-text-queue";
import { ImportQueue } from "@/components/import-queue/import-queue";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nativeText } from "@/i18n/native-text";
import { backend } from "@/lib/backend";
import { processingActivity } from "@/lib/processing-activity";
import { cn } from "@/lib/utils";

export function ProcessingPanelToggle({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const { snapshot, processingPanelOpen, setProcessingPanelOpen } = useDictation();
  const { pending, failed } = processingActivity(snapshot);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" />}
        id="processing-activity-toggle"
        aria-label={t("processing.activity")}
        aria-description={
          pending
            ? t("processing.pendingCount", { count: pending })
            : failed
              ? t("bulkText.failedCount", { count: failed })
              : undefined
        }
        aria-expanded={processingPanelOpen}
        aria-controls="processing-activity-panel"
        onClick={() => setProcessingPanelOpen(!processingPanelOpen)}
        className={cn(
          "relative w-full flex-col gap-1 rounded-lg px-1 text-muted-foreground",
          compact ? "h-[44px]" : "h-14",
          processingPanelOpen && "bg-accent text-foreground",
        )}
      >
        <span className="relative">
          {pending ? (
            <Loader2
              aria-hidden="true"
              className="size-5 animate-spin motion-reduce:animate-none"
            />
          ) : failed ? (
            <CircleAlert aria-hidden="true" className="size-5 text-destructive" />
          ) : (
            <Activity aria-hidden="true" className="size-5" />
          )}
          {!!(pending || failed) && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-2 min-w-3.5 rounded-full bg-primary px-0.5 text-center text-[9px] leading-3.5 text-primary-foreground tabular-nums"
            >
              {Math.min(99, pending || failed)}
            </span>
          )}
        </span>
        <span className={cn("text-xs leading-5", compact && "sr-only")}>
          {t("processing.activityShort")}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">
        {t("processing.activity")}
        {pending ? ` · ${t("processing.pendingCount", { count: pending })}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProcessingPanel() {
  const { t } = useTranslation();
  const { snapshot, processingPanelOpen, setProcessingPanelOpen, run } = useDictation();
  const { current, hasActivity } = processingActivity(snapshot);
  function minimize() {
    setProcessingPanelOpen(false);
    document.getElementById("processing-activity-toggle")?.focus({ preventScroll: true });
  }
  return (
    <section
      id="processing-activity-panel"
      data-slot="processing-panel"
      aria-label={t("processing.activity")}
      hidden={!processingPanelOpen}
      className="fixed top-3 right-3 z-40 flex max-h-[min(26rem,calc(100dvh-var(--history-selection-height,0px)-3rem))] w-72 max-w-[calc(100vw-var(--sidebar-width,0px)-1.5rem)] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          minimize();
        }
      }}
    >
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b px-2.5 py-1">
        <Activity aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">
          {t("processing.activityShort")}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" />}
            aria-label={t("processing.minimize")}
            onClick={minimize}
          >
            <Minus aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{t("processing.minimize")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 divide-y overflow-y-auto overscroll-contain">
        {current && (
          <section aria-label={t("processing.current")} className="space-y-2 p-2.5">
            <div className="flex items-center gap-2">
              <Loader2
                aria-hidden="true"
                className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
              />
              <p role="status" className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">
                {nativeText(current.message)}
              </p>
              <Tooltip>
                <TooltipTrigger
                  render={<Button size="icon-xs" variant="ghost" />}
                  aria-label={t("processing.cancelCurrent")}
                  onClick={() => void run(backend.cancel, false)}
                >
                  <X aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>{t("processing.cancelCurrent")}</TooltipContent>
              </Tooltip>
            </div>
            <Progress
              aria-label={t("processing.current")}
              value={
                current.phase === "downloading"
                  ? Math.min(100, Math.max(0, current.progress * 100))
                  : null
              }
            />
          </section>
        )}
        <BulkTextQueue />
        <ImportQueue />
        {!hasActivity && (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("processing.empty")}</p>
        )}
      </div>
    </section>
  );
}
