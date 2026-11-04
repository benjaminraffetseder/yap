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
import { Menu } from "@base-ui/react/menu";
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
}: {
  profile: DictationProfile;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  selectorRef: RefObject<HTMLButtonElement | null>;
  showModified?: boolean;
}) {
  const languages = useLanguages();
  const { t } = useTranslation();
  const { snapshot, loading, refresh } = useDictation();
  const [review, setReview] = useState<Review | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const running = useRef(false);
  const group = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const openingReview = useRef(false);
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

  function open(kind: Review["kind"]) {
    if (blocked || running.current || refreshFailed) return;
    openingReview.current = true;
    setName("");
    setError("");
    setCompleted("");
    setReview({
      kind,
      baseline: reviewKey(snapshot, profile.id),
      choices: currentChoices(snapshot, profile),
    });
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
      // The write is complete even if fetching the resulting snapshot fails.
      try {
        await refresh();
        setReview(null);
        if (kind === "restore") requestAnimationFrame(() => selectorRef.current?.focus());
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
      requestAnimationFrame(() => selectorRef.current?.focus());
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
      className="min-w-0 max-w-full rounded-md outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {(modified || refreshFailed) && (
        <Menu.Root
          onOpenChange={(open) => {
            if (open) openingReview.current = false;
          }}
        >
          <Menu.Trigger
            ref={opener}
            disabled={blocked}
            render={<Button variant="outline" size="sm" />}
            className="h-auto min-h-8 max-w-full border-primary/25 bg-transparent whitespace-normal text-xs text-primary"
            aria-label={
              modified ? t("dictationProfiles.modified") : t("homeProfileActions.profileChanges")
            }
          >
            {modified ? t("dictationProfiles.modified") : t("homeProfileActions.profileChanges")}
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="start" sideOffset={8} className="z-50">
              <Menu.Popup
                finalFocus={() => (openingReview.current ? false : true)}
                className="w-64 max-w-[calc(100vw-2rem)] origin-(--transform-origin) rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg motion-popup [overflow-wrap:anywhere]"
              >
                <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                  {refreshFailed
                    ? t("homeProfileActions.changesAreSavedRefreshTheViewBefore")
                    : t("homeProfileActions.currentChoicesDifferFromYourSavedProfile", {
                        name: profile.name,
                      })}
                </p>
                {refreshFailed ? (
                  <Menu.Item
                    onClick={() => void retryRefresh()}
                    className="rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-accent"
                  >
                    {t("homeProfileActions.refreshSavedChanges")}
                  </Menu.Item>
                ) : (
                  <>
                    <Menu.Item
                      disabled={blocked}
                      onClick={() => void mutate("restore")}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50"
                    >
                      <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
                      {t("homeProfileActions.restoreSavedChoices")}
                    </Menu.Item>
                    <Menu.Item
                      disabled={blocked}
                      onClick={() => open("update")}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50"
                    >
                      <Check aria-hidden="true" className="size-4 shrink-0" />
                      {t("homeProfileActions.updateProfile")}
                    </Menu.Item>
                    <Menu.Item
                      disabled={blocked || full || !snapshot.settings.modelPath}
                      onClick={() => open("new")}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:opacity-50"
                    >
                      <Plus aria-hidden="true" className="size-4 shrink-0" />
                      {t("homeProfileActions.saveAsNew")}
                    </Menu.Item>
                    {full && (
                      <p className="px-2 py-2 text-xs text-muted-foreground">
                        {t("homeProfileActions.youCanSaveUpTo20Additional")}
                      </p>
                    )}
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
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
            openingReview.current = false;
            setReview(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() =>
            opener.current?.isConnected && !opener.current.matches(":disabled")
              ? opener.current
              : selectorRef.current
          }
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
                openingReview.current = false;
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
