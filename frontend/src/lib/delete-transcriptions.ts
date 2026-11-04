import i18n from "@/i18n";
import { toastManager } from "@/components/ui/toast";
import { backend, message } from "@/lib/backend";

export async function deleteTranscriptions(ids: string[], refresh: () => Promise<void>) {
  const deleted = [...ids];
  await backend.removeSessions(deleted);
  let restoring = false;
  const undo = {
    children: i18n.t("common.undo"),
    onClick: () => {
      if (restoring) return;
      restoring = true;
      toastManager.update(toastId, {
        timeout: 0,
        actionProps: { ...undo, children: i18n.t("common.restoring"), disabled: true },
      });
      void backend
        .restoreSessions(deleted)
        .then(async () => {
          toastManager.update(toastId, {
            type: "success",
            title:
              deleted.length === 1
                ? i18n.t("historyPage.dictationRestored")
                : i18n.t("historyPage.dictationsRestored", { length: deleted.length }),
            description: undefined,
            actionProps: undefined,
            timeout: 5000,
          });
          await refresh();
        })
        .catch((cause) => {
          toastManager.update(toastId, {
            type: "error",
            title:
              deleted.length === 1
                ? i18n.t("deleteTranscriptions.couldnTRestoreDictation")
                : i18n.t("deleteTranscriptions.couldnTRestoreDictations"),
            description: message(cause),
            actionProps: undo,
            timeout: 0,
          });
        })
        .finally(() => {
          restoring = false;
        });
    },
  };
  const toastId = toastManager.add({
    type: "success",
    title:
      deleted.length === 1
        ? i18n.t("deleteTranscriptions.dictationDeleted")
        : i18n.t("deleteTranscriptions.deletedMany", { count: deleted.length }),
    description: i18n.t("deleteTranscriptions.movedToRecentlyDeleted"),
    timeout: 8000,
    actionProps: undo,
  });
}
