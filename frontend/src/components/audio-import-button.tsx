import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { backend, isBusy, isDesktop } from "@/lib/backend";
import { Upload } from "lucide-react";
import { useState } from "react";

export function AudioImportButton() {
  const { snapshot, loading, run } = useDictation();
  const [pending, setPending] = useState(false);
  async function importAudio() {
    setPending(true);
    try {
      await run(backend.importAudio);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        title="WAV, MP3, M4A, AAC, FLAC, OGG, Opus, AIFF, WMA · up to 25 minutes · 256 MiB"
        disabled={
          !isDesktop ||
          loading ||
          !snapshot.ready ||
          isBusy(snapshot.status.phase) ||
          pending
        }
        onClick={() => void importAudio()}
      >
        <Upload className="size-4" />
        Import audio
      </Button>
      {snapshot.status.phase === "downloading" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span role="status">
            {snapshot.status.message}{" "}
            {Math.round(snapshot.status.progress * 100)}%
          </span>
          <progress
            aria-label="Download progress"
            className="h-2 w-24 accent-[var(--primary)]"
            max={1}
            value={snapshot.status.progress}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run(backend.cancel, false)}
          >
            Cancel download
          </Button>
        </div>
      )}
    </div>
  );
}
