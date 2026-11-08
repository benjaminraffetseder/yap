import type { Session } from "@/lib/backend";

// Match Go's per-rune strings.ToLower, including dotted I and Greek sigma.
function lower(text: string) {
  return Array.from(text, (char) => (char === "İ" ? "i" : char.toLowerCase())).join("");
}

export function searchRanges(text: string, query: string) {
  const ranges: { start: number; end: number }[] = [];
  if (!query) return ranges;
  const source = lower(text),
    term = lower(query);
  for (
    let start = source.indexOf(term);
    start !== -1;
    start = source.indexOf(term, start + term.length)
  )
    ranges.push({ start, end: start + term.length });
  return ranges;
}

export function historySearchPreview(entry: Session, query: string) {
  let text = entry.finalTranscript ?? entry.rawTranscript;
  let match = searchRanges(text, query)[0];
  const original = !!query && !match && !!searchRanges(entry.rawTranscript, query).length;
  if (original) {
    text = entry.rawTranscript;
    match = searchRanges(text, query)[0];
  }
  if (!match) return { text, original };
  let start = Math.max(0, match.start - 24);
  let end = Math.min(text.length, Math.max(start + 200, match.end + 65));
  const before = text.lastIndexOf(" ", start);
  const after = text.indexOf(" ", end);
  if (before >= 0 && start - before < 12) start = before + 1;
  if (after >= 0 && after - end < 20) end = after;
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
  return {
    text: (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : ""),
    original,
  };
}
