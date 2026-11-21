import { historySearchPreview, searchRanges } from "@/features/history/lib/history-search";
import type { Session } from "@/lib/backend";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

export function DictationPreview({ entry, query = "" }: { entry: Session; query?: string }) {
  const { t } = useTranslation();
  const title = entry.title?.trim();
  // Keep the same query-specific excerpt for search and a short transcript
  // preview beneath named dictations during ordinary browsing.
  const preview = historySearchPreview(entry, query);
  return (
    <>
      {title && (
        <p className="truncate text-[0.9375rem] leading-6 font-medium">
          <SearchHighlight text={title} query={query} />
        </p>
      )}
      {preview && (
        <p
          className={cn(
            "text-[0.9375rem] leading-6",
            title && "text-muted-foreground",
            query ? "line-clamp-2 break-words" : "truncate",
          )}
        >
          {preview.original && (
            <span className="mr-1 text-xs font-medium text-muted-foreground">
              {t("historyPage.originalMatch")}:{" "}
            </span>
          )}
          <SearchHighlight text={preview.text} query={query} />
        </p>
      )}
    </>
  );
}

function SearchHighlight({ text, query }: { text: string; query: string }) {
  const ranges = searchRanges(text, query);
  let cursor = 0;
  return (
    <>
      {ranges.map(({ start, end }) => {
        const before = text.slice(cursor, start);
        cursor = end;
        return (
          <span key={start}>
            {before}
            <mark className="rounded-sm bg-primary/20 text-inherit">{text.slice(start, end)}</mark>
          </span>
        );
      })}
      {text.slice(cursor)}
    </>
  );
}
