import { useMemo, useState } from "react";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useDictation } from "@/components/dictation-provider";
import { SettingsSection } from "@/components/settings-section";
import { ShortcutInput } from "@/components/shortcut-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  backend,
  isDesktop,
  message,
  type AppProfileRule,
  type ProfileApplication,
} from "@/lib/backend";

export function ProfileAutomationPanel({ disabled }: { disabled: boolean }) {
  const { snapshot, refresh, run } = useDictation();
  const saved = useMemo(
    () => ({ rules: snapshot.appProfileRules ?? [], shortcut: snapshot.profileShortcut ?? "" }),
    [snapshot.appProfileRules, snapshot.profileShortcut],
  );
  const [value, setDraft] = useSavedDraft("profile-automation", saved);
  const [apps, setApps] = useState<ProfileApplication[]>([]);
  const [appID, setAppID] = useState<string | null>(null);
  const [profileID, setProfileID] = useState<string | null>(null);
  const [loadingApps, setLoadingApps] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [appError, setAppError] = useState("");
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const blocked = disabled || pending || !isDesktop;
  const profiles = (snapshot.dictationProfiles ?? []).map((p) => ({ value: p.id, label: p.name }));
  const availableApps = apps.filter(
    (app) => !value.rules.some((rule) => rule.applicationId === app.id),
  );
  const appOptions = availableApps.map((app) => ({ value: app.id, label: app.name }));
  async function loadApps() {
    setLoadingApps(true);
    setAppError("");
    try {
      setApps(await backend.profileApplications());
    } catch (cause) {
      setAppError(message(cause));
    } finally {
      setLoadingApps(false);
    }
  }
  function rulesChanged(rules: AppProfileRule[]) {
    setError("");
    setDraft({ ...value, rules });
  }
  return (
    <SettingsSection title="Automatic profiles & shortcuts">
      <div className="space-y-5 py-4">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          Choose a profile for each app. Yap checks the focused app when shortcut dictation starts.
          Other apps, imports, and recordings started in Yap use your manually selected settings.
          Rules apply to the entire app, including all browser tabs.
        </p>
        {value.rules.map((rule) => (
          <div
            key={rule.applicationId}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <span className="min-w-0 flex-1 basis-32 break-words text-sm">
              {rule.applicationName}
            </span>
            <Select
              items={profiles}
              value={rule.profileId}
              disabled={blocked}
              onValueChange={(id) => {
                if (id)
                  rulesChanged(
                    value.rules.map((item) =>
                      item.applicationId === rule.applicationId ? { ...item, profileId: id } : item,
                    ),
                  );
              }}
            >
              <SelectTrigger aria-label={`Profile for ${rule.applicationName}`} className="w-44">
                <SelectValue placeholder="Choose profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={blocked}
              aria-label={`Remove rule for ${rule.applicationName}`}
              onClick={() =>
                rulesChanged(
                  value.rules.filter((item) => item.applicationId !== rule.applicationId),
                )
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={appOptions}
            value={appID}
            disabled={blocked || loadingApps}
            onOpenChange={(open) => {
              if (open && !apps.length && !loadingApps) void loadApps();
            }}
            onValueChange={setAppID}
          >
            <SelectTrigger aria-label="Application for automatic profile" className="w-48">
              <SelectValue placeholder={loadingApps ? "Loading apps…" : "Choose an open app"} />
            </SelectTrigger>
            <SelectContent>
              {appOptions.map((app) => (
                <SelectItem key={app.value} value={app.value}>
                  {app.label}
                </SelectItem>
              ))}
              {!appOptions.length && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Open the app, then refresh this list.
                </p>
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh open applications"
            disabled={blocked || loadingApps}
            onClick={() => void loadApps()}
          >
            <RefreshCw aria-hidden="true" className={loadingApps ? "animate-spin" : ""} />
          </Button>
          <Select
            items={profiles}
            value={profileID}
            disabled={blocked}
            onValueChange={setProfileID}
          >
            <SelectTrigger aria-label="Profile for new application rule" className="w-44">
              <SelectValue placeholder="Choose profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={
              blocked ||
              !appID ||
              !profileID ||
              value.rules.length >= 50 ||
              !availableApps.some((app) => app.id === appID)
            }
            onClick={() => {
              const app = availableApps.find((item) => item.id === appID);
              if (!app || !profileID) return;
              rulesChanged([
                ...value.rules,
                { applicationId: app.id, applicationName: app.name, profileId: profileID },
              ]);
              setAppID(null);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add rule
          </Button>
        </div>
        {appError && (
          <p role="alert" className="text-xs text-destructive">
            {appError}
          </p>
        )}
        <div className="max-w-xl space-y-2">
          <Label htmlFor="profile-cycle-shortcut">Cycle profiles shortcut</Label>
          <ShortcutInput
            recordLabel="Record profile shortcut"
            id="profile-cycle-shortcut"
            value={value.shortcut}
            disabled={blocked}
            onChange={(shortcut) => {
              setError("");
              setDraft({ ...value, shortcut });
            }}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Optional, for example Ctrl+Alt+P. Leave empty to disable. Cycles through available
            profiles and overrides the app rule for your next dictation in the same app. Unavailable
            profiles are skipped.
          </p>
          {snapshot.status.profileShortcutError && (
            <div className="space-y-2">
              <p role="alert" className="text-xs text-destructive">
                {snapshot.status.profileShortcutError}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked}
                onClick={() => void run(backend.retryShortcut)}
              >
                Retry profile shortcut
              </Button>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={blocked || !dirty}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await backend.saveProfileAutomation(value.rules, value.shortcut);
                await refresh();
              } catch (cause) {
                setError(message(cause));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Saving…" : "Save profile automation"}
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDraft(saved);
                setError("");
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
