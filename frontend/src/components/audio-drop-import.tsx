import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy, isDesktop } from "@/lib/backend";
import { OnFileDrop, OnFileDropOff } from "@wails/runtime/runtime";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function AudioDropImport() {
  const { snapshot, loading, run } = useDictation();
  const [dragging, setDragging] = useState(false);
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
    if (
      !isDesktop ||
      typeof Reflect.get(window, "runtime")?.OnFileDrop !== "function"
    )
      return;
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const isFileDrag = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files");
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
          if (current.current.unavailable)
            throw new Error(current.current.unavailable);
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

  if (!dragging) return null;
  return (
    <div
      className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/95"
      role="status"
    >
      <div className="space-y-3 px-6 text-center">
        <Upload className="mx-auto size-10 text-primary" aria-hidden="true" />
        <p className="text-lg font-medium">
          {unavailable || "Drop one audio file to import"}
        </p>
        {!unavailable && (
          <p className="text-sm text-muted-foreground">
            Up to 25 minutes · 256 MiB
          </p>
        )}
      </div>
    </div>
  );
}
