import { z } from "zod";
import i18n from "@/i18n";
import type { VocabularyEntry } from "@/lib/backend";
import { vocabularyIdentifierSchema, vocabularyPhraseSchema } from "@/lib/validation/primitives";

const vocabularyEntryShape = z.object({
  id: z.string(),
  canonical: z.string(),
  aliases: z.array(z.string()),
  enabled: z.boolean(),
});
export const vocabularySchema = z.array(vocabularyEntryShape).superRefine((entries, ctx) => {
  const phrases: { phrase: string; owner: number; path: (string | number)[] }[] = [];
  const ids = new Set<string>();
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  for (const [index, entry] of entries.entries()) {
    if (!vocabularyIdentifierSchema.safeParse(entry.id).success || ids.has(entry.id))
      issue([index, "id"], i18n.t("draftValidation.vocabularyEntryIDsMustBeUnique"));
    ids.add(entry.id);
    if (entries.length > 100)
      issue([index], i18n.t("draftValidation.useAtMost100VocabularyEntries"));
    if (entry.aliases.length > 10)
      issue([index, "aliases"], i18n.t("draftValidation.useAtMost10AliasesPerTerm"));
    for (const [phraseIndex, phrase] of [entry.canonical, ...entry.aliases].entries()) {
      const at = phraseIndex === 0 ? [index, "canonical"] : [index, "aliases", phraseIndex - 1];
      if (!vocabularyPhraseSchema.safeParse(phrase).success)
        issue(at, i18n.t("draftValidation.use180CharactersWithoutLineBreaksFor"));
      // Match Go's simple Unicode folding, preserving micro sign, long-s and sigma behavior.
      const pattern = new RegExp(`^${phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "iu");
      const duplicate = phrases.find(
        (previous) => entries[previous.owner].id !== entry.id && pattern.test(previous.phrase),
      );
      if (duplicate) {
        const message = i18n.t("draftValidation.duplicateTerm", { phrase: phrase.trim() });
        for (const path of [at, duplicate.path])
          ctx.addIssue({
            code: "custom",
            path,
            message,
            params: { duplicatePhrase: phrase.trim() },
          });
      }
      phrases.push({ phrase: phrase.trim(), owner: index, path: at });
    }
  }
}) satisfies z.ZodType<VocabularyEntry[]>;
