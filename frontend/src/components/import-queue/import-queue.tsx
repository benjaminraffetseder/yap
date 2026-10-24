import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toastManager } from "@/components/ui/toast";
import { backend, importPending, message } from "@/lib/backend";
import { ChevronDown } from "lucide-react";
import { Reorder } from "motion/react";
import { useRef, useState } from "react";
import { ImportQueueFab } from "./import-queue-fab";
import { ImportQueueRow } from "./import-queue-row";

export function ImportQueue({ sidebarWidth }: { sidebarWidth: string }) {
  const { importQueue: jobs, setImportQueueMinimized, run, refresh } = useDictation();
  const [view, setView] = useState<{
    mode: "hidden" | "open" | "minimized";
    ids: string;
    pending: boolean;
  }>({ mode: "hidden", ids: "", pending: false });
  const [order, setOrder] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const draft = useRef<string[] | null>(null);
  const current = useRef(jobs);
  current.current = jobs;
  const pending = jobs.some(importPending);
  const ids = jobs.map((job) => job.id).join(",");
  // Derive batch visibility during render, so a new batch never flashes the FAB.
  if (ids !== view.ids || pending !== view.pending) {
    const oldIds = new Set(view.ids.split(","));
    const added = jobs.some((job) => !oldIds.has(job.id));
    const newBatch = (!view.pending && (added || pending)) || view.mode === "hidden";
    setView({ mode: !jobs.length ? "hidden" : newBatch ? "open" : view.mode, ids, pending });
  }
  const mode = !jobs.length ? "hidden" : view.mode;
  // The provider reads this only on queue events, avoiding render-driven toasts.
  setImportQueueMinimized(mode === "minimized");
  if (mode === "hidden") return null;
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
  const active = jobs.find((job) => importPending(job) && job.state !== "queued");

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
  const minimize = () => setView((value) => ({ ...value, mode: "minimized" }));
  return (
    <>
      <Drawer
        open={mode === "open"}
        onOpenChange={(open) => {
          if (!open) minimize();
        }}
        swipeDirection="down"
        modal={false}
        disablePointerDismissal
        showSwipeHandle
      >
        <DrawerContent
          initialFocus={false}
          finalFocus={false}
          // The portal is outside the layout, so pass its sidebar width explicitly.
          style={{ left: sidebarWidth, width: `min(32rem, calc(100% - ${sidebarWidth} - 2rem))` }}
          className="import-queue-drawer mx-auto max-h-[40vh] rounded-xl border shadow-lg [--drawer-inset:1rem] after:hidden"
        >
          <DrawerHeader className="flex-row items-center justify-between gap-2 pb-2 text-left">
            <div className="min-w-0">
              <DrawerTitle>
                Imports · {Math.min(jobs.length, finished + (active ? 1 : 0))} of {jobs.length}
              </DrawerTitle>
              <DrawerDescription className="sr-only">
                Audio imports run one at a time and yield to dictation between files.
              </DrawerDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!finished}
                onClick={() => void run(backend.clearFinishedImports, false)}
              >
                Clear finished
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Minimize import queue"
                onClick={minimize}
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
          </DrawerHeader>
          <Reorder.Group
            axis="y"
            values={localOrder}
            onReorder={(value) => {
              draft.current = value;
              setOrder(value);
            }}
            layoutScroll
            className="min-h-0 overflow-y-auto px-2 pb-2"
            aria-label="Import files"
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
        </DrawerContent>
      </Drawer>
      {mode === "minimized" && (
        <ImportQueueFab
          jobs={jobs}
          onOpen={() => setView((value) => ({ ...value, mode: "open" }))}
        />
      )}
    </>
  );
}
