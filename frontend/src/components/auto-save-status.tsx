import { Button } from "@/components/ui/button";
import type { AutoSaveState } from "@/lib/use-auto-save";
import { Check, Loader2 } from "lucide-react";

export function AutoSaveStatus({
  status,
  reason,
  retry,
  discard,
  disabled = false,
  showDiscard = false,
}: {
  status: AutoSaveState;
  reason?: string;
  retry: () => unknown;
  discard: () => void;
  disabled?: boolean;
  showDiscard?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        role="status"
        className={`flex items-center gap-1.5 text-xs ${status === "failed" || (status === "blocked" && reason) ? "text-destructive" : "text-muted-foreground"}`}
      >
        {status === "failed" ? (
          "Changes not saved"
        ) : status === "blocked" ? (
          `Not saved yet: ${reason || "waiting until saving is available"}`
        ) : status === "waiting" ? (
          "Saves when you leave the field"
        ) : status === "saving" ? (
          <>
            <Loader2
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Saving…
          </>
        ) : (
          <>
            <Check aria-hidden="true" className="size-3.5" />
            Changes save automatically
          </>
        )}
      </span>
      {(status === "failed" || showDiscard) && (
        <Button variant="ghost" disabled={disabled} onClick={discard}>
          Discard changes
        </Button>
      )}
      {status === "failed" && (
        <Button variant="outline" disabled={disabled} onClick={() => void retry()}>
          Retry
        </Button>
      )}
    </div>
  );
}
