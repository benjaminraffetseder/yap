import { toastManager } from "@/components/ui/toast";

// Capture the whole draft, including the automatic-processing selection.
export function deleteDraftItem<T>(before: T, after: T, apply: (value: T) => void, label: string) {
  apply(after);
  const id = toastManager.add({
    title: `${label} deleted`,
    timeout: 8000,
    actionProps: {
      children: "Undo",
      onClick: () => {
        apply(before);
        toastManager.close(id);
      },
    },
  });
}
