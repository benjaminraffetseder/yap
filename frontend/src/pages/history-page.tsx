import { AudioImportButton } from "@/components/audio-import-button";
import { BulkTextDialog } from "@/components/bulk-text-dialog";
import { CopyButton } from "@/components/copy-button";
import { useDictation } from "@/components/dictation-provider";
import { HistorySearch } from "@/components/history-search";
import { HistoryTable } from "@/components/history-table";
import { PageHeading } from "@/components/page-heading";
import { SessionTitleAction } from "@/components/session-title-action";
import { TranscriptExportDialog } from "@/components/transcript-export-dialog";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  isDesktop,
  message,
  type HistoryPageResult,
  type HistorySortColumn,
  type TranscriptExportSelection,
} from "@/lib/backend";
import { deleteTranscriptions } from "@/lib/delete-transcriptions";
import { Download, History, Loader2, RotateCcw, Sparkles, Trash2, Workflow, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

export function HistoryPage({ active = true }: { active?: boolean }) {
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
      active={active}
      viewToggle={
        <Button
          ref={toggle}
          variant="outline"
          aria-label={toggleLabel}
          aria-pressed={deleted}
          className="text-muted-foreground"
          onClick={() => {
            focusToggle.current = true;
            setParams(deleted ? {} : { view: "deleted" });
          }}
        >
          {deleted ? <History aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
          {deleted ? t("historyPage.showAllDictations") : t("historyPage.recentlyDeleted")}
        </Button>
      }
    />
  );
}

function HistoryList({ viewToggle, active }: { viewToggle: ReactNode; active: boolean }) {
  const { t } = useTranslation();
  const { snapshot, run, refresh, historyListCache, loading: connecting } = useDictation();
  const [params, setParams] = useSearchParams();
  const deleted = params.get("view") === "deleted";
  const query = (params.get("q") ?? "").slice(0, 250);
  const requestedSort = params.get("sort");
  const sortBy: HistorySortColumn =
    requestedSort === "dictation" ||
    requestedSort === "createdAt" ||
    requestedSort === "durationMs" ||
    (deleted && requestedSort === "deletedAt")
      ? requestedSort
      : deleted
        ? "deletedAt"
        : "createdAt";
  const descending = params.get("direction") !== "asc";
  const requestedPage = Number(params.get("page") ?? 0);
  const page =
    Number.isInteger(requestedPage) && requestedPage >= 0 && requestedPage <= 1000000
      ? requestedPage
      : 0;
  const setPage = useCallback(
    (next: number) => {
      setParams(
        (old) => {
          const value = new URLSearchParams(old);
          if (next) value.set("page", String(next));
          else value.delete("page");
          return value;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const detailSearch = params.toString() ? `?${params.toString()}` : "";
  const [initialList] = useState(() => {
    const cached = historyListCache.current;
    return cached &&
      cached.query === query &&
      cached.deleted === deleted &&
      cached.sortBy === sortBy &&
      cached.descending === descending &&
      cached.result.page <= page
      ? cached
      : null;
  });
  const [reload, setReload] = useState(initialList?.reload ?? 0);
  const [result, setResult] = useState<HistoryPageResult>(
    initialList?.result ?? { entries: [], total: 0, page: 0, pageSize: 50 },
  );
  const [loading, setLoading] = useState(
    isDesktop && (!initialList || initialList.history !== snapshot.history),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const loaded = useRef(initialList);
  const loadMoreTrigger = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const renamed = useRef<string | null>(null);
  const selectPage = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const selectionBar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = selectionBar.current;
    if (!node) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--history-selection-height",
        `${node.getBoundingClientRect().height}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--history-selection-height");
    };
  }, [selected.length, allMatching, excluded.length]);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exportSelection, setExportSelection] = useState<TranscriptExportSelection | null>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const processTrigger = useRef<HTMLButtonElement>(null);
  const [processingSelection, setProcessingSelection] = useState<{
    action: "title" | "output";
    selection: TranscriptExportSelection;
    count: number;
  } | null>(null);
  const changeSearch = useCallback(
    (nextQuery: string) => {
      setLoading(true);
      setSelected([]);
      setAllMatching(false);
      setExcluded([]);
      setParams(
        (old) => {
          const value = new URLSearchParams(old);
          if (nextQuery) value.set("q", nextQuery);
          else value.delete("q");
          value.delete("page");
          return value;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (!isDesktop || connecting || !active) return;
    const revision = ++request.current;
    const previous = loaded.current;
    const currentList =
      previous !== null &&
      previous.query === query &&
      previous.deleted === deleted &&
      previous.sortBy === sortBy &&
      previous.descending === descending &&
      previous.reload === reload &&
      previous.history === snapshot.history;
    // A return from detail can render the complete loaded range immediately.
    // Snapshot changes still revalidate edits, deletions and newly saved entries.
    if (currentList && page === previous.result.page && retry === 0) {
      setLoading(false);
      setLoadingMore(false);
      setError("");
      setLoadMoreError("");
      return;
    }
    const append = currentList && page === previous.result.page + 1;
    setLoading(!append);
    setLoadingMore(append);
    setError("");
    setLoadMoreError("");
    const timer = setTimeout(() => {
      const fetchPage = (index: number) =>
        deleted
          ? backend.recentlyDeleted(query, index, sortBy, descending)
          : backend.history(query, index, sortBy, descending);
      const fetchEntries = async () => {
        let value = await fetchPage(append ? page : 0);
        if (revision !== request.current) return null;
        if (append) {
          const entries = new Map(previous.result.entries.map((entry) => [entry.id, entry]));
          value.entries.forEach((entry) => entries.set(entry.id, entry));
          return { ...value, entries: [...entries.values()] };
        }
        // Refresh every loaded batch together so edits and deletions cannot leave
        // stale entries or shifted page boundaries in the accumulated list.
        const last = Math.min(page, Math.max(0, Math.ceil(value.total / value.pageSize) - 1));
        const entries = new Map(value.entries.map((entry) => [entry.id, entry]));
        for (let index = 1; index <= last; index++) {
          value = await fetchPage(index);
          if (revision !== request.current) return null;
          value.entries.forEach((entry) => entries.set(entry.id, entry));
        }
        return { ...value, entries: [...entries.values()] };
      };
      void fetchEntries()
        .then((value) => {
          if (!value || revision !== request.current) return;
          loaded.current = {
            query,
            deleted,
            sortBy,
            descending,
            reload,
            history: snapshot.history,
            result: value,
          };
          historyListCache.current = loaded.current;
          setResult(value);
          if (page > value.page) setPage(value.page);
          if (!value.total) setAllMatching(false);
          const ids = new Set(value.entries.map((entry) => entry.id));
          setSelected((old) => old.filter((id) => ids.has(id)));
          setLoading(false);
          setLoadingMore(false);
        })
        .catch((cause) => {
          if (revision === request.current) {
            if (append) setLoadMoreError(message(cause));
            else setError(message(cause));
            setLoading(false);
            setLoadingMore(false);
          }
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [
    query,
    page,
    deleted,
    sortBy,
    descending,
    reload,
    retry,
    snapshot.history,
    connecting,
    active,
    setPage,
    historyListCache,
  ]);

  const { entries, total } = result;
  const hasMore = (result.page + 1) * result.pageSize < total;
  useEffect(() => {
    const node = loadMoreTrigger.current;
    if (
      !node ||
      !active ||
      !isDesktop ||
      !hasMore ||
      loading ||
      loadingMore ||
      searchPending ||
      error ||
      loadMoreError ||
      deletingNow ||
      exportSelection ||
      processingSelection
    )
      return;
    const observer = new IntersectionObserver(
      (observations) => {
        if (!observations.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setPage(result.page + 1);
      },
      { rootMargin: "0px 0px 300px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    hasMore,
    active,
    loading,
    loadingMore,
    searchPending,
    error,
    loadMoreError,
    deletingNow,
    exportSelection,
    processingSelection,
    result.page,
    setPage,
  ]);
  const selectedOnPage = entries.filter((entry) =>
    allMatching ? !excluded.includes(entry.id) : selected.includes(entry.id),
  ).length;
  const selectionCount = allMatching ? Math.max(0, total - excluded.length) : selected.length;
  useEffect(() => {
    if (loading || !renamed.current) return;
    const id = renamed.current;
    renamed.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !active.hasAttribute("data-dictation-title-action"))
      return;
    const trigger = [
      ...document.querySelectorAll<HTMLElement>("[data-dictation-title-action]"),
    ].find((node) => node.dataset.dictationTitleAction === id);
    (trigger ?? searchInput.current)?.focus({ preventScroll: true });
  }, [entries, loading]);
  const unavailable =
    !isDesktop ||
    loading ||
    searchPending ||
    !!error ||
    deletingNow ||
    !!exportSelection ||
    !!processingSelection;
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
  function exportSelected() {
    setExportSelection(currentSelection());
  }
  function currentSelection(): TranscriptExportSelection {
    return {
      sessionIds: allMatching ? [] : selected,
      allMatching,
      query: allMatching ? query : "",
      excludedSessionIds: allMatching ? excluded : [],
    };
  }
  function processSelected(action: "title" | "output") {
    setProcessingSelection({ action, selection: currentSelection(), count: selectionCount });
  }
  function changeExportExclusions(next: string[]) {
    if (next.length >= total) {
      setAllMatching(false);
      setSelected([]);
      setExcluded([]);
    } else {
      setExcluded(next);
    }
  }
  function changeSort(column: HistorySortColumn) {
    setLoading(true);
    setSelected([]);
    setAllMatching(false);
    setExcluded([]);
    setParams(
      (old) => {
        const value = new URLSearchParams(old);
        value.set("sort", column);
        value.set(
          "direction",
          column === sortBy
            ? descending
              ? "asc"
              : "desc"
            : column === "dictation"
              ? "asc"
              : "desc",
        );
        value.delete("page");
        return value;
      },
      { replace: true },
    );
  }
  function selectLoaded(checked: boolean) {
    if (allMatching) {
      const pageIds = new Set(entries.map((entry) => entry.id));
      changeExportExclusions(
        checked
          ? excluded.filter((id) => !pageIds.has(id))
          : [...new Set([...excluded, ...pageIds])],
      );
      return;
    }
    setAllMatching(false);
    setSelected(checked ? entries.map((entry) => entry.id) : []);
  }
  return (
    <div className="space-y-7 pb-32">
      <div
        ref={toolbar}
        data-slot="history-toolbar"
        className="sticky top-0 z-20 space-y-4 border-b bg-background py-4"
      >
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
            <HistorySearch
              active={active}
              ref={searchInput}
              query={query}
              onSearch={changeSearch}
              onPendingChange={setSearchPending}
            />
            {!deleted && <AudioImportButton showDownloadProgress={false} />}
            {viewToggle}
          </div>
        </PageHeading>
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
            {loading || searchPending
              ? t("historyPage.loadingHistory")
              : t("historyPage.dictationCount", { count: total })}
          </p>
          {!!entries.length && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                ref={selectPage}
                disabled={unavailable}
                checked={selectedOnPage === entries.length}
                indeterminate={selectedOnPage > 0 && selectedOnPage < entries.length}
                onCheckedChange={selectLoaded}
              />
              {t("historyPage.selectLoaded")}
            </label>
          )}
          {!deleted &&
            !allMatching &&
            total > entries.length &&
            entries.length > 0 &&
            entries.every((entry) => selected.includes(entry.id)) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-auto max-w-full justify-start whitespace-normal text-left"
                disabled={unavailable}
                onClick={() => {
                  setAllMatching(true);
                  setSelected([]);
                  setExcluded([]);
                }}
              >
                {t("transcriptExport.selectAllMatching", { count: total })}
              </Button>
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
        <HistoryTable
          toolbar={toolbar}
          entries={entries}
          deleted={deleted}
          query={query}
          detailSearch={detailSearch}
          sortBy={sortBy}
          descending={descending}
          onSort={changeSort}
          disabled={unavailable}
          loading={loading || searchPending}
          selectAll={
            <Checkbox
              aria-label={t("historyPage.selectAllLoaded")}
              disabled={unavailable || !entries.length}
              checked={entries.length > 0 && selectedOnPage === entries.length}
              indeterminate={selectedOnPage > 0 && selectedOnPage < entries.length}
              onCheckedChange={selectLoaded}
            />
          }
          isSelected={(entry) =>
            allMatching ? !excluded.includes(entry.id) : selected.includes(entry.id)
          }
          onSelect={(entry, checked) => {
            if (allMatching) {
              changeExportExclusions(
                checked
                  ? excluded.filter((id) => id !== entry.id)
                  : [...new Set([...excluded, entry.id])],
              );
              return;
            }
            setSelected((old) =>
              checked ? [...old, entry.id] : old.filter((id) => id !== entry.id),
            );
          }}
          renderActions={(entry) =>
            deleted ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("historyPage.restore")}
                        disabled={unavailable}
                        onClick={() => void restore([entry.id])}
                      />
                    }
                  >
                    <RotateCcw aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side="left">{t("historyPage.restore")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("historyPage.deletePermanently")}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={unavailable}
                        onClick={() => void permanentlyRemove([entry.id])}
                      />
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side="left">{t("historyPage.deletePermanently")}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <div className="flex items-center gap-1">
                <CopyButton
                  text={entry.finalTranscript ?? entry.rawTranscript}
                  label={t("historyPage.copyDictation")}
                  iconOnly
                  variant="ghost"
                  disabled={unavailable}
                />
                <SessionTitleAction
                  contextual
                  entry={entry}
                  context={
                    entry.title || (entry.finalTranscript ?? entry.rawTranscript).slice(0, 80)
                  }
                  disabled={unavailable}
                  onSaved={() => {
                    renamed.current = entry.id;
                    setReload((value) => value + 1);
                    void run(refresh, false);
                  }}
                />
              </div>
            )
          }
        />
      )}
      {hasMore && (
        <div ref={loadMoreTrigger} className="flex min-h-9 items-center justify-center">
          {loadingMore && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              {t("historyPage.loadingMoreHistory")}
            </p>
          )}
          {loadMoreError && (
            <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
              {nativeText(loadMoreError)}
              <Button variant="outline" size="sm" onClick={() => setRetry((old) => old + 1)}>
                {t("common.retry")}
              </Button>
            </div>
          )}
        </div>
      )}
      {selectionCount > 0 && (
        <div className="pointer-events-none fixed right-0 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[var(--sidebar-width)] z-30 flex justify-center px-3 sm:px-6">
          <section
            aria-label={t("historyPage.selectionActions")}
            data-slot="history-selection-bar"
            ref={selectionBar}
            className="pointer-events-auto grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur-sm sm:flex"
          >
            <p
              role="status"
              className="px-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {allMatching
                ? t("transcriptExport.selectedForExport", { count: selectionCount })
                : t("historyPage.selectedCount", { count: selected.length })}
            </p>
            <div className="col-span-2 row-start-2 flex flex-wrap items-center justify-center gap-1 sm:flex-nowrap">
              {!deleted && (
                <ActionMenu
                  text={t("bulkText.process")}
                  label={t("bulkText.processSelected")}
                  triggerRef={processTrigger}
                  disabled={unavailable}
                >
                  <ActionMenuItem onClick={() => processSelected("title")}>
                    <Sparkles aria-hidden="true" />
                    {t("bulkText.generateTitles")}
                  </ActionMenuItem>
                  <ActionMenuItem onClick={() => processSelected("output")}>
                    <Workflow aria-hidden="true" />
                    {t("bulkText.runPromptOrChain")}
                  </ActionMenuItem>
                </ActionMenu>
              )}
              {!deleted && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("historyPage.exportSelected")}
                  ref={exportTrigger}
                  className="text-xs sm:text-sm"
                  disabled={unavailable}
                  onClick={exportSelected}
                >
                  <Download aria-hidden="true" className="size-3.5" />
                  {t("historyEntryPage.export")}
                </Button>
              )}
              {!allMatching && (
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
              )}
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
                    disabled={deletingNow || !!exportSelection || !!processingSelection}
                    onClick={() => {
                      setSelected([]);
                      setAllMatching(false);
                      setExcluded([]);
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
      {exportSelection && (
        <TranscriptExportDialog
          returnFocus={exportTrigger}
          selection={exportSelection}
          onClose={() => setExportSelection(null)}
        />
      )}
      {processingSelection && (
        <BulkTextDialog
          {...processingSelection}
          returnFocus={processTrigger}
          onClose={() => setProcessingSelection(null)}
        />
      )}
    </div>
  );
}
