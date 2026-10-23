import { toastManager } from "@/components/ui/toast";
import { backend, message } from "@/lib/backend";

export async function deleteTranscriptions(ids: string[], refresh: () => Promise<void>) {
  const deleted = [...ids];
  await backend.removeSessions(deleted);
  let restoring = false;
  const undo = {
    children: "Undo",
    onClick: () => {
      if (restoring) return;
      restoring = true;
      toastManager.update(toastId, {
        timeout: 0,
        actionProps: { ...undo, children: "Restoring…", disabled: true },
      });
      void backend
        .restoreSessions(deleted)
        .then(async () => {
          toastManager.update(toastId, {
            type: "success",
            title:
              deleted.length === 1 ? "Dictation restored" : `${deleted.length} dictations restored`,
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
              deleted.length === 1 ? "Couldn’t restore dictation" : "Couldn’t restore dictations",
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
    title: deleted.length === 1 ? "Dictation deleted" : `${deleted.length} dictations deleted`,
    description: "Moved to Recently Deleted.",
    timeout: 8000,
    actionProps: undo,
  });
}
