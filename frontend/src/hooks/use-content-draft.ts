import { useSavedDraft } from "@/hooks/use-saved-draft";
import { useEffect } from "react";

// Keep the native optimistic baseline with the navigation-persistent draft,
// rather than recreating it from a newer read when an editor remounts.
const expectedText = new WeakMap<object, string>();

export function useContentDraft(key: string, saved: string, readVersion: number) {
  const [value, setValue, draft] = useSavedDraft(key, saved, readVersion);
  if (!expectedText.has(draft.entry)) expectedText.set(draft.entry, saved);
  useEffect(() => {
    if (!draft.dirty && saved === draft.baseline && !draft.entry.writer.running)
      expectedText.set(draft.entry, saved);
  }, [saved, draft.dirty, draft.baseline, draft.entry]);
  return [
    value,
    setValue,
    {
      ...draft,
      expectedText: () => expectedText.get(draft.entry)!,
      acknowledge: (text: string) => expectedText.set(draft.entry, text),
      resetExpected: () => expectedText.set(draft.entry, saved),
      retry: (save: () => Promise<boolean>) => {
        // Only an explicit retry after failure adopts the latest confirmed read.
        // Background autosave keeps the original expectation and cannot silently
        // overwrite text changed by another editor.
        if (
          !draft.entry.writer.running &&
          draft.entry.writer.failedVersion === draft.autosave.version
        )
          expectedText.set(draft.entry, saved);
        return save();
      },
    },
  ] as const;
}
