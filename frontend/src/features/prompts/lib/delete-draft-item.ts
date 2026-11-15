import { toastManager } from "@/components/ui/toast";
import i18n from "@/i18n";
import type { TextProcessing } from "@/lib/backend";
import type { Dispatch, SetStateAction } from "react";

function restoreDeletedItems<T extends { id: string }>(before: T[], after: T[], current: T[]) {
  const remaining = new Set(after.map((item) => item.id));
  const result = [...current];
  before.forEach((item, index) => {
    if (remaining.has(item.id) || result.some((value) => value.id === item.id)) return;
    const next = before
      .slice(index + 1)
      .find((value) => result.some((entry) => entry.id === value.id));
    const at = next ? result.findIndex((value) => value.id === next.id) : result.length;
    result.splice(at, 0, item);
  });
  return result;
}

export function deleteDraftItem(
  before: TextProcessing,
  after: TextProcessing,
  apply: Dispatch<SetStateAction<TextProcessing>>,
  label: string,
) {
  apply(after);
  const id = toastManager.add({
    title: i18n.t("deleteDraftItem.deleted", { label }),
    timeout: 8000,
    actionProps: {
      children: i18n.t("common.undo"),
      onClick: () => {
        apply((current) => ({
          ...current,
          prompts: restoreDeletedItems(before.prompts, after.prompts, current.prompts),
          chains: restoreDeletedItems(
            before.chains ?? [],
            after.chains ?? [],
            current.chains ?? [],
          ),
          autoPromptId:
            current.autoPromptId === after.autoPromptId
              ? before.autoPromptId
              : current.autoPromptId,
        }));
        toastManager.close(id);
      },
    },
  });
}
