import { CopyButton } from "@/components/shared/copy-button";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { SessionTitleAction } from "@/features/transcripts/components/session-title-action";
import type { Session } from "@/lib/backend";
import { Pencil, Trash2 } from "lucide-react";
import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const HistoryRowActions = memo(function HistoryRowActions({
  entry,
  disabled,
  onRenamed,
  onRemove,
}: {
  entry: Session;
  disabled: boolean;
  onRenamed: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [renameMounted, setRenameMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex items-center gap-1">
      <CopyButton
        text={entry.finalTranscript ?? entry.rawTranscript}
        label={t("historyPage.copyDictation")}
        iconOnly
        variant="ghost"
        disabled={disabled}
      />
      <ActionMenu
        label={t("uiPolish.dictationActions")}
        disabled={disabled}
        triggerRef={(node) => {
          trigger.current = node;
          if (node) node.dataset.dictationTitleAction = entry.id;
        }}
      >
        <ActionMenuItem
          disabled={disabled}
          onClick={() => {
            setRenameMounted(true);
            setRenaming(true);
          }}
        >
          <Pencil aria-hidden="true" />
          {t("uiPolish.rename")}
        </ActionMenuItem>
        <ActionMenuItem destructive disabled={disabled} onClick={onRemove}>
          <Trash2 aria-hidden="true" />
          {t("ux.history.moveToRecentlyDeleted")}
        </ActionMenuItem>
      </ActionMenu>
      {renameMounted && (
        <SessionTitleAction
          entry={entry}
          disabled={disabled}
          open={renaming}
          onOpenChange={setRenaming}
          hideTrigger
          returnFocus={trigger}
          onSaved={onRenamed}
        />
      )}
    </div>
  );
});
