/* eslint-disable no-control-regex -- These checks mirror native text validation. */
import { z } from "zod";
import i18n from "@/i18n";

export const codePointLength = (value: string) => Array.from(value).length;
const validText = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
const encoder = new TextEncoder();

export const identifierSchema = (bytes: number) =>
  z
    .string()
    .refine(
      (value) =>
        !!value &&
        encoder.encode(value).length <= bytes &&
        validText(value) &&
        !/[\r\n\x00]/.test(value),
    );
export const nameSchema = (max: number) =>
  z.string().refine((value) => {
    const text = value.trim();
    return !!text && codePointLength(text) <= max && validText(text) && !/[\r\n\x00]/.test(text);
  });
export const instructionSchema = z
  .string()
  .refine(
    (value) =>
      !!value.trim() &&
      validText(value) &&
      codePointLength(value.trim()) <= 8000 &&
      !value.includes("\0"),
  );
export const modelIdentifierSchema = z
  .string()
  .refine(
    (value) =>
      validText(value) && codePointLength(value.trim()) <= 200 && !/[\r\n\x00]/.test(value.trim()),
  );
// Vocabulary IDs are opaque native identifiers; their contract only limits bytes.
export const vocabularyIdentifierSchema = z
  .string()
  .refine((value) => !!value && encoder.encode(value).length <= 64);
export const vocabularyPhraseSchema = z.string().refine(
  (value) => {
    const text = value.trim();
    return !!text && validText(value) && codePointLength(text) <= 80 && !/\p{Cc}/u.test(text);
  },
  { error: () => i18n.t("draftValidation.use180CharactersWithoutLineBreaksFor") },
);
