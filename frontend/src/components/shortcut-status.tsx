import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { backend, isBusy, isDesktop } from "@/lib/backend";
import { useState } from "react";

export function ShortcutStatus({
  disabled = false,
  profile = false,
}: {
  disabled?: boolean;
  profile?: boolean;
}) {
  const { snapshot, run } = useDictation();
  const [pending, setPending] = useState(false);
  const error = profile ? snapshot.status.profileShortcutError : snapshot.status.shortcutError;
  if (!error) return null;
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
        {error}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || pending || !isDesktop || isBusy(snapshot.status.phase)}
        onClick={() => void retry()}
      >
        {pending ? "Retrying…" : profile ? "Retry profile shortcut" : "Retry shortcut"}
      </Button>
    </div>
  );
}
