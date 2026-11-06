import { useState } from "react";
import { Check, Download, Trash2, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backend, isBusy, isDesktop, message, type TextModel } from "@/lib/backend";
import { nativeText } from "@/i18n/native-text";
import { cn } from "@/lib/utils";

export function TextModelLibrary({
  embedded = false,
  disabled = false,
}: {
  embedded?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { snapshot, loading, run, refresh } = useDictation();
  const [removing, setRemoving] = useState<TextModel | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = disabled || loading || pending || isBusy(snapshot.status.phase) || !isDesktop;
  const supported = snapshot.textRuntimeAvailable;
  const downloading =
    snapshot.status.phase === "downloading" &&
    /text runtime|gemma-4-/.test(snapshot.status.message);
  async function selectModel(model: TextModel) {
    if (busy || !supported || !model.installed) return;
    setPending(true);
    try {
      const current = snapshot.textProcessing;
      await run(() =>
        backend.textProcessing({
          ...current,
          enabled: true,
          provider: "builtin",
          model: model.id,
          contextLength:
            current.provider === "builtin" && (current.contextLength ?? 0) <= model.maxContext
              ? (current.contextLength ?? 0)
              : 0,
        }),
      );
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!removing || busy) return;
    setPending(true);
    setError("");
    try {
      await backend.removeTextModel(removing.id);
      setRemoving(null);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      id="text-models"
      aria-labelledby="text-models-heading"
      className="space-y-4 scroll-mt-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="text-models-heading" className="font-semibold">
            {t("textModels.title")}
          </h2>
          {!embedded && (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("textModels.description")}
            </p>
          )}
        </div>
        {!embedded && (
          <Link
            to="/prompts?section=models"
            className="text-sm text-primary underline underline-offset-4"
          >
            {t("textModels.configure")}
          </Link>
        )}
      </div>
      {!supported && <p className="text-sm text-muted-foreground">{t("textModels.windowsOnly")}</p>}
      {downloading && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm">
              {nativeText(snapshot.status.message)}
            </p>
            <Button size="sm" variant="outline" onClick={() => void run(backend.cancel, false)}>
              {t("common.cancel")}
            </Button>
          </div>
          <Progress
            aria-label={t("textModels.download")}
            value={Math.min(100, Math.max(0, snapshot.status.progress * 100))}
          />
        </div>
      )}
      <div className="@container/models overflow-hidden rounded-xl border bg-card/30">
        <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.35fr)_7rem_15rem] gap-x-6 border-b bg-muted/30 px-5 py-2 text-xs font-medium text-muted-foreground @min-[54rem]/models:grid">
          <span>{t("promptsPage.textModel")}</span>
          <span>{t("textModels.formatColumn")}</span>
          <span>{t("modelCard.downloadSize")}</span>
          <span className="text-right">{t("uiPolish.modelActionsColumn")}</span>
        </div>
        {(snapshot.textModels ?? []).map((model) => {
          const active =
            snapshot.textProcessing.enabled &&
            snapshot.textProcessing.provider === "builtin" &&
            snapshot.textProcessing.model === model.id;
          return (
            <article
              key={model.id}
              data-slot="model-row"
              aria-label={model.name}
              aria-current={active ? "true" : undefined}
              className={cn(
                "min-w-0 border-b px-4 py-2 last:border-b-0 sm:px-5",
                active && model.installed && "bg-primary/5",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 @min-[54rem]/models:grid @min-[54rem]/models:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.35fr)_7rem_15rem]">
                <div className="min-w-0 flex-[1_1_15rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{model.name}</h3>
                    {active && (
                      <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        <Check aria-hidden="true" className="size-3" />
                        {t("modelsPage.active")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t(
                      model.installed
                        ? "textModels.downloaded"
                        : model.diskBytes
                          ? "textModels.partial"
                          : "textModels.notDownloaded",
                    )}
                  </p>
                </div>
                <p className="min-w-0 text-xs leading-5 text-muted-foreground">
                  {t("textModels.format")}
                </p>
                <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t("textModels.size", {
                    size: (model.size / 1e9).toLocaleString(i18n.resolvedLanguage, {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </p>
                <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1 @min-[54rem]/models:w-full">
                  {(!model.installed || !active) && (
                    <Button
                      size="sm"
                      variant={model.installed ? "outline" : "ghost"}
                      className="h-auto min-h-8 max-w-full whitespace-normal"
                      disabled={busy || !supported}
                      onClick={() =>
                        model.installed
                          ? void selectModel(model)
                          : void run(() => backend.installTextModel(model.id))
                      }
                    >
                      {!model.installed && <Download aria-hidden="true" className="size-3.5" />}
                      {t(
                        model.installed
                          ? "modelCard.useModel"
                          : model.diskBytes
                            ? "textModels.resume"
                            : "textModels.download",
                      )}
                    </Button>
                  )}
                  {(model.installed || !!model.diskBytes) && (
                    <ActionMenu
                      label={`${t("uiPolish.moreActions")} · ${model.name}`}
                      disabled={busy}
                    >
                      {model.installed && (
                        <ActionMenuItem
                          disabled={busy}
                          onClick={() => void run(() => backend.installTextModel(model.id))}
                        >
                          <Wrench aria-hidden="true" />
                          {t("textModels.repair")}
                        </ActionMenuItem>
                      )}
                      <ActionMenuItem
                        destructive
                        disabled={busy || active}
                        onClick={() => {
                          setError("");
                          setRemoving(model);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                        {t("common.remove")}
                      </ActionMenuItem>
                    </ActionMenu>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t("textModels.memoryHelp")}</p>
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
            <DialogDescription>{t("textModels.removeHelp")}</DialogDescription>
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
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              {t("common.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
