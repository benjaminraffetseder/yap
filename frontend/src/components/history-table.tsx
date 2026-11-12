import { DictationPreview } from "@/components/dictation-preview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import i18n from "@/i18n";
import { duration, type HistorySortColumn, type Session } from "@/lib/backend";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function HistoryTable({
  toolbar,
  entries,
  deleted,
  query,
  detailSearch,
  sortBy,
  descending,
  onSort,
  disabled,
  loading,
  selectAll,
  isSelected,
  onSelect,
  renderActions,
}: {
  toolbar: RefObject<HTMLDivElement | null>;
  entries: Session[];
  deleted: boolean;
  query: string;
  detailSearch: string;
  sortBy: HistorySortColumn;
  descending: boolean;
  onSort: (column: HistorySortColumn) => void;
  disabled: boolean;
  loading: boolean;
  selectAll: ReactNode;
  isSelected: (entry: Session) => boolean;
  onSelect: (entry: Session, checked: boolean) => void;
  renderActions: (entry: Session) => ReactNode;
}) {
  const { t } = useTranslation();
  const table = useRef<HTMLTableElement>(null);
  const header = useRef<HTMLTableSectionElement>(null);
  useLayoutEffect(() => {
    const tableNode = table.current;
    const headerNode = header.current;
    const toolbarNode = toolbar.current;
    if (!tableNode || !headerNode || !toolbarNode) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = tableNode.getBoundingClientRect();
      const offset = Math.min(
        Math.max(0, toolbarNode.getBoundingClientRect().bottom - bounds.top),
        Math.max(0, bounds.height - headerNode.getBoundingClientRect().height),
      );
      // Horizontal overflow traps CSS sticky positioning. Move only the header
      // within that same table so columns stay aligned without React scroll updates.
      headerNode.style.translate = `0 ${offset}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(tableNode);
    observer.observe(headerNode);
    observer.observe(toolbarNode);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [toolbar]);
  const columns: { key: HistorySortColumn; label: string }[] = [
    { key: "dictation", label: t("historyPage.dictationColumn") },
    { key: "createdAt", label: t("historyPage.createdColumn") },
    ...(deleted ? [{ key: "deletedAt" as const, label: t("historyPage.deletedColumn") }] : []),
    { key: "durationMs", label: t("historyPage.durationColumn") },
  ];
  return (
    <div className="overflow-hidden rounded-xl border bg-card/60" aria-busy={loading}>
      <Table
        ref={table}
        aria-label={deleted ? t("historyPage.recentlyDeleted") : t("common.history")}
      >
        <TableHeader
          ref={header}
          className="relative z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]"
        >
          <TableRow>
            <TableHead scope="col" className="w-12 px-4">
              {selectAll}
            </TableHead>
            {columns.map(({ key, label }) => {
              const active = sortBy === key;
              const Icon = active ? (descending ? ArrowDown : ArrowUp) : ArrowUpDown;
              return (
                <TableHead
                  key={key}
                  scope="col"
                  aria-sort={active ? (descending ? "descending" : "ascending") : undefined}
                  className={key === "dictation" ? "w-full min-w-60" : undefined}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2.5"
                    disabled={disabled}
                    onClick={() => onSort(key)}
                  >
                    {label}
                    <Icon data-icon="inline-end" aria-hidden="true" />
                  </Button>
                </TableHead>
              );
            })}
            <TableHead scope="col" className="w-24">
              <span className="sr-only">{t("historyPage.actionsColumn")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody
          onFocusCapture={(event) => {
            // Pointer focus must not move a control between pointer-down and click.
            // Focus can also bubble from dialogs rendered outside the table.
            if (
              !event.target.matches(":focus-visible") ||
              !event.currentTarget.contains(event.target)
            )
              return;
            const toolbarNode = toolbar.current;
            const headerNode = header.current;
            if (!toolbarNode || !headerNode) return;
            const visibleTop =
              toolbarNode.getBoundingClientRect().bottom +
              headerNode.getBoundingClientRect().height +
              8;
            const focusedTop = event.target.getBoundingClientRect().top;
            if (focusedTop < visibleTop) {
              window.scrollBy({ top: focusedTop - visibleTop, behavior: "instant" });
            }
          }}
        >
          {entries.map((entry, index) => (
            <TableRow key={entry.id} data-state={isSelected(entry) ? "selected" : undefined}>
              <TableCell className="px-4">
                <Checkbox
                  aria-label={t("historyPage.selectDictation", { index: index + 1 })}
                  checked={isSelected(entry)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onSelect(entry, checked)}
                />
              </TableCell>
              <TableCell className="max-w-0 whitespace-normal">
                {deleted ? (
                  <div className="flex flex-col gap-1 py-1.5">
                    <DictationPreview entry={entry} query={query} />
                  </div>
                ) : (
                  <Link
                    to={`/history/${encodeURIComponent(entry.id)}${detailSearch}`}
                    aria-disabled={disabled}
                    onClick={(event) => {
                      if (disabled) event.preventDefault();
                    }}
                    className="flex flex-col gap-1 rounded-sm py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <DictationPreview entry={entry} query={query} />
                  </Link>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                <HistoryDate value={entry.createdAt} />
              </TableCell>
              {deleted && (
                <TableCell className="text-muted-foreground tabular-nums">
                  <HistoryDate value={entry.deletedAt} />
                  {entry.deletedAt && !Number.isNaN(Date.parse(entry.deletedAt)) && (
                    <p className="mt-1 text-xs">
                      {t("historyPage.daysToRestore", {
                        days: Math.max(
                          0,
                          Math.ceil(
                            (Date.parse(entry.deletedAt) + 30 * 86400000 - Date.now()) / 86400000,
                          ),
                        ),
                      })}
                    </p>
                  )}
                </TableCell>
              )}
              <TableCell className="text-muted-foreground tabular-nums">
                {duration(entry.durationMs)}
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex items-center justify-end gap-2">{renderActions(entry)}</div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HistoryDate({ value }: { value?: string }) {
  const { t } = useTranslation();
  if (!value || Number.isNaN(Date.parse(value))) return t("historyPage.unknownDate");
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(i18n.resolvedLanguage, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  );
}
