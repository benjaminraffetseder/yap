import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { Button } from "@/components/ui/button";
import { backend, isBusy, isDesktop } from "@/lib/backend";
import { Keyboard } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

export function ShortcutStatus({
  disabled = false,
  profile = false,
  variant = "inline",
}: {
  disabled?: boolean;
  profile?: boolean;
  variant?: "inline" | "banner" | "notice";
}) {
  const { t } = useTranslation();
  const { snapshot, run } = useDictation();
  const [pending, setPending] = useState(false);
  const retrying = useRef(false);
  const error = profile ? snapshot.status.profileShortcutError : snapshot.status.shortcutError;
  if (!error) return null;
  async function retry() {
    if (retrying.current) return;
    retrying.current = true;
    setPending(true);
    try {
      await run(backend.retryShortcut);
    } finally {
      retrying.current = false;
      setPending(false);
    }
  }
  const retryButton = (
    <Button
      variant="outline"
      size="sm"
      className={
        variant !== "inline"
          ? "h-auto min-h-8 max-w-full whitespace-normal py-1 [overflow-wrap:anywhere]"
          : undefined
      }
      disabled={disabled || pending || !isDesktop || isBusy(snapshot.status.phase)}
      onClick={() => void retry()}
    >
      {pending
        ? t("shortcutStatus.retrying")
        : profile
          ? t("shortcutStatus.retryProfileShortcut")
          : t("shortcutStatus.retryShortcut")}
    </Button>
  );
  if (variant !== "inline") {
    const permission = /accessibility|permission|input monitoring/i.test(error);
    return (
      <section
        aria-label={t("shortcutStatus.shortcutRecovery")}
        className={
          variant === "notice"
            ? "@container/shortcut min-w-0 [overflow-wrap:anywhere]"
            : "@container/shortcut min-w-0 rounded-xl border border-amber-500/25 bg-amber-500/5 [overflow-wrap:anywhere]"
        }
      >
        <div
          className={
            variant === "notice"
              ? "flex min-w-0 gap-3"
              : "flex min-w-0 gap-3 p-4 @max-[20rem]/shortcut:p-3"
          }
        >
          <Keyboard
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-700 @max-[20rem]/shortcut:hidden dark:text-amber-400"
          />
          <div className={`min-w-0 flex-1 ${variant === "notice" ? "space-y-2" : "space-y-3"}`}>
            <div role="alert" className="space-y-1">
              <p className="text-sm font-medium">
                {profile
                  ? t("shortcutStatus.profileShortcutUnavailable")
                  : t("shortcutStatus.globalShortcutUnavailable")}
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                {permission
                  ? t("shortcutStatus.allowYapInYourSystemSAccessibility")
                  : t("shortcutStatus.releaseThisShortcutInTheOtherApp")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {retryButton}
              <Button
                variant="ghost"
                size="sm"
                className="h-auto min-h-8 max-w-full whitespace-normal py-1"
                render={
                  <Link
                    to={`/settings?section=dictation&focus=${profile ? "profile-cycle-shortcut" : "shortcut"}`}
                  />
                }
              >
                {t("shortcutStatus.changeShortcut")}
              </Button>
            </div>
            <details className="text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              <summary className="w-fit cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("diagnosticsPanel.technicalDetails")}
              </summary>
              <p className="mt-2">{nativeText(error)}</p>
            </details>
          </div>
        </div>
      </section>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <p role="alert" className="text-xs text-destructive">
        {nativeText(error)}
      </p>
      {retryButton}
    </div>
  );
}
