import { AudioImportButton } from "@/components/audio-import-button";
import { useDictation } from "@/components/dictation-provider";
import { DictationRow } from "@/components/dictation-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { backend, isDesktop, message, type HistoryPageResult, type Session } from "@/lib/backend";
import { Download, History, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

function historyGroups(entries: Session[]) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups = new Map<string, { label: string; entries: { entry: Session; index: number }[] }>();
  entries.forEach((entry, index) => {
    const date = new Date(entry.createdAt);
    const key = date.toDateString();
    const label =
      key === today.toDateString()
        ? "Today"
        : key === yesterday.toDateString()
          ? "Yesterday"
          : Number.isNaN(date.getTime())
            ? "Unknown date"
            : date.toLocaleDateString(undefined, {
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
  const { snapshot, run, refresh } = useDictation();
  const [params, setParams] = useSearchParams();
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
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [deletingNow, setDeletingNow] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    const revision = ++request.current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void backend
        .history(query, page)
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
  }, [query, page, reload, snapshot.history]);

  const { entries, total, pageSize } = result;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const unavailable = !isDesktop || loading || !!error || deletingNow || exporting;
  function changePage(next: number) {
    setLoading(true);
    setSelected([]);
    setPage(next);
  }
  function confirmDelete(ids: string[]) {
    setDeleteError("");
    setDeleting(ids);
  }
  async function remove() {
    if (!deleting || deletingNow) return;
    setDeletingNow(true);
    setDeleteError("");
    try {
      await backend.removeSessions(deleting);
      setSelected([]);
      setDeleting(null);
      setReload((old) => old + 1);
      await run(refresh, false);
    } catch (cause) {
      setDeleteError(message(cause));
      setReload((old) => old + 1);
    } finally {
      setDeletingNow(false);
    }
  }
  async function exportSelected() {
    setExporting(true);
    await run(() => backend.exportSessions(selected), false);
    setExporting(false);
  }
  return (
    <div className="space-y-7">
      <div className="sticky top-0 z-20 space-y-5 bg-background py-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <AudioImportButton />
        </header>
        {snapshot.status.phase === "transcribing" && (
          <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
            <span>{snapshot.status.message}</span>
            <Button size="sm" variant="outline" onClick={() => void run(backend.cancel, false)}>
              Cancel transcription
            </Button>
          </div>
        )}
        {snapshot.status.phase === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {snapshot.status.message}
          </p>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search transcripts"
            maxLength={250}
            className="h-10 rounded-xl bg-card pl-10"
            placeholder="Search transcripts…"
            value={query}
            onChange={(event) => {
              setLoading(true);
              setSelected([]);
              setParams(event.target.value ? { q: event.target.value } : {}, { replace: true });
            }}
          />
        </div>
        {snapshot.status.historyError && (
          <p role="alert" className="text-sm text-destructive">
            {snapshot.status.historyError}
          </p>
        )}
        {error && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {error}
            <Button variant="outline" size="sm" onClick={() => setReload((old) => old + 1)}>
              Retry
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="mr-auto text-xs text-muted-foreground">
            {loading ? "Loading History…" : `${total} ${total === 1 ? "dictation" : "dictations"}`}
          </p>
          {!!entries.length && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                disabled={unavailable}
                checked={entries.every((entry) => selected.includes(entry.id))}
                indeterminate={selected.length > 0 && selected.length < entries.length}
                onCheckedChange={(checked) =>
                  setSelected(checked ? entries.map((entry) => entry.id) : [])
                }
              />
              Select page
            </label>
          )}
          {!!selected.length && (
            <>
              <span className="text-xs text-muted-foreground">{selected.length} selected</span>
              <Button
                size="sm"
                variant="outline"
                disabled={unavailable}
                onClick={() => void exportSelected()}
              >
                <Download className="size-3.5" />
                Export selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={unavailable}
                onClick={() => confirmDelete(selected)}
              >
                <Trash2 className="size-3.5" />
                Delete selected
              </Button>
            </>
          )}
        </div>
      </div>
      {!entries.length && !loading && !error ? (
        <div className="rounded-2xl border border-dashed py-12 text-center">
          <History className="mx-auto mb-4 size-7 text-muted-foreground/50" />
          <h2 className="text-sm font-medium">
            {query ? "No matching transcripts" : "No dictations yet"}
          </h2>
          {query && <p className="mt-2 text-xs text-muted-foreground">Try a different search.</p>}
        </div>
      ) : (
        <div aria-busy={loading} className="space-y-6">
          {historyGroups(entries).map(([date, group]) => (
            <section key={date} aria-label={group.label} className="space-y-2.5">
              <h2 className="px-1 text-xs font-medium text-muted-foreground">{group.label}</h2>
              <div className="overflow-hidden rounded-xl border bg-card/60">
                {group.entries.map(({ entry, index }) => (
                  <DictationRow
                    key={entry.id}
                    entry={entry}
                    to={`/history/${encodeURIComponent(entry.id)}${detailSearch}`}
                    disabled={unavailable}
                    selection={{
                      label: `Select dictation ${page * pageSize + index + 1}`,
                      checked: selected.includes(entry.id),
                      onCheckedChange: (checked) =>
                        setSelected((old) =>
                          checked ? [...old, entry.id] : old.filter((id) => id !== entry.id),
                        ),
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {total > pageSize && (
        <nav aria-label="History pages" className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={unavailable || page === 0}
            onClick={() => changePage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline"
            disabled={unavailable || page + 1 >= pages}
            onClick={() => changePage(page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
      <Dialog
        open={!!deleting}
        disablePointerDismissal
        onOpenChange={(value) => {
          if (!value && !deletingNow) setDeleting(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {deleting?.length === 1
                ? "Delete this dictation?"
                : `Delete ${deleting?.length ?? 0} dictations?`}
            </DialogTitle>
            <DialogDescription>
              The selected transcripts and retained audio will be permanently removed from this
              device.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deletingNow} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingNow} onClick={() => void remove()}>
              {deletingNow
                ? "Deleting…"
                : deleting?.length === 1
                  ? "Delete dictation"
                  : "Delete dictations"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
