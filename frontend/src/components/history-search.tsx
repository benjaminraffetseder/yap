import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";

// Keep draft keystrokes local so the table and router update only after typing pauses.
export function HistorySearch({
  active,
  query,
  onSearch,
  onPendingChange,
  ref,
}: {
  active: boolean;
  query: string;
  onSearch: (query: string) => void;
  onPendingChange: (pending: boolean) => void;
  ref?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(query);
  const committed = useRef(query);
  useEffect(() => {
    onPendingChange(value !== query);
  }, [value, query, onPendingChange]);
  useEffect(() => {
    if (query !== committed.current) setValue(query);
    committed.current = query;
  }, [query]);
  useEffect(() => {
    if (!active || value === query) return;
    const timer = setTimeout(() => {
      committed.current = value;
      onSearch(value);
    }, 150);
    return () => clearTimeout(timer);
  }, [active, value, query, onSearch]);
  return (
    <div className="relative min-w-0 flex-1 basis-48 sm:w-60 sm:flex-none lg:w-64">
      <Search
        aria-hidden="true"
        className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={ref}
        aria-label={t("historyPage.searchTranscripts")}
        maxLength={250}
        className="h-9 rounded-lg bg-card pl-10 text-sm"
        placeholder={t("historyPage.searchTranscripts2")}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onPendingChange(event.target.value !== query);
        }}
      />
    </div>
  );
}
