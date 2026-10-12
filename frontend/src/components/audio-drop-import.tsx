import { useMotionPreference } from "@/lib/use-motion-preference";
import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy, isDesktop } from "@/lib/backend";
import { OnFileDrop, OnFileDropOff } from "@wails/runtime/runtime";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MotionReveal } from "@/components/motion-reveal";
import { fade } from "@/lib/motion";

export function AudioDropImport() {
  const { snapshot, loading, run } = useDictation();
  const [dragging, setDragging] = useState(false);
  const reduced = useMotionPreference();
  const pending = useRef(false);
  const unavailable = loading
    ? "Wait for Yap to finish loading"
    : !snapshot.ready
      ? "Choose a speech model before importing audio"
      : isBusy(snapshot.status.phase)
        ? "Finish the current operation before importing audio"
        : "";
  const current = useRef({ unavailable, run });
  current.current = { unavailable, run };

  useEffect(() => {
    if (!isDesktop || typeof Reflect.get(window, "runtime")?.OnFileDrop !== "function") return;
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer)
        event.dataTransfer.dropEffect =
          current.current.unavailable || pending.current ? "none" : "copy";
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      reset();
    };
    OnFileDrop((_x, _y, paths) => {
      reset();
      if (pending.current) return;
      pending.current = true;
      void current.current
        .run(async () => {
          if (current.current.unavailable) throw new Error(current.current.unavailable);
          await backend.importDroppedAudio(paths);
        })
        .finally(() => {
          pending.current = false;
        });
    }, false);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("blur", reset);
    return () => {
      OnFileDropOff();
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          key="audio-drop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: fade(reduced, 0.1) }}
          transition={fade(reduced)}
          className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95"
          role="status"
        >
          <MotionReveal
            preset="drop"
            from="translateY(8px) scale(0.96)"
            rest="translateY(0px) scale(1)"
            className="space-y-3 px-6 text-center"
          >
            <Upload className="mx-auto size-10 text-primary" aria-hidden="true" />
            <p className="text-lg font-medium">{unavailable || "Drop one audio file to import"}</p>
            {!unavailable && (
              <p className="text-sm text-muted-foreground">Up to 25 minutes · 256 MiB</p>
            )}
          </MotionReveal>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
