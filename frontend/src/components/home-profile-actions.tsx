import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible } from "@base-ui/react/collapsible";
import { Check, ChevronDown, Plus, RotateCcw } from "lucide-react";
import {
  backend,
  isBusy,
  isDesktop,
  message,
  processingOptions,
  type DictationProfile,
  type Snapshot,
} from "@/lib/backend";
import { useLanguages } from "@/lib/languages";
import { useId, useRef, useState, type RefObject } from "react";

type Review = { kind: "update" | "new"; baseline: string; choices: DictationProfile };

function currentChoices(snapshot: Snapshot, profile: DictationProfile): DictationProfile {
  return {
    id: profile.id,
    name: profile.name,
    modelPath: snapshot.settings.modelPath,
    language: snapshot.settings.language,
    cleanText: snapshot.settings.cleanText,
    autoPromptId: snapshot.textProcessing.autoPromptId,
  };
}

function reviewKey(snapshot: Snapshot, id: string) {
  const saved = snapshot.dictationProfiles?.find((p) => p.id === id);
  return JSON.stringify([
    snapshot.activeProfileId,
    saved && [
      saved.id,
      saved.name,
      saved.modelPath,
      saved.language,
      saved.cleanText,
      saved.autoPromptId,
    ],
    snapshot.settings.modelPath,
    snapshot.settings.language,
    snapshot.settings.cleanText,
    snapshot.textProcessing.autoPromptId,
    snapshot.textProcessing.enabled,
    processingOptions(snapshot.textProcessing).map((option) => option.value),
  ]);
}

export function HomeProfileActions({
  profile,
  disabled = false,
  onPendingChange,
  selectorRef,
  showModified = true,
  onReviewOpen,
  reviewReturnFocusRef,
  onReceipt,
}: {
  profile: DictationProfile;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  selectorRef: RefObject<HTMLButtonElement | null>;
  showModified?: boolean;
  onReviewOpen?: () => void;
  reviewReturnFocusRef?: RefObject<HTMLButtonElement | null>;
  onReceipt?: (receipt: string) => void;
}) {
  const languages = useLanguages();
  const { t } = useTranslation();
  const { snapshot, loading, refresh } = useDictation();
  const [review, setReview] = useState<Review | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const running = useRef(false);
  const group = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const nameID = useId();
  const modified =
    showModified && !!snapshot.profileModified && snapshot.activeProfileId === profile.id;
  const blocked = disabled || !isDesktop || loading || pending || isBusy(snapshot.status.phase);
  const stale = !!review && review.baseline !== reviewKey(snapshot, profile.id);
  const profiles = snapshot.dictationProfiles ?? [];
  const full = profiles.filter((p) => p.id !== snapshot.defaultProfileId).length >= 20;
  const choices = review?.choices ?? currentChoices(snapshot, profile);
  const trimmed = name.trim();
  const reason =
    review?.kind === "new" && !trimmed
      ? t("dictationProfiles.giveThisProfileAName")
      : review?.kind === "new" && (Array.from(trimmed).length > 60 || /[\r\n\0]/.test(name))
        ? t("homeProfileActions.useANameOfUpTo60Characters")
        : review?.kind === "new" &&
            profiles.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())
          ? t("homeProfileActions.chooseAUniqueProfileName")
          : review?.kind === "new" && full
            ? t("homeProfileActions.youCanSaveUpTo20Additional")
            : !choices.modelPath
              ? t("homeProfileActions.chooseASpeechModelFirst")
              : choices.autoPromptId &&
                  !processingOptions(snapshot.textProcessing).some(
                    (p) => p.value === choices.autoPromptId,
                  )
                ? t("homeProfileActions.chooseAnAvailablePromptOrChainInPrompts")
                : choices.autoPromptId && !snapshot.textProcessing.enabled
                  ? t("homeProfileActions.enableTheSharedTextModelInPromptsFirst")
                  : "";

  function focusTarget() {
    return (
      [opener.current, selectorRef.current, reviewReturnFocusRef?.current].find(
        (element) =>
          element?.isConnected &&
          !element.matches(":disabled") &&
          element.getClientRects().length > 0,
      ) ?? null
    );
  }

  function open(kind: Review["kind"]) {
    if (blocked || running.current || refreshFailed) return;
    setExpanded(false);
    setName("");
    setError("");
    setCompleted("");
    setReview({
      kind,
      baseline: reviewKey(snapshot, profile.id),
      choices: currentChoices(snapshot, profile),
    });
    onReviewOpen?.();
  }

  async function mutate(kind: "restore" | "update" | "new") {
    if (
      blocked ||
      running.current ||
      refreshFailed ||
      (kind !== "restore" && (reason || stale || !review))
    )
      return;
    running.current = true;
    onReceipt?.("");
    setPending(true);
    onPendingChange?.(true);
    setError("");
    setCompleted("");
    try {
      // A shortcut or another window can change the profile after the UI rendered.
      const fresh = await backend.snapshot();
      if (isBusy(fresh.status.phase))
        throw new Error(t("homeProfileActions.finishTheCurrentOperationBeforeChangingProfiles"));
      if ((review?.baseline ?? reviewKey(snapshot, profile.id)) !== reviewKey(fresh, profile.id)) {
        await refresh();
        throw new Error(t("homeProfileActions.settingsOrProfileChangedReviewTheCurrentChoices"));
      }
      if (kind === "restore") {
        await backend.applyProfile(profile.id);
      } else {
        await backend.saveProfile({
          ...choices,
          id: kind === "new" ? "" : profile.id,
          name: kind === "new" ? trimmed : profile.name,
        });
      }
      const receipt =
        kind === "restore"
          ? t("homeProfileActions.restoredChoices", { name: profile.name })
          : kind === "update"
            ? t("homeProfileActions.updatedProfile", { name: profile.name })
            : t("homeProfileActions.savedProfile", {
                name: trimmed,
                activeProfile: profile.name,
              });
      setCompleted(receipt);
      onReceipt?.(receipt);
      // The write is complete even if fetching the resulting snapshot fails.
      try {
        await refresh();
        setReview(null);
        if (kind === "restore") requestAnimationFrame(() => focusTarget()?.focus());
      } catch (cause) {
        setRefreshFailed(true);
        setError(
          t("homeProfileActions.changesSavedCouldNotRefreshTheCurrent", { cause: message(cause) }),
        );
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      running.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }

  async function retryRefresh() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    onPendingChange?.(true);
    try {
      await refresh();
      setRefreshFailed(false);
      setError("");
      setReview(null);
      requestAnimationFrame(() => focusTarget()?.focus());
    } catch (cause) {
      setError(
        t("homeProfileActions.changesSavedCouldNotRefreshTheCurrent", { cause: message(cause) }),
      );
    } finally {
      running.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }

  if (!modified && !review && !completed && !error) return null;
  return (
    <div
      ref={group}
      tabIndex={-1}
      role="group"
      aria-busy={pending}
      aria-label={t("homeProfileActions.changesTo", { name: profile.name })}
      className={`${expanded ? "basis-full" : ""} min-w-0 max-w-full rounded-md outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {(modified || refreshFailed) && (
        <Collapsible.Root open={expanded} onOpenChange={setExpanded}>
          <Collapsible.Trigger
            ref={opener}
            disabled={blocked}
            render={<Button variant="ghost" size="sm" />}
            className="h-auto min-h-7 max-w-full gap-1 px-1 py-1 whitespace-normal text-xs text-primary"
            aria-label={
              modified ? t("dictationProfiles.modified") : t("homeProfileActions.profileChanges")
            }
          >
            {modified ? t("dictationProfiles.modified") : t("homeProfileActions.profileChanges")}
            <ChevronDown
              aria-hidden="true"
              className={`size-3.5 ${expanded ? "rotate-180" : ""}`}
            />
          </Collapsible.Trigger>
          <Collapsible.Panel
            role="region"
            aria-label={t("homeProfileActions.profileChanges")}
            className="mt-2 space-y-1 border-y py-2"
          >
            <p className="px-2 pb-2 text-xs leading-5 text-muted-foreground">
              {refreshFailed
                ? t("homeProfileActions.changesAreSavedRefreshTheViewBefore")
                : t("homeProfileActions.currentChoicesDifferFromYourSavedProfile", {
                    name: profile.name,
                  })}
            </p>
            {refreshFailed ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={blocked}
                onClick={() => void retryRefresh()}
              >
                {t("homeProfileActions.refreshSavedChanges")}
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={blocked}
                  onClick={() => void mutate("restore")}
                  className="h-auto min-h-8 w-full justify-start py-1 whitespace-normal"
                >
                  <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
                  {t("homeProfileActions.restoreSavedChoices")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={blocked}
                  onClick={() => open("update")}
                  className="h-auto min-h-8 w-full justify-start py-1 whitespace-normal"
                >
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                  {t("homeProfileActions.updateProfile")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={blocked || full || !snapshot.settings.modelPath}
                  onClick={() => open("new")}
                  className="h-auto min-h-8 w-full justify-start py-1 whitespace-normal"
                >
                  <Plus aria-hidden="true" className="size-4 shrink-0" />
                  {t("homeProfileActions.saveAsNew")}
                </Button>
                {full && (
                  <p className="px-2 text-xs text-muted-foreground">
                    {t("homeProfileActions.youCanSaveUpTo20Additional")}
                  </p>
                )}
              </>
            )}
          </Collapsible.Panel>
        </Collapsible.Root>
      )}
      {!review && completed && (
        <p role="status" className="sr-only">
          {completed}
        </p>
      )}
      {!review && error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {nativeText(error)}
        </p>
      )}
      {!review && refreshFailed && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void retryRefresh()}>
          {t("homeProfileActions.refresh")}
        </Button>
      )}
      <Dialog
        open={!!review}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !running.current) {
            setReview(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => focusTarget()}
          className="@container/review max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere]"
        >
          <DialogHeader>
            <DialogTitle>
              {review?.kind === "new"
                ? t("homeProfileActions.saveAsNewProfile")
                : t("homeProfileActions.update", { name: review?.choices.name })}
            </DialogTitle>
            <DialogDescription>
              {review?.kind === "new"
                ? t("homeProfileActions.saveTheseCurrentChoicesAsASeparate")
                : t("homeProfileActions.replaceThisProfileSSavedChoicesWith")}
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm @min-[24rem]/review:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{t("common.speechModel")}</dt>
            <dd>
              {snapshot.models.find((m) => m.path === choices.modelPath)?.name ??
                choices.modelPath.split(/[\\/]/).pop() ??
                t("homeProfileActions.none")}
            </dd>
            <dt className="text-muted-foreground">{t("homeProfileActions.language")}</dt>
            <dd>
              {languages.find((l) => l.value === choices.language)?.label ?? choices.language}
            </dd>
            <dt className="text-muted-foreground">{t("settingsPage.lightCleanup")}</dt>
            <dd>{choices.cleanText ? t("common.on") : t("common.off")}</dd>
            <dt className="text-muted-foreground">{t("dictationProfiles.afterDictation")}</dt>
            <dd>
              {processingOptions(snapshot.textProcessing).find(
                (p) => p.value === choices.autoPromptId,
              )?.label ??
                (choices.autoPromptId
                  ? t("dictationProfiles.promptOrChainUnavailable")
                  : t("common.noAutomaticProcessing"))}
            </dd>
          </dl>
          {review?.kind === "new" && (
            <div className="space-y-2">
              <Label htmlFor={nameID}>{t("dictationProfiles.profileName")}</Label>
              <Input
                id={nameID}
                value={name}
                disabled={pending || !!completed}
                aria-invalid={!!name && !!reason}
                aria-describedby={`${nameID}-reason`}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void mutate("new");
                  }
                }}
              />
              <p id={`${nameID}-reason`} role="status" className="text-xs text-muted-foreground">
                {reason || t("homeProfileActions.nothingIsSavedUntilYouChooseSave")}
              </p>
            </div>
          )}
          {!completed && stale && (
            <p role="alert" className="text-sm text-destructive">
              {t("homeProfileActions.settingsOrProfileChangedCloseThisDialog")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {nativeText(error)}
            </p>
          )}
          {completed && (
            <p role="status" className="text-sm">
              {completed}
            </p>
          )}
          {!completed && reason && review?.kind === "update" && (
            <p role="alert" className="text-sm text-destructive">
              {reason}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setReview(null);
              }}
            >
              {completed ? t("dictationProfiles.done") : t("common.cancel")}
            </Button>
            {refreshFailed ? (
              <Button disabled={pending} onClick={() => void retryRefresh()}>
                {t("homeProfileActions.refresh")}
              </Button>
            ) : (
              <Button
                disabled={blocked || stale || !!reason || !!completed}
                onClick={() => void mutate(review?.kind === "new" ? "new" : "update")}
              >
                {pending
                  ? t("autoSaveStatus.saving")
                  : review?.kind === "new"
                    ? t("homeProfileActions.saveAsNew2")
                    : t("homeProfileActions.updateProfile2")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
