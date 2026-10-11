import { useDictation } from "@/components/dictation-provider";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { backend, isBusy, isDesktop, type VocabularyEntry } from "@/lib/backend";
import { BookOpen, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZE = 10;

type Draft = Omit<VocabularyEntry, "aliases"> & { aliases: string };
const draftOf = (entries: VocabularyEntry[]): Draft[] =>
  entries.map((entry) => ({ ...entry, aliases: entry.aliases.join(", ") }));

export function VocabularyPage() {
  const { snapshot, run, loading } = useDictation();
  const [draft, setDraft] = useState(() => draftOf(snapshot.vocabulary));
  const baseline = useRef(draftOf(snapshot.vocabulary));
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const busy = isBusy(snapshot.status.phase);
  const pages = Math.max(1, Math.ceil(draft.length / PAGE_SIZE) || 1);
  useEffect(() => {
    const previous = baseline.current;
    baseline.current = draftOf(snapshot.vocabulary);
    setDraft((old) => (JSON.stringify(old) === JSON.stringify(previous) ? baseline.current : old));
  }, [snapshot.vocabulary]);
  useEffect(() => {
    setPage((current) => Math.min(current, pages - 1));
  }, [pages]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(snapshot.vocabulary));
  const pageEntries = draft.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  function update(id: string, value: Partial<Draft>) {
    setDraft((old) => old.map((entry) => (entry.id === id ? { ...entry, ...value } : entry)));
  }
  async function save() {
    if (loading || saving || busy) return;
    setSaving(true);
    await run(async () => {
      const saved = await backend.vocabulary(
        draft.map((entry) => ({
          ...entry,
          aliases: entry.aliases
            .split(",")
            .map((alias) => alias.trim())
            .filter(Boolean),
        })),
      );
      setDraft(draftOf(saved));
    });
    setSaving(false);
  }
  return (
    <div className="space-y-7">
      <PageHeading
        title="Vocabulary"
        description="Teach Yap the names, brands, and terms you use."
      />
      <fieldset
        disabled={!isDesktop || busy || saving || loading}
        className="min-w-0 space-y-6 disabled:opacity-60"
      >
        <section aria-labelledby="vocabulary-terms-heading" className="space-y-4">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-background py-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="vocabulary-terms-heading" className="text-sm font-semibold">
                Your terms
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.length} / 100
              </span>
              {dirty && (
                <span role="status" className="text-xs text-muted-foreground">
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={draft.length >= 100}
                onClick={() => {
                  setDraft((old) => [
                    ...old,
                    {
                      id: crypto.randomUUID(),
                      canonical: "",
                      aliases: "",
                      enabled: true,
                    },
                  ]);
                  setPage(Math.floor(draft.length / PAGE_SIZE));
                }}
              >
                <Plus className="size-3.5" />
                Add term
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(draftOf(snapshot.vocabulary))}
                >
                  Discard changes
                </Button>
              )}
              <Button size="sm" disabled={!dirty} onClick={() => void save()}>
                <Save className="size-3.5" />
                {saving ? "Saving…" : "Save vocabulary"}
              </Button>
            </div>
          </div>
          {!draft.length ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <BookOpen
                className="mx-auto mb-4 size-7 text-muted-foreground/60"
                aria-hidden="true"
              />
              <h3 className="text-sm font-medium">A vocabulary that sounds like you</h3>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                Add names, brands, or technical terms you use often.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10">
                        <span className="sr-only">Enabled</span>
                      </TableHead>
                      <TableHead>Preferred spelling</TableHead>
                      <TableHead>Aliases</TableHead>
                      <TableHead className="w-13">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageEntries.map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-transparent">
                        <TableCell>
                          <div className="flex items-center justify-center">
                            <Checkbox
                              aria-label="Enabled"
                              disabled={!isDesktop || busy || saving || loading}
                              checked={entry.enabled}
                              onCheckedChange={(checked) =>
                                update(entry.id, { enabled: checked === true })
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Label htmlFor={`term-${entry.id}`} className="sr-only">
                            Preferred spelling
                          </Label>
                          <Input
                            id={`term-${entry.id}`}
                            maxLength={80}
                            placeholder="e.g. PostgreSQL"
                            value={entry.canonical}
                            onChange={(event) =>
                              update(entry.id, { canonical: event.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Label htmlFor={`aliases-${entry.id}`} className="sr-only">
                            Aliases (comma-separated)
                          </Label>
                          <Input
                            id={`aliases-${entry.id}`}
                            placeholder="e.g. postgres, post gre SQL"
                            value={entry.aliases}
                            onChange={(event) => update(entry.id, { aliases: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${entry.canonical || "term"}`}
                            onClick={() =>
                              setDraft((old) => old.filter((item) => item.id !== entry.id))
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {draft.length > PAGE_SIZE && (
                <nav
                  aria-label="Vocabulary pages"
                  className="flex items-center justify-between gap-3"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= pages}
                    onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </div>
          )}
        </section>
      </fieldset>
    </div>
  );
}
