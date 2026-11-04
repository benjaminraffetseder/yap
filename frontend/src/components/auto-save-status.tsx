import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        role="status"
        className={`flex items-center gap-1.5 text-xs ${status === "failed" || (status === "blocked" && reason) ? "text-destructive" : "text-muted-foreground"}`}
      >
        {status === "failed" ? (
          t("autoSaveStatus.changesNotSaved")
        ) : status === "blocked" ? (
          t("autoSaveStatus.notSavedYet", {
            available: reason || t("autoSaveStatus.waiting"),
          })
        ) : status === "waiting" ? (
          t("autoSaveStatus.savesWhenYouLeaveTheField")
        ) : status === "saving" ? (
          <>
            <Loader2
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            {t("autoSaveStatus.saving")}
          </>
        ) : (
          <>
            <Check aria-hidden="true" className="size-3.5" />
            {t("autoSaveStatus.changesSaveAutomatically")}
          </>
        )}
      </span>
      {(status === "failed" || showDiscard) && (
        <Button variant="ghost" disabled={disabled} onClick={discard}>
          {t("autoSaveStatus.discardChanges")}
        </Button>
      )}
      {status === "failed" && (
        <Button variant="outline" disabled={disabled} onClick={() => void retry()}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}
