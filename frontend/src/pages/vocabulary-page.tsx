import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { AutoSaveStatus } from "@/components/auto-save-status";
import { useDictation } from "@/components/dictation-provider";
import { PageHeading } from "@/components/page-heading";
import { RevisionHistory } from "@/components/revision-history";
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
import { toastManager } from "@/components/ui/toast";
import { backend, isBusy, isDesktop, message, type VocabularyEntry } from "@/lib/backend";
import {
  vocabularyDraft as draftOf,
  validateVocabulary,
  vocabularyPayload,
  type VocabularyDraft as Draft,
} from "@/lib/draft-validation";
import { useAutoSave } from "@/lib/use-auto-save";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { BookOpen, History, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 10;

export function VocabularyPage() {
  const { t } = useTranslation();
  const { snapshot, refresh, loading } = useDictation();
  const saved = useMemo(() => draftOf(snapshot.vocabulary), [snapshot.vocabulary]);
  const [draft, setDraft, draftState] = useSavedDraft("vocabulary", saved);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(0);
  const busy = isBusy(snapshot.status.phase);
  const pages = Math.max(1, Math.ceil(draft.length / PAGE_SIZE) || 1);
  useEffect(() => {
    setPage((current) => Math.min(current, pages - 1));
  }, [pages]);
  const payload = vocabularyPayload(draft, snapshot.vocabulary);
  const errors = validateVocabulary(payload);
  const fieldErrors = validateVocabulary(payload, { conciseDuplicates: true });
  const reason = Object.values(errors)[0];
  const disabled = !isDesktop || busy || loading;
  const pageEntries = draft.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  function update(id: string, value: Partial<Draft>) {
    setDraft((old) => old.map((entry) => (entry.id === id ? { ...entry, ...value } : entry)));
  }
  async function save() {
    setError("");
    try {
      await backend.vocabulary(payload);
      draftState.markSubmitted(draft);
      await refresh();
    } catch (cause) {
      setError(message(cause));
      toastManager.add({
        id: "vocabulary-save",
        type: "error",
        title: message(cause),
        priority: "high",
        timeout: 8000,
      });
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    draftKey: JSON.stringify(draft),
    dirty: draftState.dirty,
    canSave: !disabled && !reason,
    save,
    delay: 800,
  });
  return (
    <div className="space-y-7">
      <PageHeading
        title={t("common.vocabulary")}
        description={t("vocabularyPage.teachYapTheNamesBrandsAndTerms")}
      />
      <fieldset disabled={disabled} className="min-w-0 space-y-6 disabled:opacity-60">
        <section aria-labelledby="vocabulary-terms-heading" className="space-y-4">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-background py-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="vocabulary-terms-heading" className="text-sm font-semibold">
                {t("vocabularyPage.yourTerms")}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {draft.length} / 100
              </span>
              <AutoSaveStatus
                status={autoSave.status}
                showDiscard={draftState.dirty && !autoSave.saving}
                reason={reason}
                retry={autoSave.retry}
                discard={() => setDraft(saved)}
                disabled={disabled}
              />
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
                {t("vocabularyPage.addTerm")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistory(true)}>
                <History aria-hidden="true" className="size-3.5" />
                {t("promptsPage.versionHistory")}
              </Button>
            </div>
          </div>
          {error && autoSave.failed && (
            <p role="alert" className="text-xs text-destructive">
              {nativeText(error)}
            </p>
          )}
          {!draft.length ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <BookOpen
                className="mx-auto mb-4 size-7 text-muted-foreground/60"
                aria-hidden="true"
              />
              <h3 className="text-sm font-medium">
                {t("vocabularyPage.aVocabularyThatSoundsLikeYou")}
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                {t("vocabularyPage.addNamesBrandsOrTechnicalTermsYou")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="@container/vocabulary overflow-hidden rounded-2xl border bg-card">
                <p className="border-b px-4 py-3 text-xs text-muted-foreground">
                  {t("uiPolish.aliasesHelp")}
                </p>
                <Table className="@max-[34rem]/vocabulary:block">
                  <TableHeader className="@max-[34rem]/vocabulary:sr-only">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-20 text-center">
                        {t("vocabularyPage.enabled")}
                      </TableHead>
                      <TableHead>{t("vocabularyPage.preferredSpelling")}</TableHead>
                      <TableHead>{t("vocabularyPage.aliases")}</TableHead>
                      <TableHead className="w-13">
                        <span className="sr-only">{t("vocabularyPage.actions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="@max-[34rem]/vocabulary:block">
                    {pageEntries.map((entry) => (
                      <TableRow
                        key={entry.id}
                        className="group/vocabulary hover:bg-transparent @max-[34rem]/vocabulary:grid @max-[34rem]/vocabulary:grid-cols-[minmax(0,1fr)_auto] @max-[34rem]/vocabulary:gap-x-3 @max-[34rem]/vocabulary:gap-y-2.5 @max-[34rem]/vocabulary:p-4"
                      >
                        <TableCell className="whitespace-normal @max-[34rem]/vocabulary:col-start-1 @max-[34rem]/vocabulary:row-start-1 @max-[34rem]/vocabulary:self-center @max-[34rem]/vocabulary:p-0">
                          <div className="flex items-center justify-center gap-2 @max-[34rem]/vocabulary:justify-start">
                            <Checkbox
                              id={`enabled-${entry.id}`}
                              aria-label={t("vocabularyPage.enabled")}
                              disabled={disabled}
                              checked={entry.enabled}
                              onCheckedChange={(checked) =>
                                update(entry.id, { enabled: checked === true })
                              }
                            />
                            <Label
                              htmlFor={`enabled-${entry.id}`}
                              className="sr-only @max-[34rem]/vocabulary:not-sr-only @max-[34rem]/vocabulary:text-xs"
                            >
                              {t("vocabularyPage.enabled")}
                            </Label>
                          </div>
                          {errors[entry.id] && (
                            <p
                              id={`error-${entry.id}`}
                              role="alert"
                              className="mt-2 text-xs text-destructive [overflow-wrap:anywhere]"
                            >
                              {fieldErrors[entry.id]}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-normal @max-[34rem]/vocabulary:col-span-2 @max-[34rem]/vocabulary:min-w-0 @max-[34rem]/vocabulary:p-0">
                          <Label
                            htmlFor={`term-${entry.id}`}
                            className="sr-only @max-[34rem]/vocabulary:not-sr-only @max-[34rem]/vocabulary:mb-2 @max-[34rem]/vocabulary:block @max-[34rem]/vocabulary:text-xs @max-[34rem]/vocabulary:text-muted-foreground"
                          >
                            {t("vocabularyPage.preferredSpelling")}
                          </Label>
                          <Input
                            id={`term-${entry.id}`}
                            className="bg-background/40"
                            aria-invalid={!!errors[entry.id]}
                            aria-describedby={errors[entry.id] ? `error-${entry.id}` : undefined}
                            maxLength={80}
                            placeholder={t("vocabularyPage.eGPostgreSQL")}
                            value={entry.canonical}
                            onChange={(event) =>
                              update(entry.id, { canonical: event.target.value })
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-normal @max-[34rem]/vocabulary:col-span-2 @max-[34rem]/vocabulary:min-w-0 @max-[34rem]/vocabulary:p-0">
                          <Label
                            htmlFor={`aliases-${entry.id}`}
                            className="sr-only @max-[34rem]/vocabulary:not-sr-only @max-[34rem]/vocabulary:mb-2 @max-[34rem]/vocabulary:block @max-[34rem]/vocabulary:text-xs @max-[34rem]/vocabulary:text-muted-foreground"
                          >
                            {t("vocabularyPage.aliasesCommaSeparated")}
                          </Label>
                          <Input
                            id={`aliases-${entry.id}`}
                            className="bg-background/40"
                            placeholder={t("vocabularyPage.eGPostgresPostGreSQL")}
                            value={entry.aliases}
                            onChange={(event) => update(entry.id, { aliases: event.target.value })}
                          />
                        </TableCell>
                        <TableCell className="@max-[34rem]/vocabulary:col-start-2 @max-[34rem]/vocabulary:row-start-1 @max-[34rem]/vocabulary:p-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto min-h-[44px] w-auto px-2 text-muted-foreground hover:text-destructive"
                            aria-label={t("vocabularyPage.remove", {
                              term: entry.canonical || "term",
                            })}
                            onClick={() =>
                              setDraft((old) => old.filter((item) => item.id !== entry.id))
                            }
                          >
                            <Trash2 className="size-3.5" />
                            <span>{t("common.remove")}</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {draft.length > PAGE_SIZE && (
                <nav
                  aria-label={t("vocabularyPage.vocabularyPages")}
                  className="flex items-center justify-between gap-3"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    {t("historyPage.previous")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("historyPage.page")} {page + 1} {t("historyPage.of")} {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= pages}
                    onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
                  >
                    {t("common.next")}
                  </Button>
                </nav>
              )}
            </div>
          )}
        </section>
      </fieldset>
      {history && (
        <RevisionHistory
          kind="vocabulary"
          itemId=""
          title={t("vocabularyPage.vocabularyVersionHistory")}
          current={JSON.stringify(snapshot.vocabulary)}
          onClose={() => setHistory(false)}
          onRestore={(value) => setDraft(draftOf(JSON.parse(value) as VocabularyEntry[]))}
        />
      )}
    </div>
  );
}
