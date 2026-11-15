import { z } from "zod";
import i18n from "@/i18n";
import { codePointLength, vocabularyPhraseSchema } from "@/lib/validation/primitives";
import type { TextSelection } from "@/features/transcripts/lib/text-selection";

export function correctionSchema(target: Pick<TextSelection, "source" | "start" | "end">) {
  return z
    .object({ spelling: vocabularyPhraseSchema, remember: z.boolean() })
    .superRefine((value, ctx) => {
      const text =
        target.source.slice(0, target.start) +
        value.spelling.trim() +
        target.source.slice(target.end);
      if (codePointLength(text) > 100000)
        ctx.addIssue({
          code: "custom",
          path: ["spelling"],
          message: i18n.t("transcriptEditor.useAtMost100000Characters"),
        });
    });
}
export type CorrectionValues = z.infer<ReturnType<typeof correctionSchema>>;
