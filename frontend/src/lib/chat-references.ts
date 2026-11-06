import type { ChatReference } from "@/lib/backend";

export type SourceRange = { start: number; end: number };

const citationPattern = /\[\[\d{1,5}(?:(?:\]\s*,\s*\[|,\s*)\d{1,5})*\]\]/g;

export function chatReplyText(text: string) {
  return text.replace(new RegExp(`[ \\t]*${citationPattern.source}`, "g"), "").trim();
}

export function citationMarkdown(text: string, references: ChatReference[]) {
  return text.replace(citationPattern, (token) => {
    const numbers = token.match(/\d{1,5}/g) ?? [];
    return numbers
      .map((number) =>
        references.some((ref) => ref.number === Number(number))
          ? `[${number}](#passage-${number})`
          : `[${number}]`,
      )
      .join(", ");
  });
}

// Ambiguous matches must not jump to a different occurrence after an edit.
export function referenceRanges(text: string, references: ChatReference[]): SourceRange[] {
  return references.flatMap(({ quote }) => {
    if (!quote) return [];
    const start = text.indexOf(quote);
    if (start < 0 || text.indexOf(quote, start + 1) >= 0) return [];
    return [{ start, end: start + quote.length }];
  });
}
