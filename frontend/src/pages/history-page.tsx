import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { AudioImportButton } from "@/components/audio-import-button";
import { useDictation } from "@/components/dictation-provider";
import { DictationRow } from "@/components/dictation-row";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { backend, isDesktop, message, type HistoryPageResult, type Session } from "@/lib/backend";
import { deleteTranscriptions } from "@/lib/delete-transcriptions";
import { Download, History, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";

function historyGroups(entries: Session[], deleted: boolean) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = new Map<string, { label: string; entries: { entry: Session; index: number }[] }>();
  entries.forEach((entry, index) => {
    const date = new Date((deleted && entry.deletedAt) || entry.createdAt);
    const key = date.toDateString();
    const label =
      key === today.toDateString()
        ? i18n.t("historyPage.today")
        : key === yesterday.toDateString()
          ? i18n.t("historyPage.yesterday")
          : Number.isNaN(date.getTime())
            ? i18n.t("historyPage.unknownDate")
            : date.toLocaleDateString(i18n.resolvedLanguage, {
                month: "long",
                day: "numeric",
                ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
              });
    if (!groups.has(key)) groups.set(key, { label, entries: [] });
    groups.get(key)!.entries.push({ entry, index });
  });
  return [...groups.entries()];
}

export function HistoryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const deleted = params.get("view") === "deleted";
  const toggle = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  const toggleLabel = deleted
    ? t("historyPage.showAllDictations")
    : t("historyPage.showRecentlyDeleted");
  useEffect(() => {
    if (focusToggle.current) {
      toggle.current?.focus({ preventScroll: true });
      focusToggle.current = false;
    }
  }, [deleted]);
  return (
    <HistoryList
      key={deleted ? "deleted" : "history"}
      viewToggle={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                ref={toggle}
                size="icon"
                variant="ghost"
                aria-label={toggleLabel}
                aria-pressed={deleted}
                className="text-muted-foreground"
                onClick={() => {
                  focusToggle.current = true;
                  setParams(deleted ? {} : { view: "deleted" });
                }}
              />
            }
          >
            {deleted ? <History aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            {toggleLabel}
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}

function HistoryList({ viewToggle }: { viewToggle: ReactNode }) {
  const { t } = useTranslation();
  const { snapshot, run, refresh } = useDictation();
  const [params, setParams] = useSearchParams();
  const deleted = params.get("view") === "deleted";
  const query = (params.get("q") ?? "").slice(0, 250);
  const requestedPage = Number(params.get("page") ?? 0);
  const page =
    Number.isInteger(requestedPage) && requestedPage >= 0 && requestedPage <= 1000000
      ? requestedPage
      : 0;
  function setPage(next: number) {
    setParams(
      (old) => {
        const value = new URLSearchParams(old);
        if (next) value.set("page", String(next));
        else value.delete("page");
        return value;
      },
      { replace: true },
    );
  }
  const detailSearch = params.toString() ? `?${params.toString()}` : "";
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<HistoryPageResult>({
    entries: [],
    total: 0,
    page: 0,
    pageSize: 50,
  });
  const [loading, setLoading] = useState(isDesktop);
  const [error, setError] = useState("");
  const request = useRef(0);
  const selectPage = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    const revision = ++request.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void (deleted ? backend.recentlyDeleted(query, page) : backend.history(query, page))
        .then((value) => {
          if (revision !== request.current) return;
          const last = Math.max(0, Math.ceil(value.total / value.pageSize) - 1);
          if (page > last) {
            setPage(last);
            return;
          }
          setResult(value);
          const ids = new Set(value.entries.map((entry) => entry.id));
          setSelected((old) => old.filter((id) => ids.has(id)));
          setLoading(false);
        })
        .catch((cause) => {
          if (revision === request.current) {
            setError(message(cause));
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [query, page, deleted, reload, snapshot.history]);

  const { entries, total, pageSize } = result;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const unavailable = !isDesktop || loading || !!error || deletingNow || exporting;
  function changePage(next: number) {
    setLoading(true);
    setSelected([]);
    setPage(next);
  }
  async function remove(ids: string[]) {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await deleteTranscriptions(ids, () => run(refresh, false));
      setSelected([]);
      setReload((old) => old + 1);
      await run(refresh, false);
    } catch (cause) {
      setDeleteError(message(cause));
      setReload((old) => old + 1);
    } finally {
      setDeletingNow(false);
    }
  }
  async function restore(ids: string[]) {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await backend.restoreSessions(ids);
      setSelected([]);
      setReload((old) => old + 1);
      toastManager.add({
        type: "success",
        title:
          ids.length === 1
            ? t("historyPage.dictationRestored")
            : t("historyPage.dictationsRestored", { length: ids.length }),
      });
      await run(refresh, false);
    } catch (cause) {
      setDeleteError(message(cause));
    } finally {
      setDeletingNow(false);
    }
  }
  async function permanentlyRemove(ids: string[]) {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await backend.permanentlyDeleteSessions(ids);
      setSelected([]);
      toastManager.add({
        type: "success",
        title:
          ids.length === 1
            ? t("historyPage.dictationPermanentlyDeleted")
            : t("historyPage.dictationsPermanentlyDeleted", { length: ids.length }),
      });
    } catch (cause) {
      setDeleteError(message(cause));
    } finally {
      setReload((old) => old + 1);
      await run(refresh, false);
      setDeletingNow(false);
    }
  }
  async function exportSelected() {
    setExporting(true);
    await run(() => backend.exportSessions(selected), false);
    setExporting(false);
  }
  return (
    <div className="space-y-7 pb-32">
      <div className="sticky top-0 z-20 space-y-4 border-b bg-background py-4">
        <PageHeading
          title={deleted ? t("historyPage.recentlyDeleted") : t("common.history")}
          description={
            deleted
              ? t("historyPage.restoreDictationsWithin30DaysOrDelete")
              : t("historyPage.yourDictationsReadyToRevisit")
          }
          className="items-center"
        >
          <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
            <div className="relative min-w-0 flex-1 basis-48 sm:w-60 sm:flex-none lg:w-64">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label={t("historyPage.searchTranscripts")}
                maxLength={250}
                className="h-9 rounded-lg bg-card pl-10 text-sm"
                placeholder={t("historyPage.searchTranscripts2")}
                value={query}
                onChange={(event) => {
                  setLoading(true);
                  setSelected([]);
                  setParams(
                    {
                      ...(deleted ? { view: "deleted" } : {}),
                      ...(event.target.value ? { q: event.target.value } : {}),
                    },
                    { replace: true },
                  );
                }}
              />
            </div>
            <AudioImportButton />
            {viewToggle}
          </div>
        </PageHeading>
        {snapshot.status.phase === "transcribing" && (
          <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
            <span>{nativeText(snapshot.status.message)}</span>
            <Button size="sm" variant="outline" onClick={() => void run(backend.cancel, false)}>
              {t("historyPage.cancelTranscription")}
            </Button>
          </div>
        )}
        {snapshot.status.historyError && (
          <p role="alert" className="text-sm text-destructive">
            {nativeText(snapshot.status.historyError)}
          </p>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {nativeText(error)}
            <Button variant="outline" size="sm" onClick={() => setReload((old) => old + 1)}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="mr-auto text-xs text-muted-foreground">
            {loading
              ? t("historyPage.loadingHistory")
              : t("historyPage.dictationCount", { count: total })}
          </p>
          {!!entries.length && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                ref={selectPage}
                disabled={unavailable}
                checked={entries.every((entry) => selected.includes(entry.id))}
                indeterminate={selected.length > 0 && selected.length < entries.length}
                onCheckedChange={(checked) =>
                  setSelected(checked ? entries.map((entry) => entry.id) : [])
                }
              />
              {t("historyPage.selectPage")}
            </label>
          )}
        </div>
      </div>
      {!entries.length && !loading && !error ? (
        <div className="rounded-2xl border border-dashed py-12 text-center">
          <History className="mx-auto mb-4 size-7 text-muted-foreground/50" />
          <h2 className="text-sm font-medium">
            {query
              ? t("historyPage.noMatchingTranscripts")
              : deleted
                ? t("historyPage.noRecentlyDeletedDictations")
                : t("historyPage.noDictationsYet")}
          </h2>
          {query && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("historyPage.tryADifferentSearch")}
            </p>
          )}
        </div>
      ) : (
        <div aria-busy={loading} className="space-y-6">
          {historyGroups(entries, deleted).map(([date, group]) => (
            <section key={date} aria-label={group.label} className="space-y-2.5">
              <h2 className="px-1 text-xs font-medium text-muted-foreground">{group.label}</h2>
              <div className="overflow-hidden rounded-xl border bg-card/60">
                {group.entries.map(({ entry, index }) => (
                  <DictationRow
                    key={entry.id}
                    entry={entry}
                    disabled={unavailable}
                    selection={{
                      label: t("historyPage.selectDictation", {
                        index: page * pageSize + index + 1,
                      }),
                      checked: selected.includes(entry.id),
                      onCheckedChange: (checked) =>
                        setSelected((old) =>
                          checked ? [...old, entry.id] : old.filter((id) => id !== entry.id),
                        ),
                    }}
                    {...(deleted
                      ? {
                          deleted: {
                            onRestore: () => void restore([entry.id]),
                            onDeletePermanently: () => void permanentlyRemove([entry.id]),
                          },
                        }
                      : { to: `/history/${encodeURIComponent(entry.id)}${detailSearch}` })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {total > pageSize && (
        <nav
          aria-label={t("historyPage.historyPages")}
          className="flex items-center justify-between gap-3"
        >
          <Button
            variant="outline"
            disabled={unavailable || page === 0}
            onClick={() => changePage(page - 1)}
          >
            {t("historyPage.previous")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("historyPage.page")} {page + 1} {t("historyPage.of")} {pages}
          </span>
          <Button
            variant="outline"
            disabled={unavailable || page + 1 >= pages}
            onClick={() => changePage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </nav>
      )}
      {!!selected.length && (
        <div className="pointer-events-none fixed right-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[var(--sidebar-width)] z-30 flex justify-center px-3 sm:px-6">
          <section
            aria-label={t("historyPage.selectionActions")}
            data-slot="history-selection-bar"
            className="pointer-events-auto grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur-sm sm:flex"
          >
            <p
              role="status"
              className="px-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {t("historyPage.selectedCount", { count: selected.length })}
            </p>
            <div className="col-span-2 row-start-2 flex flex-wrap items-center justify-center gap-1 sm:flex-nowrap">
              {!deleted && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("historyPage.exportSelected")}
                  className="text-xs sm:text-sm"
                  disabled={unavailable}
                  onClick={() => void exportSelected()}
                >
                  <Download aria-hidden="true" className="size-3.5" />
                  {t("historyEntryPage.export")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={
                  deleted ? t("historyPage.restoreSelected") : t("historyPage.deleteSelected")
                }
                className={
                  deleted
                    ? "text-xs sm:text-sm"
                    : "text-xs text-destructive hover:bg-destructive/10 hover:text-destructive sm:text-sm"
                }
                disabled={unavailable}
                onClick={() => void (deleted ? restore(selected) : remove(selected))}
              >
                {deleted ? (
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                ) : (
                  <Trash2 aria-hidden="true" className="size-3.5" />
                )}
                {deleted ? t("historyPage.restore") : t("common.delete")}
              </Button>
              {deleted && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("historyPage.deleteSelectedPermanently")}
                  className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive sm:text-sm"
                  disabled={unavailable}
                  onClick={() => void permanentlyRemove(selected)}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  {t("historyPage.deletePermanently")}
                </Button>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("historyPage.clearSelection")}
                    className="col-start-2 row-start-1 text-muted-foreground"
                    disabled={deletingNow || exporting}
                    onClick={() => {
                      setSelected([]);
                      selectPage.current?.focus({ preventScroll: true });
                    }}
                  />
                }
              >
                <X aria-hidden="true" className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{t("historyPage.clearSelection")}</TooltipContent>
            </Tooltip>
          </section>
        </div>
      )}
    </div>
  );
}
