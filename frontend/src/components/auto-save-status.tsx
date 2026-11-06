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
  compact = false,
}: {
  status: AutoSaveState;
  reason?: string;
  retry: () => unknown;
  discard: () => void;
  disabled?: boolean;
  showDiscard?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div data-slot="auto-save-status" className="flex flex-wrap items-center gap-2">
      <span
        role="status"
        title={
          compact && status === "saved" ? t("autoSaveStatus.changesSaveAutomatically") : undefined
        }
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
            <span data-slot="saved-state-label">
              {compact ? t("uiPolish.saved") : t("autoSaveStatus.changesSaveAutomatically")}
            </span>
          </>
        )}
      </span>
      {(status === "failed" || showDiscard) && (
        <div
          data-slot="save-recovery-actions"
          className="flex max-w-full flex-wrap items-center gap-2"
        >
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            aria-label={t("autoSaveStatus.discardChanges")}
            title={compact ? t("autoSaveStatus.discardChanges") : undefined}
            disabled={disabled}
            onClick={discard}
          >
            {compact ? t("uiPolish.discardShort") : t("autoSaveStatus.discardChanges")}
          </Button>
          {status === "failed" && (
            <Button
              variant="default"
              size={compact ? "sm" : "default"}
              aria-label={t("common.retry")}
              title={compact ? t("common.retry") : undefined}
              disabled={disabled}
              onClick={() => void retry()}
            >
              {compact ? t("uiPolish.retryShort") : t("common.retry")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
