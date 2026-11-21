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
import { DictationPreview } from "@/features/history/components/dictation-preview";
import { HistoryDate } from "@/features/history/components/history-date";
import { duration, type HistorySortColumn, type Session } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
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
  selectionActive,
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
  selectionActive: boolean;
  selectAll: ReactNode;
  isSelected: (entry: Session) => boolean;
  onSelect: (entry: Session, checked: boolean, range?: boolean) => void;
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
            <TableHead
              scope="col"
              className="w-9 pl-3 lg:w-10 lg:pl-4 [&:has([role=checkbox])]:pr-2"
            >
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
                  className={
                    key === "dictation"
                      ? cn("w-full", deleted ? "min-w-44" : "min-w-60")
                      : undefined
                  }
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
            <TableHead scope="col" className="w-18 lg:w-20">
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
          {entries.map((entry, index) => {
            const deletedAt = Date.parse(entry.deletedAt ?? "");
            const daysLeft =
              deleted && !Number.isNaN(deletedAt)
                ? Math.max(0, Math.ceil((deletedAt + 30 * 86400000 - Date.now()) / 86400000))
                : null;
            const fading =
              "opacity-[var(--deletion-opacity,1)] group-hover:opacity-100 group-focus-within:opacity-100 group-data-[state=selected]:opacity-100";
            return (
              <TableRow
                key={entry.id}
                data-state={isSelected(entry) ? "selected" : undefined}
                className={cn("group", selectionActive && !disabled && "cursor-pointer")}
                style={
                  daysLeft === null
                    ? undefined
                    : ({
                        "--deletion-opacity": 0.65 + (0.35 * Math.min(daysLeft, 30)) / 30,
                      } as CSSProperties)
                }
                onClickCapture={(event) => {
                  if (
                    (!selectionActive && !event.shiftKey) ||
                    disabled ||
                    !(event.target instanceof Element) ||
                    !event.currentTarget.contains(event.target)
                  )
                    return;
                  const checkbox = event.target.closest(
                    '[role="checkbox"], input[type="checkbox"]',
                  );
                  if (checkbox && !event.shiftKey) return;
                  // Keep native controls and portalled dialogs independent of row selection.
                  if (
                    !checkbox &&
                    event.target.closest(
                      'button, input, label, [role="checkbox"], [role="menuitem"]',
                    )
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(entry, !isSelected(entry), event.shiftKey);
                }}
                onMouseDown={(event) => {
                  if (selectionActive && event.shiftKey) event.preventDefault();
                }}
              >
                <TableCell className="pt-[1.125rem] pl-3 align-top lg:pl-4 [&:has([role=checkbox])]:pr-2">
                  <Checkbox
                    aria-label={t("historyPage.selectDictation", { index: index + 1 })}
                    checked={isSelected(entry)}
                    disabled={disabled}
                    onCheckedChange={(checked) => onSelect(entry, checked)}
                  />
                </TableCell>
                <TableCell className={cn("max-w-0 whitespace-normal", fading)}>
                  {deleted ? (
                    <div className="flex flex-col gap-0.5 py-1.5">
                      <DictationPreview entry={entry} query={query} />
                      {daysLeft !== null && (
                        <p className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                          {t("historyPage.daysToRestore", { days: daysLeft })}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Link
                      to={`/history/${encodeURIComponent(entry.id)}${detailSearch}`}
                      aria-disabled={disabled}
                      onClick={(event) => {
                        if (disabled) event.preventDefault();
                      }}
                      className="flex flex-col gap-0.5 rounded-sm py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <DictationPreview entry={entry} query={query} />
                    </Link>
                  )}
                </TableCell>
                <TableCell className={cn("text-muted-foreground tabular-nums", fading)}>
                  <HistoryDate value={entry.createdAt} />
                </TableCell>
                {deleted && (
                  <TableCell className={cn("text-muted-foreground tabular-nums", fading)}>
                    <HistoryDate value={entry.deletedAt} />
                  </TableCell>
                )}
                <TableCell className={cn("text-muted-foreground tabular-nums", fading)}>
                  {duration(entry.durationMs)}
                </TableCell>
                <TableCell className="pr-3 pl-1 lg:pr-4 lg:pl-2">
                  <div className="flex items-center justify-end gap-1">{renderActions(entry)}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
