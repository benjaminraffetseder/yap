import i18n from "@/i18n";
import type { TextProcessing, VocabularyEntry } from "@/lib/backend";
import { textProcessingSchema } from "@/features/prompts/lib/prompt-schemas";
import { vocabularySchema } from "@/features/vocabulary/lib/vocabulary-schemas";

export {
  vocabularyDraft,
  vocabularyPayload,
  type VocabularyDraft,
} from "@/features/vocabulary/lib/vocabulary-draft";

// Existing editors retain their first-error/row-map interfaces during adoption.
export function validateTextProcessing(value: TextProcessing): string {
  const result = textProcessingSchema.safeParse(value);
  return result.success ? "" : result.error.issues[0].message;
}
export function validateVocabulary(
  entries: VocabularyEntry[],
  { conciseDuplicates = false }: { conciseDuplicates?: boolean } = {},
): Record<string, string> {
  const result = vocabularySchema.safeParse(entries);
  const errors: Record<string, string> = {};
  if (!result.success)
    for (const issue of result.error.issues) {
      const index = issue.path[0];
      if (typeof index !== "number" || !entries[index]) {
        errors[""] = issue.message;
        continue;
      }
      const duplicatePhrase = issue.code === "custom" ? issue.params?.duplicatePhrase : undefined;
      errors[entries[index].id] =
        conciseDuplicates && typeof duplicatePhrase === "string"
          ? i18n.t("uiPolish.duplicateTermShort", { phrase: duplicatePhrase })
          : issue.message;
    }
  return errors;
}
