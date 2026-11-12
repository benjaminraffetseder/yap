import type { Session } from "@/lib/backend";

// Match Go's per-rune strings.ToLower, including dotted I and Greek sigma.
function lower(text: string) {
  return text.replace(/[İΣ]/g, (char) => (char === "İ" ? "i" : "σ")).toLowerCase();
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
  const term = lower(query);
  let match = term ? lower(text).indexOf(term) : -1;
  const original =
    !!term &&
    match < 0 &&
    text !== entry.rawTranscript &&
    lower(entry.rawTranscript).includes(term);
  if (original) {
    text = entry.rawTranscript;
    match = lower(text).indexOf(term);
  }
  if (match < 0 && text.length <= 200) return { text, original };
  let start = Math.max(0, match - 24);
  let end = Math.min(text.length, Math.max(start + 200, match + term.length + 65));
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
