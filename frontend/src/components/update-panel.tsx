import { useDictation } from "@/components/dictation-provider";
import { SettingsSection } from "@/components/settings-section";
import { Button } from "@/components/ui/button";
import { backend, isDesktop } from "@/lib/backend";

export function UpdatePanel() {
  const { update, checkingUpdates, updateError, checkUpdates, run } = useDictation();
  return (
    <SettingsSection title="App updates">
      <div className="space-y-3 py-4">
        {update && <p className="text-sm">Installed version: {update.currentVersion}</p>}
        {!isDesktop ? (
          <p className="text-sm text-muted-foreground">
            Open Yap on your desktop to check for updates.
          </p>
        ) : update && !update.supported ? (
          <p className="text-sm text-muted-foreground">
            Update checks are available on Windows x64.
          </p>
        ) : update && !update.configured ? (
          <p className="text-sm text-muted-foreground">
            GitHub update checks aren’t configured for this build.
          </p>
        ) : (
          <>
            {checkingUpdates && (
              <p role="status" className="text-sm">
                Checking for updates…
              </p>
            )}
            {updateError && (
              <p role="alert" className="text-sm text-destructive">
                {updateError}
              </p>
            )}
            {update?.available ? (
              <>
                <p className="text-sm font-medium">Yap {update.latestVersion} is available.</p>
                {update.notes && (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {update.notes}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Download the installer, choose Quit Yap from the tray menu, then run setup. Your
                  settings, history, and downloaded models will be kept.
                </p>
                <Button onClick={() => void run(backend.downloadUpdate, false)}>
                  Download update
                </Button>
              </>
            ) : update?.checkedAt && !updateError && !checkingUpdates ? (
              <p role="status" className="text-sm">
                {update.message || "You’re up to date."}
              </p>
            ) : null}
            {update?.checkedAt && (
              <p className="text-xs text-muted-foreground">
                Last checked: {new Date(update.checkedAt).toLocaleString()}
              </p>
            )}
            <Button
              variant="outline"
              disabled={checkingUpdates}
              onClick={() => void checkUpdates()}
            >
              Check for updates
            </Button>
            <p className="text-xs text-muted-foreground">
              Yap checks GitHub Releases at startup, at most once a day. Checking sends no
              recordings or transcripts.
            </p>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
