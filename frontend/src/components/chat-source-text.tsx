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
}: {
  text: string;
  references: ChatReference[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const ranges = referenceRanges(text, references);
  const rangeKey = JSON.stringify(ranges);
  useEffect(() => {
    if (references.length)
      root.current?.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [rangeKey, references.length]);
  return (
    <div ref={root} data-slot="chat-source-text">
      <MarkdownContent className="text-base leading-7" rehypePlugins={[sourceSpans(text, ranges)]}>
        {text}
      </MarkdownContent>
    </div>
  );
}
