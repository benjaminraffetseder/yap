import { MarkdownContent } from "@/components/markdown-content";
import type { ChatReference } from "@/lib/backend";
import { citationMarkdown } from "@/lib/chat-references";
import { useTranslation } from "react-i18next";

export function ChatCitationContent({
  text,
  references,
  onReference,
  className,
}: {
  text: string;
  references: ChatReference[];
  onReference: (reference: ChatReference) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <MarkdownContent
      className={className}
      overrides={{
        a: ({ href, children }) => {
          const ref = href?.startsWith("#passage-")
            ? references.find((item) => item.number === Number(href.slice(9)))
            : undefined;
          return ref ? (
            <button
              type="button"
              aria-label={t("chat.passage", { number: ref.number })}
              title={ref.quote}
              onClick={() => onReference(ref)}
              className="mx-0.5 inline-flex min-w-4 cursor-pointer items-center justify-center rounded bg-primary/10 px-1 text-[11px] leading-5 font-medium text-primary tabular-nums outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {children}
            </button>
          ) : (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {citationMarkdown(text, references)}
    </MarkdownContent>
  );
}
