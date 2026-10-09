import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDictation } from "@/components/dictation-provider";
import { backend, isBusy, isDesktop } from "@/lib/backend";

export function ShortcutStatus({ disabled = false }: { disabled?: boolean }) {
  const { snapshot, run } = useDictation();
  const [pending, setPending] = useState(false);
  if (!snapshot.status.shortcutError) return null;
  async function retry() {
    setPending(true);
    try {
      await run(backend.retryShortcut);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-2 space-y-2">
      <p role="alert" className="text-xs text-destructive">
        {snapshot.status.shortcutError}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || pending || !isDesktop || isBusy(snapshot.status.phase)}
        onClick={() => void retry()}
      >
        {pending ? "Retrying…" : "Retry shortcut"}
      </Button>
    </div>
  );
}
