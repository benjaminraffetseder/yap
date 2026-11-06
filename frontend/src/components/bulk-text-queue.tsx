import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Check, CircleAlert, CircleSlash2, Clock3, Loader2, Trash2, X } from "lucide-react";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nativeText } from "@/i18n/native-text";
import { backend } from "@/lib/backend";

export function BulkTextQueue() {
  const { t } = useTranslation();
  const { snapshot, run } = useDictation();
  const [pending, setPending] = useState(false);
  const jobs = snapshot.bulkTextQueue ?? [];
  if (!jobs.length) return null;
  const states: Record<string, string> = {
    queued: t("bulkText.state.queued"),
    running: t("bulkText.state.running"),
    done: t("bulkText.state.done"),
    failed: t("bulkText.state.failed"),
    cancelled: t("bulkText.state.cancelled"),
  };
  const remaining = jobs.filter((job) => job.state === "queued" || job.state === "running").length;
  const failed = jobs.filter((job) => job.state === "failed").length;
  const finished = jobs.length - remaining;
  async function update(action: () => Promise<void>) {
    setPending(true);
    await run(action, false);
    setPending(false);
  }
  return (
    <section aria-label={t("bulkText.queue")} data-slot="bulk-text-queue" className="min-w-0 p-1.5">
      <div className="flex min-w-0 items-center gap-1 px-1 pb-1">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium">{t("bulkText.title")}</h3>
        <span
          role="status"
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
          title={t("bulkText.progress", { finished, total: jobs.length })}
        >
          {finished}/{jobs.length}
        </span>
        {!!remaining && (
          <Tooltip>
            <TooltipTrigger
              render={<Button size="icon-xs" variant="ghost" />}
              disabled={pending}
              aria-label={t("bulkText.cancelRemaining")}
              onClick={() => void update(backend.cancelBulkTextQueue)}
            >
              <X aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("bulkText.cancelRemaining")}</TooltipContent>
          </Tooltip>
        )}
        {!!finished && (
          <Tooltip>
            <TooltipTrigger
              render={<Button size="icon-xs" variant="ghost" />}
              disabled={pending}
              aria-label={t("importQueue.clearFinished")}
              onClick={() => void update(backend.clearFinishedBulkTextJobs)}
            >
              <Trash2 aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("importQueue.clearFinished")}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {!!failed && (
        <p className="px-1 pb-1 text-[11px] text-destructive">
          {t("bulkText.failedCount", { count: failed })}
        </p>
      )}
      {!!remaining && (
        <Progress
          aria-label={t("bulkText.progress", { finished, total: jobs.length })}
          value={(finished / jobs.length) * 100}
          className="mx-1 mb-1 [&_[data-slot=progress-track]]:h-0.5"
        />
      )}
      <ul
        aria-label={t("bulkText.jobs")}
        className="max-h-48 min-h-0 overflow-y-auto overscroll-contain"
      >
        {jobs.map((job) => (
          <li
            key={job.id}
            className="flex min-w-0 items-start gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-accent/50"
          >
            {job.state === "running" ? (
              <Loader2
                aria-hidden="true"
                className="mt-0.5 size-3 shrink-0 animate-spin motion-reduce:animate-none"
              />
            ) : job.state === "failed" ? (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-destructive" />
            ) : job.state === "done" ? (
              <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-primary" />
            ) : job.state === "cancelled" ? (
              <CircleSlash2
                aria-hidden="true"
                className="mt-0.5 size-3 shrink-0 text-muted-foreground"
              />
            ) : (
              <Clock3 aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                className="block truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                to={`/history/${encodeURIComponent(job.sessionId)}`}
                title={job.name}
              >
                {job.name || t("uiPolish.titlePlaceholder")}
              </Link>
              <div className="flex min-w-0 gap-2 text-[10px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {job.action === "title" ? t("bulkText.generateTitles") : job.prompt}
                </span>
                <span className={job.state === "failed" ? "shrink-0 text-destructive" : "shrink-0"}>
                  {states[job.state] ?? job.state}
                </span>
              </div>
              {job.error && (
                <p className="text-[11px] text-destructive [overflow-wrap:anywhere]">
                  {nativeText(job.error)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
