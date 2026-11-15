export type TextSelection = {
  source: string;
  start: number;
  end: number;
  text: string;
};

export function textSelection(source: string, start: number, end: number): TextSelection | null {
  const selected = source.slice(start, end);
  const text = selected.trim();
  if (
    !text ||
    Array.from(text).length > 80 ||
    // eslint-disable-next-line no-control-regex -- vocabulary terms cannot contain control characters
    /[\u0000-\u001f\u007f-\u009f]/.test(text)
  )
    return null;
  start += selected.length - selected.trimStart().length;
  return { source, start, end: start + text.length, text };
}

export type TranscriptSelection = {
  source: string;
  text: string;
  sourceText: string;
  correction: TextSelection | null;
};

// Read before a menu takes focus. Textareas and Markdown need source offsets,
// while Copy should use exactly the text that the reader highlighted.
export function readTranscriptSelection(
  root: HTMLElement,
  source: string,
): TranscriptSelection | null {
  if (root instanceof HTMLTextAreaElement) {
    if (root.value !== source || root.selectionStart === root.selectionEnd) return null;
    const text = source.slice(root.selectionStart, root.selectionEnd);
    return {
      source,
      text,
      sourceText: text,
      correction: textSelection(source, root.selectionStart, root.selectionEnd),
    };
  }
  const selection = window.getSelection();
  if (
    !selection?.rangeCount ||
    selection.isCollapsed ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  )
    return null;
  const range = selection.getRangeAt(0);
  const text = range.toString();
  const spans = root.querySelectorAll<HTMLElement>("[data-source-start]");
  if (spans.length) {
    let from: number | undefined, to: number | undefined;
    let exact = true;
    for (const span of spans) {
      if (!range.intersectsNode(span)) continue;
      const bounds = document.createRange();
      bounds.selectNodeContents(span);
      const clipped = range.cloneRange();
      if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0)
        clipped.setStart(bounds.startContainer, bounds.startOffset);
      if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0)
        clipped.setEnd(bounds.endContainer, bounds.endOffset);
      if (!clipped.toString()) continue;
      const prefix = bounds.cloneRange();
      prefix.setEnd(clipped.startContainer, clipped.startOffset);
      const start = Number(span.dataset.sourceStart),
        end = Number(span.dataset.sourceEnd);
      const literal = span.dataset.sourceLiteral === "true";
      exact = exact && literal;
      from ??= literal ? start + prefix.toString().length : start;
      to = literal ? start + prefix.toString().length + clipped.toString().length : end;
    }
    return {
      source,
      text,
      sourceText: from !== undefined && to !== undefined ? source.slice(from, to) : text,
      correction:
        exact && from !== undefined && to !== undefined ? textSelection(source, from, to) : null,
    };
  }
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const sourceText = source.slice(start, start + text.length);
  return {
    source,
    text,
    sourceText,
    correction: sourceText === text ? textSelection(source, start, start + text.length) : null,
  };
}
