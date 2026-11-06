import i18n from "@/i18n";
import { useTranslation } from "react-i18next";
import { useDictation } from "@/components/dictation-provider";
import { SettingsSection } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import { backend, isDesktop } from "@/lib/backend";

export function UpdatePanel() {
  const { t } = useTranslation();
  const { update, checkingUpdates, updateError, checkUpdates, run } = useDictation();
  return (
    <SettingsSection
      title={t("updatePanel.appUpdates")}
      action={
        isDesktop && update?.supported !== false && update?.configured !== false ? (
          <Button
            variant="outline"
            size="sm"
            disabled={checkingUpdates}
            onClick={() => void checkUpdates()}
          >
            {t("commandMenu.checkForUpdates")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3 py-3">
        {!isDesktop ? (
          <p className="text-sm text-muted-foreground">
            {t("updatePanel.openYapOnYourDesktopToCheck")}
          </p>
        ) : update && !update.supported ? (
          <p className="text-sm text-muted-foreground">
            {t("updatePanel.updateChecksAreAvailableOnWindowsX64")}
          </p>
        ) : update && !update.configured ? (
          <p className="text-sm text-muted-foreground">
            {t("updatePanel.gitHubUpdateChecksArenTConfiguredFor")}
          </p>
        ) : (
          <>
            {checkingUpdates && (
              <p role="status" className="text-sm">
                {t("updatePanel.checkingForUpdates")}
              </p>
            )}
            {updateError && (
              <p role="alert" className="text-sm text-destructive">
                {updateError}
              </p>
            )}
            {update?.available ? (
              <>
                <p className="text-sm font-medium">
                  Yap {update.latestVersion} {t("appLayout.isAvailable")}
                </p>
                {update.notes && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {update.notes}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {t("updatePanel.downloadTheInstallerChooseQuitYapFrom")}
                </p>
                <Button onClick={() => void run(backend.downloadUpdate, false)}>
                  {t("appLayout.downloadUpdate")}
                </Button>
              </>
            ) : update?.checkedAt && !updateError && !checkingUpdates ? (
              <p role="status" className="text-sm">
                {update.message || t("updatePanel.youReUpToDate")}
              </p>
            ) : null}
          </>
        )}
        {isDesktop && (
          <details className="text-xs leading-5 text-muted-foreground">
            <summary className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("uiPolish.technicalDetails")}
            </summary>
            <div className="mt-3 space-y-2">
              {update && (
                <p>
                  {t("updatePanel.installedVersion")} {update.currentVersion}
                </p>
              )}
              {update?.checkedAt && (
                <p>
                  {t("updatePanel.lastChecked")}{" "}
                  {new Date(update.checkedAt).toLocaleString(i18n.resolvedLanguage)}
                </p>
              )}
              <p>{t("updatePanel.privacy")}</p>
            </div>
          </details>
        )}
      </div>
    </SettingsSection>
  );
}
