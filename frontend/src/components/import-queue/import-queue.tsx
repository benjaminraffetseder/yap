import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toastManager } from "@/components/ui/toast";
import { backend, importPending, message } from "@/lib/backend";
import { Trash2 } from "lucide-react";
import { Reorder } from "motion/react";
import { useRef, useState } from "react";
import { ImportQueueRow } from "./import-queue-row";

export function ImportQueue() {
  const { t } = useTranslation();
  const { importQueue: jobs, run, refresh } = useDictation();
  const [order, setOrder] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const draft = useRef<string[] | null>(null);
  const current = useRef(jobs);
  current.current = jobs;
  if (!jobs.length) return null;
  const queued = jobs.filter((job) => job.state === "queued");
  const queuedIds = queued.map((job) => job.id);
  const localOrder =
    order && order.length === queuedIds.length && order.every((id) => queuedIds.includes(id))
      ? order
      : queuedIds;
  const byId = new Map(jobs.map((job) => [job.id, job]));
  let next = 0;
  const rows = jobs.map((job) => (job.state === "queued" ? byId.get(localOrder[next++])! : job));
  const finished = jobs.filter((job) => !importPending(job)).length;

  async function commit(nextOrder: string[]) {
    if (saving) return;
    setSaving(true);
    try {
      await backend.reorderImports(nextOrder);
      await refresh();
    } catch (cause) {
      toastManager.add({ type: "error", title: message(cause), timeout: 5000 });
    } finally {
      draft.current = null;
      setOrder(null);
      setSaving(false);
    }
  }
  function move(id: string, direction: number) {
    const index = localOrder.indexOf(id),
      target = index + direction;
    if (saving || target < 0 || target >= localOrder.length) return;
    const result = [...localOrder];
    [result[index], result[target]] = [result[target], result[index]];
    setOrder(result);
    void commit(result);
  }
  return (
    <section aria-label={t("importQueue.imports")} className="min-w-0 p-1.5">
      <div className="flex min-w-0 items-center gap-1 px-1 pb-1">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium">{t("importQueue.imports")}</h3>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {finished}/{jobs.length}
        </span>
        {!!finished && (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-xs" />}
              aria-label={t("importQueue.clearFinished")}
              onClick={() => void run(backend.clearFinishedImports, false)}
            >
              <Trash2 aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{t("importQueue.clearFinished")}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <Reorder.Group
        axis="y"
        values={localOrder}
        onReorder={(value) => {
          draft.current = value;
          setOrder(value);
        }}
        layoutScroll
        className="max-h-56 min-h-0 overflow-y-auto overscroll-contain"
        aria-label={t("importQueue.importFiles")}
      >
        {rows.map((job) => (
          <ImportQueueRow
            key={job.id}
            job={job}
            reorderDisabled={saving}
            onMove={move}
            onDrop={() => {
              const result = draft.current;
              const queuedNow = current.current
                .filter((job) => job.state === "queued")
                .map((job) => job.id);
              if (
                result &&
                result.length === queuedNow.length &&
                result.every((id) => queuedNow.includes(id))
              )
                void commit(result);
              else {
                draft.current = null;
                setOrder(null);
              }
            }}
          />
        ))}
      </Reorder.Group>
    </section>
  );
}
