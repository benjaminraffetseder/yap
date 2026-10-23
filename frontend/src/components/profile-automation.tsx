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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  backend,
  isDesktop,
  message,
  type AppProfileRule,
  type ProfileApplication,
} from "@/lib/backend";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

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
      <div className="@container/profile-automation divide-y">
        <section aria-labelledby="profile-shortcuts-heading" className="space-y-4 py-5">
          <h3 id="profile-shortcuts-heading" className="text-sm font-medium">
            Shortcuts
          </h3>
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
              profiles and overrides the app rule for your next dictation in the same app.
              Unavailable profiles are skipped.
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
        </section>

        <section aria-labelledby="automatic-profiles-heading" className="space-y-5 py-5">
          <div className="space-y-1.5">
            <h3 id="automatic-profiles-heading" className="text-sm font-medium">
              Automatic profiles
            </h3>
            <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
              Use a specific profile when you start dictation with a shortcut in an app. Rules apply
              to the whole app, including all browser tabs. Other apps, imports, and recordings
              started in Yap use your manually selected settings.
            </p>
          </div>

          <div aria-label="Add application rule" role="group" className="space-y-2">
            <div className="grid items-end gap-3 @lg/profile-automation:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="profile-rule-application" className="text-xs">
                  When this app is focused
                </Label>
                <div className="flex h-8 min-w-0 items-center gap-1">
                  <Select
                    items={appOptions}
                    value={appID}
                    disabled={blocked || loadingApps}
                    onOpenChange={(open) => {
                      if (open && !apps.length && !loadingApps) void loadApps();
                    }}
                    onValueChange={setAppID}
                  >
                    <SelectTrigger
                      id="profile-rule-application"
                      aria-label="Application for automatic profile"
                      className="min-w-0 flex-1"
                    >
                      <SelectValue
                        className="min-w-0 truncate"
                        placeholder={loadingApps ? "Loading apps…" : "Choose an open app"}
                      />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {appOptions.map((app) => (
                        <SelectItem key={app.value} value={app.value}>
                          {app.label}
                        </SelectItem>
                      ))}
                      {!appOptions.length && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          {apps.length
                            ? "All open apps already have rules. Open another app, then refresh."
                            : "Open the app, then refresh this list."}
                        </p>
                      )}
                    </SelectContent>
                  </Select>
                  <Tooltip>
                    <TooltipTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label="Refresh open applications"
                      disabled={blocked || loadingApps}
                      onClick={() => void loadApps()}
                      className="shrink-0 text-muted-foreground"
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={loadingApps ? "animate-spin motion-reduce:animate-none" : ""}
                      />
                    </TooltipTrigger>
                    <TooltipContent>Refresh open applications</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="profile-rule-profile" className="text-xs">
                  Use this profile
                </Label>
                <div className="flex h-8 min-w-0 items-center">
                  <Select
                    items={profiles}
                    value={profileID}
                    disabled={blocked}
                    onValueChange={setProfileID}
                  >
                    <SelectTrigger
                      id="profile-rule-profile"
                      aria-label="Profile for new application rule"
                      className="w-full min-w-0"
                    >
                      <SelectValue className="min-w-0 truncate" placeholder="Choose a profile" />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      {profiles.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start @lg/profile-automation:justify-self-auto"
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
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-xs font-medium">Application rules</h4>
              <span className="text-xs tabular-nums text-muted-foreground">
                {value.rules.length} {value.rules.length === 1 ? "rule" : "rules"}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <Table aria-label="Application profile rules" className="table-fixed">
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col" className="px-3 text-xs text-muted-foreground">
                      Application
                    </TableHead>
                    <TableHead scope="col" className="px-3 text-xs text-muted-foreground">
                      Profile
                    </TableHead>
                    <TableHead scope="col" className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!value.rules.length && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={3}
                        className="space-y-1 px-3 py-6 text-center whitespace-normal"
                      >
                        <p className="text-xs font-medium">No automatic profiles yet</p>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Choose an app and a profile above, then add a rule.
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                  {value.rules.map((rule) => (
                    <TableRow key={rule.applicationId}>
                      <TableCell className="min-w-0 px-3 py-3 whitespace-normal">
                        <span
                          className="line-clamp-2 text-xs font-medium wrap-anywhere"
                          title={rule.applicationName}
                        >
                          {rule.applicationName}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-0 px-3 py-3">
                        <Select
                          items={profiles}
                          value={rule.profileId}
                          disabled={blocked}
                          onValueChange={(id) => {
                            if (id)
                              rulesChanged(
                                value.rules.map((item) =>
                                  item.applicationId === rule.applicationId
                                    ? { ...item, profileId: id }
                                    : item,
                                ),
                              );
                          }}
                        >
                          <SelectTrigger
                            aria-label={`Profile for ${rule.applicationName}`}
                            className="w-full min-w-0"
                          >
                            <SelectValue
                              className="min-w-0 truncate"
                              placeholder="Choose profile"
                            />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            {profiles.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="px-2 py-3 text-right">
                        <Tooltip>
                          <TooltipTrigger
                            render={<Button variant="ghost" size="icon-sm" />}
                            disabled={blocked}
                            aria-label={`Remove rule for ${rule.applicationName}`}
                            onClick={() =>
                              rulesChanged(
                                value.rules.filter(
                                  (item) => item.applicationId !== rule.applicationId,
                                ),
                              )
                            }
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent>Remove rule for {rule.applicationName}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>

        <div className="space-y-3 py-4">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
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
              <>
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
                <span className="text-xs text-muted-foreground">Unsaved changes</span>
              </>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
