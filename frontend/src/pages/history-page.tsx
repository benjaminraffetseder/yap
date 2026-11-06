import { AudioImportButton } from "@/components/audio-import-button";
import { useDictation } from "@/components/dictation-provider";
import { DictationRow } from "@/components/dictation-row";
import { PageHeading } from "@/components/page-heading";
import { SessionTitleAction } from "@/components/session-title-action";
import { TranscriptExportDialog } from "@/components/transcript-export-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import {
  backend,
  isDesktop,
  message,
  type HistoryPageResult,
  type Session,
  type TranscriptExportSelection,
} from "@/lib/backend";
import { deleteTranscriptions } from "@/lib/delete-transcriptions";
import { Download, History, Loader2, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<HistoryPageResult>({
    entries: [],
    total: 0,
    page: 0,
    pageSize: 50,
  });
  const [loading, setLoading] = useState(isDesktop);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef(0);
  const loaded = useRef<{
    query: string;
    deleted: boolean;
    reload: number;
    history: Session[];
    result: HistoryPageResult;
  } | null>(null);
  const loadMoreTrigger = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!isDesktop) return;
    const revision = ++request.current;
    const previous = loaded.current;
    const append =
      previous !== null &&
      previous.query === query &&
      previous.deleted === deleted &&
      previous.reload === reload &&
      previous.history === snapshot.history &&
      page === previous.result.page + 1;
    setLoading(!append);
    setLoadingMore(append);
    setError("");
    setLoadMoreError("");
    const timer = setTimeout(() => {
      const fetchPage = (index: number) =>
        deleted ? backend.recentlyDeleted(query, index) : backend.history(query, index);
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
          loaded.current = { query, deleted, reload, history: snapshot.history, result: value };
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
    }, 150);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [query, page, deleted, reload, retry, snapshot.history, setPage]);

  const { entries, total } = result;
  const hasMore = (result.page + 1) * result.pageSize < total;
  useEffect(() => {
    const node = loadMoreTrigger.current;
    if (
      !node ||
      !isDesktop ||
      !hasMore ||
      loading ||
      loadingMore ||
      error ||
      loadMoreError ||
      deletingNow ||
      exportSelection
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
    loading,
    loadingMore,
    error,
    loadMoreError,
    deletingNow,
    exportSelection,
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
  const unavailable = !isDesktop || loading || !!error || deletingNow || !!exportSelection;
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
    setExportSelection({
      sessionIds: allMatching ? [] : selected,
      allMatching,
      query: allMatching ? query : "",
      excludedSessionIds: allMatching ? excluded : [],
    });
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
                ref={searchInput}
                aria-label={t("historyPage.searchTranscripts")}
                maxLength={250}
                className="h-9 rounded-lg bg-card pl-10 text-sm"
                placeholder={t("historyPage.searchTranscripts2")}
                value={query}
                onChange={(event) => {
                  setLoading(true);
                  setSelected([]);
                  setAllMatching(false);
                  setExcluded([]);
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
            {!deleted && <AudioImportButton />}
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
                checked={selectedOnPage === entries.length}
                indeterminate={selectedOnPage > 0 && selectedOnPage < entries.length}
                onCheckedChange={(checked) => {
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
                }}
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
                    action={
                      !deleted && (
                        <SessionTitleAction
                          contextual
                          entry={entry}
                          context={
                            entry.title ||
                            (entry.finalTranscript ?? entry.rawTranscript).slice(0, 80)
                          }
                          disabled={unavailable}
                          onSaved={() => {
                            renamed.current = entry.id;
                            setReload((value) => value + 1);
                            void run(refresh, false);
                          }}
                        />
                      )
                    }
                    selection={{
                      label: t("historyPage.selectDictation", {
                        index: index + 1,
                      }),
                      checked: allMatching
                        ? !excluded.includes(entry.id)
                        : selected.includes(entry.id),
                      onCheckedChange: (checked) => {
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
                      },
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
                    disabled={deletingNow || !!exportSelection}
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
    </div>
  );
}
