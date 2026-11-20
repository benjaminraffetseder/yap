import { CopyButton } from "@/components/shared/copy-button";
import { PageHeading } from "@/components/shared/page-heading";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioImportButton } from "@/features/audio/components/audio-import-button";
import {
  useDictationActions,
  useDictationActivity,
  useDictationConnection,
} from "@/features/dictation/hooks/use-dictation-state";
import { HistorySearch } from "@/features/history/components/history-search";
import { HistoryTable } from "@/features/history/components/history-table";
import { deleteTranscriptions } from "@/features/history/lib/delete-transcriptions";
import { BulkTextDialog } from "@/features/processing/components/bulk-text-dialog";
import { SessionTitleAction } from "@/features/transcripts/components/session-title-action";
import { TranscriptExportDialog } from "@/features/transcripts/components/transcript-export-dialog";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  isDesktop,
  message,
  type HistoryPageResult,
  type HistorySortColumn,
  type TranscriptExportSelection,
} from "@/lib/backend";
import { hasOpenKeyboardOverlay } from "@/lib/keyboard-shortcuts";
import { resourceKeys } from "@/lib/queries/resource-queries";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import {
  Download,
  History,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  const { run, refresh } = useDictationActions();
  const { loading: connecting } = useDictationConnection();
  const snapshot = { status: useDictationActivity() };
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
  const queryClient = useQueryClient();
  const listKey = useMemo(
    () => [...resourceKeys.history, { query, deleted, sortBy, descending }],
    [query, deleted, sortBy, descending],
  );
  // Retain only the identity of the previous successful query. Query remains
  // the sole data owner, including the rows shown during a failed new search.
  const previousList = useRef<QueryKey | null>(null);
  const [changingList, setChangingList] = useState(false);
  useLayoutEffect(() => setChangingList(false), [query, deleted, sortBy, descending]);
  const history = useInfiniteQuery({
    queryKey: listKey,
    queryFn: async ({ pageParam, signal }) => {
      // StrictMode's discarded observer must not start a native read before
      // the replacement observer can take ownership.
      await Promise.resolve();
      signal.throwIfAborted();
      return deleted
        ? backend.recentlyDeleted(query, pageParam, sortBy, descending)
        : backend.history(query, pageParam, sortBy, descending);
    },
    initialPageParam: 0,
    getNextPageParam: (last) =>
      (last.page + 1) * last.pageSize < last.total ? last.page + 1 : undefined,
    enabled: isDesktop && !connecting && active,
  });
  useEffect(() => {
    if (history.data) previousList.current = listKey;
  }, [history.data, listKey]);
  const pages =
    history.data?.pages ??
    (previousList.current
      ? queryClient.getQueryData<InfiniteData<HistoryPageResult>>(previousList.current)?.pages
      : undefined);
  const visiblePages = history.data ? pages?.slice(0, page + 1) : pages;
  const last = visiblePages?.at(-1);
  const result = {
    entries: [
      ...new Map(
        visiblePages?.flatMap((batch) => batch.entries).map((entry) => [entry.id, entry]),
      ).values(),
    ],
    total: last?.total ?? 0,
    page: last?.page ?? 0,
    pageSize: last?.pageSize ?? 50,
  };
  const missingPage = !!last && page > last.page && history.hasNextPage;
  const loadingMore = missingPage && history.isFetchingNextPage;
  const loading =
    isDesktop && (changingList || connecting || history.isPending || history.isRefetching);
  const error = history.error && !history.isFetchNextPageError ? message(history.error) : "";
  const loadMoreError = history.isFetchNextPageError ? message(history.error) : "";
  const [searchPending, setSearchPending] = useState(false);
  const { fetchNextPage, refetch } = history;
  useEffect(() => {
    if (!active || connecting || history.isFetching || history.isError) return;
    if (missingPage) void fetchNextPage();
    else if (last && page > last.page && !history.hasNextPage) setPage(last.page);
  }, [
    active,
    connecting,
    history.isFetching,
    history.isError,
    history.hasNextPage,
    missingPage,
    last,
    page,
    fetchNextPage,
    setPage,
  ]);
  const loadMoreTrigger = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const renamed = useRef<string | null>(null);
  const selectPage = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const clearSelection = useCallback(() => {
    setSelected([]);
    setAllMatching(false);
    setExcluded([]);
    selectionAnchor.current = null;
  }, []);
  useEffect(() => {
    selectionAnchor.current = null;
  }, [query, sortBy, descending, deleted]);
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
      setChangingList(true);
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

  // Infinite-query refetches replace every loaded page together. Keep UI
  // selection separate and reconcile only after the refreshed range settles.
  useEffect(() => {
    if (!history.data || !pages || history.isFetching || missingPage) return;
    const ids = new Set(
      pages.slice(0, page + 1).flatMap((batch) => batch.entries.map((entry) => entry.id)),
    );
    setSelected((old) => old.filter((id) => ids.has(id)));
    if (!pages[0].total) setAllMatching(false);
  }, [pages, history.data, history.isFetching, missingPage, page]);

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
    if (!selectionCount) selectionAnchor.current = null;
    if (!active || !selectionCount) return;
    function keydown(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        deletingNow ||
        hasOpenKeyboardOverlay()
      )
        return;
      event.preventDefault();
      clearSelection();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, selectionCount, deletingNow, clearSelection]);
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
  const removeMutation = useMutation({
    mutationFn: (ids: string[]) => deleteTranscriptions(ids, () => run(refresh, false)),
  });
  const restoreMutation = useMutation({ mutationFn: backend.restoreSessions });
  const permanentlyRemoveMutation = useMutation({ mutationFn: backend.permanentlyDeleteSessions });
  async function remove(ids: string[]) {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await removeMutation.mutateAsync(ids);
      setSelected([]);
      await run(refresh, false);
    } catch (cause) {
      setDeleteError(message(cause));
    } finally {
      setDeletingNow(false);
    }
  }
  async function restore(ids: string[]) {
    if (deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await restoreMutation.mutateAsync(ids);
      setSelected([]);
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
      await permanentlyRemoveMutation.mutateAsync(ids);
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
    setChangingList(true);
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
    selectionAnchor.current = checked ? (entries.at(-1)?.id ?? null) : null;
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
    <div className="-mt-4 space-y-4 pb-[max(8rem,calc(var(--history-selection-height,0px)+2.25rem+env(safe-area-inset-bottom)))] lg:mt-0 lg:space-y-7">
      <div
        ref={toolbar}
        data-slot="history-toolbar"
        className="@container/history-toolbar sticky top-0 z-20 space-y-3 border-b bg-background py-3 lg:space-y-4 lg:py-4"
      >
        <PageHeading
          title={deleted ? t("historyPage.recentlyDeleted") : t("common.history")}
          description={
            deleted
              ? t("historyPage.restoreDictationsWithin30DaysOrDelete")
              : t("historyPage.yourDictationsReadyToRevisit")
          }
          className="grid grid-cols-1 items-start gap-3 border-b-0 pb-0 @min-[58rem]/history-toolbar:grid-cols-[minmax(0,1fr)_auto] @min-[58rem]/history-toolbar:items-center @min-[58rem]/history-toolbar:gap-4"
        >
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2.5 lg:ml-auto lg:w-auto lg:gap-3">
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
          <p role="status" className="sr-only">
            {loading || searchPending
              ? t("historyPage.loadingHistory")
              : t(query ? "historyPage.matchingDictationCount" : "historyPage.dictationCount", {
                  count: total,
                })}
          </p>
        </PageHeading>
        {snapshot.status.historyError && (
          <p role="alert" className="text-sm text-destructive">
            {nativeText(snapshot.status.historyError)}
          </p>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {nativeText(error)}
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        )}
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
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
      {!entries.length && !loading && !error ? (
        <Empty className="rounded-2xl border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {query ? <Search aria-hidden="true" /> : <History aria-hidden="true" />}
            </EmptyMedia>
            <EmptyTitle className="text-base">
              {query
                ? t("historyPage.noMatchingTranscripts")
                : deleted
                  ? t("historyPage.noRecentlyDeletedDictations")
                  : t("historyPage.noDictationsYet")}
            </EmptyTitle>
            {query && <EmptyDescription>{t("historyPage.tryADifferentSearch")}</EmptyDescription>}
          </EmptyHeader>
          {query && (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  changeSearch("");
                  searchInput.current?.focus();
                }}
              >
                <X aria-hidden="true" />
                {t("uiPolish.clearSearch")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
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
          selectionActive={selectionCount > 0}
          selectAll={
            <Checkbox
              ref={selectPage}
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
          onSelect={(entry, checked, range = false) => {
            const anchor = entries.findIndex((item) => item.id === selectionAnchor.current);
            const target = entries.findIndex((item) => item.id === entry.id);
            const ids = new Set(
              range && anchor >= 0 && target >= 0
                ? entries
                    .slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
                    .map((item) => item.id)
                : [entry.id],
            );
            selectionAnchor.current = entry.id;
            if (allMatching) {
              changeExportExclusions(
                checked
                  ? excluded.filter((id) => !ids.has(id))
                  : [...new Set([...excluded, ...ids])],
              );
              return;
            }
            setSelected((old) =>
              checked ? [...new Set([...old, ...ids])] : old.filter((id) => !ids.has(id)),
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
              <Button variant="outline" size="sm" onClick={() => void fetchNextPage()}>
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
                      clearSelection();
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
