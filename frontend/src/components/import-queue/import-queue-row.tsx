import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import i18n from "@/i18n";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { backend, importPending, type ImportJob } from "@/lib/backend";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { ArrowUpRight, Copy, GripVertical, RotateCcw, X } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { Link } from "react-router";

function importLabel(job: ImportJob) {
  if (job.message === "Cancelling…") return nativeText(job.message);
  if (job.state === "transcribing")
    return job.progress < 0
      ? i18n.t("importQueueRow.transcribing")
      : i18n.t("importQueueRow.transcriptionProgress", { percent: Math.round(job.progress) });
  return nativeText(job.error || job.message || job.state);
}

export function ImportQueueRow({
  job,
  onDrop,
  onMove,
  reorderDisabled,
}: {
  job: ImportJob;
  onDrop: () => void;
  onMove: (id: string, direction: number) => void;
  reorderDisabled: boolean;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  const { run } = useDictation();
  const reduced = useMotionPreference();
  const queued = job.state === "queued";
  const pending = importPending(job);
  const content = (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("importQueueRow.reorder", { name: job.name })}
        aria-description={t("importQueueRow.useAltArrowUpOrAltArrowDownToMove")}
        disabled={!queued || reorderDisabled}
        focusableWhenDisabled={queued}
        className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          event.stopPropagation();
          if (queued && !reorderDisabled) controls.start(event);
        }}
        onKeyDown={(event) => {
          if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            onMove(job.id, event.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        <GripVertical className="size-4" />
      </Button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-sm font-medium" title={job.name}>
          {job.name}
        </p>
        <p
          className={`truncate text-xs ${job.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          title={importLabel(job)}
        >
          {importLabel(job)}
        </p>
        {pending && job.state !== "queued" && (
          <Progress
            className="h-1"
            aria-label={t("importQueueRow.progressFor", { name: job.name })}
            value={job.progress < 0 ? null : job.progress}
          />
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-1"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {job.transcript && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("importQueueRow.copy", { name: job.name })}
            onClick={() => void run(() => backend.copy(job.transcript), false)}
          >
            <Copy className="size-4" />
          </Button>
        )}
        {job.sessionId && (
          <Button
            size="icon-sm"
            variant="ghost"
            render={<Link to={`/history/${job.sessionId}`} />}
            aria-label={t("importQueueRow.open", { name: job.name })}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        )}
        {(job.state === "failed" || job.state === "cancelled") && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("importQueueRow.retry", { name: job.name })}
            onClick={() => void run(() => backend.retryImport(job.id), false)}
          >
            <RotateCcw className="size-4" />
          </Button>
        )}
        {pending && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${queued ? t("common.remove") : t("common.cancel")} ${job.name}`}
            onClick={() => void run(() => backend.removeImport(job.id), false)}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </>
  );
  const className =
    "relative flex items-center gap-2 rounded-lg border border-transparent bg-popover px-2 py-3";
  return queued ? (
    <Reorder.Item
      value={job.id}
      dragListener={false}
      dragControls={controls}
      drag={reorderDisabled ? false : "y"}
      onDragEnd={onDrop}
      layout={reduced ? undefined : true}
      transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.22, bounce: 0 }}
      className={className}
      data-testid={`import-row-${job.id}`}
    >
      {content}
    </Reorder.Item>
  ) : (
    <li className={className} data-testid={`import-row-${job.id}`}>
      {content}
    </li>
  );
}
