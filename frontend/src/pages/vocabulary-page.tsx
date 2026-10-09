import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backend, isBusy, isDesktop, type VocabularyEntry } from "@/lib/backend";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Draft = Omit<VocabularyEntry, "aliases"> & { aliases: string };
const draftOf = (entries: VocabularyEntry[]): Draft[] =>
  entries.map((entry) => ({ ...entry, aliases: entry.aliases.join(", ") }));
export function VocabularyPage() {
  const { snapshot, run, loading } = useDictation();
  const [draft, setDraft] = useState(() => draftOf(snapshot.vocabulary));
  const baseline = useRef(draftOf(snapshot.vocabulary));
  const [saving, setSaving] = useState(false);
  const busy = isBusy(snapshot.status.phase);
  useEffect(() => {
    const previous = baseline.current;
    baseline.current = draftOf(snapshot.vocabulary);
    setDraft((old) => (JSON.stringify(old) === JSON.stringify(previous) ? baseline.current : old));
  }, [snapshot.vocabulary]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(snapshot.vocabulary));
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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Vocabulary</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Preferred spellings hint speech recognition. Aliases replace exact words or phrases in the
          result.
        </p>
      </header>
      <fieldset
        disabled={!isDesktop || busy || saving || loading}
        className="space-y-4 disabled:opacity-60"
      >
        {!draft.length && (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            Add names, brands, or technical terms you use often.
          </p>
        )}
        {draft.map((entry) => (
          <section key={entry.id} className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={!isDesktop || busy || saving || loading}
                  checked={entry.enabled}
                  onCheckedChange={(checked) => update(entry.id, { enabled: checked })}
                />
                Enabled
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${entry.canonical || "term"}`}
                onClick={() => setDraft((old) => old.filter((item) => item.id !== entry.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`term-${entry.id}`}>Preferred spelling</Label>
                <Input
                  id={`term-${entry.id}`}
                  maxLength={80}
                  placeholder="e.g. PostgreSQL"
                  value={entry.canonical}
                  onChange={(event) => update(entry.id, { canonical: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`aliases-${entry.id}`}>Aliases (comma-separated)</Label>
                <Input
                  id={`aliases-${entry.id}`}
                  placeholder="e.g. postgres, post gre SQL"
                  value={entry.aliases}
                  onChange={(event) => update(entry.id, { aliases: event.target.value })}
                />
              </div>
            </div>
          </section>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={draft.length >= 100}
            onClick={() =>
              setDraft((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  canonical: "",
                  aliases: "",
                  enabled: true,
                },
              ])
            }
          >
            <Plus className="size-4" />
            Add term
          </Button>
          <Button disabled={!dirty} onClick={() => void save()}>
            <Save className="size-4" />
            {saving ? "Saving…" : "Save vocabulary"}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(draftOf(snapshot.vocabulary))}>
              Discard changes
            </Button>
          )}
        </div>
      </fieldset>
    </div>
  );
}
