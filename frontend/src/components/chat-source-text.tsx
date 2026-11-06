import { MarkdownContent } from "@/components/markdown-content";
import type { ChatReference } from "@/lib/backend";
import { referenceRanges, type SourceRange } from "@/lib/chat-references";
import { useEffect, useRef } from "react";

type SourceNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: SourceNode[];
};

// Decorate actual Markdown text nodes using the parser's source positions.
// Inline formatting remains intact, and DOM selections map back to raw source
// spans rather than searching for their rendered, Markdown-free text.
function sourceSpans(text: string, ranges: SourceRange[]) {
  return () => (tree: SourceNode) => {
    function visit(node: SourceNode) {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        const start = child.position?.start.offset,
          end = child.position?.end.offset;
        if (
          child.type !== "text" ||
          start === undefined ||
          end === undefined ||
          child.value === undefined
        ) {
          visit(child);
          return child;
        }
        const literal = text.slice(start, end) === child.value;
        const children: SourceNode[] = [];
        let cursor = 0;
        for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
          if (range.end <= start || range.start >= end) continue;
          const from = literal ? Math.max(cursor, range.start - start, 0) : 0;
          const to = literal ? Math.min(child.value.length, range.end - start) : child.value.length;
          if (from >= to) continue;
          children.push(
            { type: "text", value: child.value.slice(cursor, from) },
            {
              type: "element",
              tagName: "mark",
              properties: { className: "rounded-sm bg-primary/20 text-inherit" },
              children: [{ type: "text", value: child.value.slice(from, to) }],
            },
          );
          cursor = to;
        }
        children.push({ type: "text", value: child.value.slice(cursor) });
        return {
          type: "element",
          tagName: "span",
          properties: {
            "data-source-start": start,
            "data-source-end": end,
            "data-source-literal": literal,
          },
          children,
        };
      });
    }
    visit(tree);
  };
}

export function ChatSourceText({
  text,
  references,
  onSelection,
}: {
  text: string;
  references: ChatReference[];
  onSelection: (text: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const ranges = referenceRanges(text, references);
  const rangeKey = JSON.stringify(ranges);
  useEffect(() => {
    if (references.length)
      root.current?.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [rangeKey, references.length]);
  function readSelection() {
    const selection = window.getSelection();
    if (
      !selection ||
      !selection.rangeCount ||
      selection.isCollapsed ||
      !root.current?.contains(selection.anchorNode) ||
      !root.current.contains(selection.focusNode)
    )
      return;
    const range = selection.getRangeAt(0);
    let from: number | undefined, to: number | undefined;
    for (const span of root.current.querySelectorAll<HTMLElement>("[data-source-start]")) {
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
      from ??= literal ? start + prefix.toString().length : start;
      to = literal ? start + prefix.toString().length + clipped.toString().length : end;
    }
    const selected =
      from !== undefined && to !== undefined ? text.slice(from, to) : selection.toString();
    if (selected.trim() && text.includes(selected)) onSelection(selected);
  }
  return (
    <div
      ref={root}
      onMouseUp={readSelection}
      onKeyUp={readSelection}
      onTouchEnd={readSelection}
      data-slot="chat-source-text"
    >
      <MarkdownContent className="text-base leading-7" rehypePlugins={[sourceSpans(text, ranges)]}>
        {text}
      </MarkdownContent>
    </div>
  );
}
