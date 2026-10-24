import { Button } from "@/components/ui/button";
import { CircularProgress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { importPending, type ImportJob } from "@/lib/backend";
import { motionTransition } from "@/lib/motion";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { AudioLines } from "lucide-react";
import { motion } from "motion/react";

export function ImportQueueFab({ jobs, onOpen }: { jobs: ImportJob[]; onOpen: () => void }) {
  const reduced = useMotionPreference();
  const pending = jobs.filter(importPending);
  const active = pending.find((job) => job.state !== "queued");
  const queued = pending.filter((job) => job.state === "queued").length;
  const status = active
    ? `${active.state === "transcribing" ? "Transcribing" : active.message} ${active.name}${active.progress >= 0 ? ` · ${Math.round(active.progress)}%` : ""} · ${queued} queued`
    : queued
      ? "Waiting for dictation to finish"
      : "Imports finished";
  return (
    <motion.div
      initial={{ opacity: 0, transform: reduced ? "none" : "scale(0.95)" }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      transition={motionTransition("output", reduced)}
      className="fixed bottom-6 right-6 z-50 group-has-[[data-slot=history-selection-bar]]/layout:bottom-32"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="relative size-14 rounded-full bg-popover shadow-md dark:bg-popover dark:hover:bg-accent"
            />
          }
          onClick={onOpen}
          aria-label="Open import queue"
        >
          <CircularProgress
            aria-label="Import progress"
            className="absolute -inset-1 size-16"
            value={active && active.progress >= 0 ? active.progress : pending.length ? null : 100}
          />
          <AudioLines className="size-5" />
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-[10px] leading-5 text-primary-foreground">
            {pending.length || jobs.length}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="end">
          {status}
        </TooltipContent>
      </Tooltip>
    </motion.div>
  );
}
