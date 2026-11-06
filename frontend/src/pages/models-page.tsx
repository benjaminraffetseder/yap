import { nativeText } from "@/i18n/native-text";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { ModelCard } from "@/components/model-card";
import { ModelGuidance } from "@/components/model-guidance";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backend, isBusy, isDesktop, message, type Model } from "@/lib/backend";
import { initialGuidanceLanguage, recommendSpeechModel } from "@/lib/model-guidance";
import { modelProfiles, modelUseCases } from "@/lib/model-profiles";
import { languageName } from "@/lib/languages";
import { Check, ChevronDown, ChevronUp, FolderOpen, Search, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router";

const normalizeModelSearch = (value: string, locale: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase(locale);

export function ModelsPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const guidanceId = useId();
  const { snapshot, run, refresh, loading, installModel, downloadingModelId } = useDictation();
  const [removing, setRemoving] = useState<Model | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [catalogScope, setCatalogScope] = useState<"all" | "downloaded" | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [guidanceTarget, setGuidanceTarget] = useState<Model | null>(null);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const { status, settings, models } = snapshot;
  const downloading = status.phase === "downloading";
  const busy = isBusy(status.phase) || loading || downloadingModelId !== null;
  const downloadPercent = Math.round(Math.min(1, Math.max(0, status.progress)) * 100);
  const megabytes = (bytes: number) =>
    t("modelGuidance.downloadSize", {
      size: new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(
        bytes / 1_000_000,
      ),
    });
  const diskBytes = models.reduce((sum, model) => sum + (model.diskBytes ?? 0), 0);
  const installedCount = models.filter((model) => model.installed).length;
  const onlyDownloaded =
    catalogScope === "downloaded" ||
    (catalogScope === null && !embedded && installedCount > 0 && !downloadingModelId);
  useEffect(() => {
    if (!loading && catalogScope === null) setCatalogScope(onlyDownloaded ? "downloaded" : "all");
  }, [loading, catalogScope, onlyDownloaded]);
  const currentModel = models.find((model) => !!model.path && settings.modelPath === model.path);
  const recommended = recommendSpeechModel(
    models,
    initialGuidanceLanguage(settings.language),
    "everyday",
  );
  const sorted = [...models].sort(
    (a, b) =>
      Number(b.path === settings.modelPath) - Number(a.path === settings.modelPath) ||
      Number(b.installed) - Number(a.installed) ||
      (!currentModel?.installed
        ? Number(b.id === recommended?.id) - Number(a.id === recommended?.id)
        : 0) ||
      a.size - b.size ||
      a.name.localeCompare(b.name, locale),
  );
  const searchIndex = useMemo(
    () =>
      new Map(
        models.map((model) => {
          const profile = modelProfiles[model.id];
          return [
            model.id,
            normalizeModelSearch(
              [
                model.name,
                nativeText(model.description),
                nativeText(profile?.tagline ?? ""),
                nativeText(modelUseCases[model.id] ?? ""),
                ...(profile?.languages ?? []),
                ...(profile?.languages.map(languageName) ?? []),
              ].join(" "),
              locale,
            ),
          ];
        }),
      ),
    [models, locale],
  );
  const search = normalizeModelSearch(query.trim(), locale).split(/\s+/).filter(Boolean);
  const visible = sorted.filter(
    (model) =>
      (!onlyDownloaded ||
        model.installed ||
        model.path === settings.modelPath ||
        model.id === downloadingModelId) &&
      search.every((word) => searchIndex.get(model.id)?.includes(word)),
  );
  const displayed = embedded && !showCatalog && !query ? visible.slice(0, 1) : visible;
  useEffect(() => {
    if (!guidanceTarget) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`model-${guidanceTarget.id}-heading`)?.focus();
      setGuidanceTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [guidanceTarget]);
  function showModel(model: Model) {
    setQuery("");
    setCatalogScope("all");
    setShowCatalog(true);
    setGuidanceOpen(false);
    setGuidanceTarget(model);
  }
  function selectModel(model: Model) {
    if (!isDesktop || busy || pending) return;
    void (model.installed
      ? run(() => backend.settings({ ...settings, modelPath: model.path }))
      : installModel(model));
  }
  async function remove() {
    if (!removing || pending) return;
    setPending(true);
    setError("");
    try {
      await backend.removeModel(removing.id);
      setRemoving(null);
      await run(refresh, false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }
  const modelLocations = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        {t("modelsPage.dictationRunsOnYourDevice")}
      </span>
      <Link
        to="/settings?section=advanced&focus=modelPath-row"
        className="inline-flex items-center gap-1.5 rounded outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderOpen aria-hidden="true" className="size-3.5" />
        {t("modelsPage.bringYourOwnModel")}
      </Link>
    </div>
  );
  const guidanceToggle = (
    <Button
      variant="ghost"
      size="sm"
      className="h-auto min-h-8 max-w-full whitespace-normal"
      aria-expanded={guidanceOpen}
      aria-controls={guidanceId}
      onClick={() => setGuidanceOpen(!guidanceOpen)}
    >
      {t("modelsPage.helpMeChoose")}
    </Button>
  );
  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeading title={t("modelsPage.models")} description={t("uiPolish.modelsDescription")}>
          <p
            aria-label={t("modelsPage.modelStorage")}
            className="text-xs text-muted-foreground tabular-nums"
          >
            {installedCount} {t("modelsPage.downloaded")} · {megabytes(diskBytes)}
          </p>
        </PageHeading>
      )}
      {status.phase === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {nativeText(status.message)}
        </p>
      )}
      {settings.modelPath && !currentModel && (
        <section
          aria-label={t("modelsPage.currentSpeechModel")}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
        >
          <div>
            <p className="text-xs text-muted-foreground">{t("homePage.customModel")}</p>
            <p className="mt-1 text-sm font-medium">
              {settings.modelPath.split(/[\\/]/).pop()} ·{" "}
              {snapshot.ready ? t("modelsPage.active") : t("modelsPage.needsAttention")}
            </p>
          </div>
          <Link
            className="text-sm text-primary underline underline-offset-4"
            to="/settings?section=advanced&focus=modelPath-row"
          >
            {t("modelsPage.openSettings")}
          </Link>
        </section>
      )}
      <section aria-labelledby="model-library-heading" className="space-y-4">
        <h2 id="model-library-heading" className="sr-only">
          {t("modelsPage.chooseYourModel")}
        </h2>
        {embedded && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {modelLocations}
            {guidanceToggle}
          </div>
        )}

        {!embedded && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="relative w-full min-w-0 max-w-xs">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
              />
              <Input
                aria-label={t("uiPolish.searchModels")}
                placeholder={t("uiPolish.searchModelsHint")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div
              role="group"
              aria-label={t("modelsPage.models")}
              className="flex min-w-0 max-w-full flex-wrap rounded-lg bg-muted/50 p-1 [&_button]:h-auto [&_button]:min-h-8 [&_button]:min-w-0 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:[overflow-wrap:anywhere]"
            >
              <Button
                size="sm"
                variant={onlyDownloaded ? "ghost" : "secondary"}
                className={
                  !onlyDownloaded
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground"
                }
                aria-pressed={!onlyDownloaded}
                aria-description={t("uiPolish.modelsInCatalog", { count: models.length })}
                onClick={() => setCatalogScope("all")}
              >
                {!onlyDownloaded && <Check aria-hidden="true" className="size-3.5" />}
                {t("uiPolish.allModels")}
                <span aria-hidden="true" className="text-xs tabular-nums">
                  {models.length}
                </span>
              </Button>
              <Button
                size="sm"
                variant={onlyDownloaded ? "secondary" : "ghost"}
                className={
                  onlyDownloaded
                    ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground"
                }
                aria-pressed={onlyDownloaded}
                onClick={() => setCatalogScope("downloaded")}
              >
                {onlyDownloaded && <Check aria-hidden="true" className="size-3.5" />}
                {t("uiPolish.downloaded")}
              </Button>
            </div>
            {guidanceToggle}
          </div>
        )}
        <div id={guidanceId} hidden={!guidanceOpen}>
          <ModelGuidance
            models={models}
            language={settings.language}
            selectedModelPath={settings.modelPath}
            disabled={!isDesktop || busy || pending}
            onShow={showModel}
            onUse={(model) => {
              if (!isDesktop || busy || pending) return;
              showModel(model);
              selectModel(model);
            }}
          />
        </div>
        {!embedded && !guidanceOpen && (
          <p className="text-xs leading-5 text-muted-foreground">
            {t("uiPolish.modelComparisonGuide")}
          </p>
        )}
        <div className="@container/models overflow-hidden rounded-xl border bg-card/30">
          <div className="hidden grid-cols-[minmax(0,1fr)_10rem_12rem_10rem] gap-x-4 border-b bg-muted/30 px-5 py-2 text-xs font-medium text-muted-foreground @min-[48rem]/models:grid">
            <span>{t("common.speechModel")}</span>
            <span>{t("uiPolish.performanceColumn")}</span>
            <span>{t("uiPolish.languageSizeColumn")}</span>
            <span className="text-right">{t("uiPolish.modelActionsColumn")}</span>
          </div>
          {displayed.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selectedModelPath={settings.modelPath}
              disabled={!isDesktop || busy || pending}
              sizeLabel={megabytes(model.diskBytes || model.size)}
              recommended={
                model.id === recommended?.id && !model.installed && !currentModel?.installed
              }
              download={
                downloading && downloadingModelId === model.id
                  ? { percent: downloadPercent, message: status.message }
                  : undefined
              }
              onUse={() => selectModel(model)}
              onRepair={model.installed ? () => void installModel(model) : undefined}
              onRemove={() => {
                setError("");
                setRemoving(model);
              }}
              onCancelDownload={() => void run(backend.cancel)}
            />
          ))}
          {!displayed.length && (
            <p role="status" className="p-8 text-center text-sm text-muted-foreground">
              {t("uiPolish.noModelsFound")}
            </p>
          )}
        </div>
        {embedded && visible.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showCatalog}
            onClick={() => setShowCatalog(!showCatalog)}
          >
            {showCatalog ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            {showCatalog
              ? t("uiPolish.showFewerModels")
              : t("uiPolish.showAllModels", { count: visible.length })}
          </Button>
        )}
        {!embedded && modelLocations}
      </section>
      <Dialog
        open={!!removing}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !pending) setRemoving(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t("common.remove")} {removing?.name}?
            </DialogTitle>
            <DialogDescription>
              {t("modelsPage.removeDescription", { size: megabytes(removing?.diskBytes ?? 0) })}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {nativeText(error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setRemoving(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={pending || busy} onClick={() => void remove()}>
              {pending ? t("modelsPage.removing") : t("modelsPage.removeModel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
