import type { Session } from "@/lib/backend";
import { historySearchPreview, searchRanges } from "@/lib/history-search";
import { cn } from "cn";
import { useTranslation } from "react-i18next";

export function DictationPreview({ entry, query = "" }: { entry: Session; query?: string }) {
  const { t } = useTranslation();
  const preview = historySearchPreview(entry, query);
  return (
    <>
      {entry.title && (
        <p className="truncate text-[0.9375rem] leading-6 font-medium">
          <SearchHighlight text={entry.title} query={query} />
        </p>
      )}
      <p
        className={cn(
          "break-words leading-6",
          entry.title && !query
            ? "line-clamp-1 text-sm text-muted-foreground"
            : "line-clamp-2 text-[0.9375rem]",
        )}
      >
        {preview.original && (
          <span className="mr-1 text-xs font-medium text-muted-foreground">
            {t("historyPage.originalMatch")}:{" "}
          </span>
        )}
        <SearchHighlight text={preview.text} query={query} />
      </p>
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
