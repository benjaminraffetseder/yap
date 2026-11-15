import type { VocabularyEntry } from "@/lib/backend";

export type VocabularyDraft = Omit<VocabularyEntry, "aliases"> & { aliases: string };
export const vocabularyDraft = (entries: VocabularyEntry[]): VocabularyDraft[] =>
  entries.map((entry) => ({ ...entry, aliases: entry.aliases.join(", ") }));
export function vocabularyPayload(
  draft: VocabularyDraft[],
  saved: VocabularyEntry[],
): VocabularyEntry[] {
  const existing = new Set(saved.map((entry) => entry.id));
  return draft
    .filter((entry) => existing.has(entry.id) || entry.canonical.trim() || entry.aliases.trim())
    .map((entry) => ({
      ...entry,
      aliases: entry.aliases
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean),
    }));
}
