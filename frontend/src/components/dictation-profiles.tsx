import { AutoSaveStatus } from "@/components/auto-save-status";
import { useDictation } from "@/components/dictation-provider";
import { ProcessingSelectItems } from "@/components/processing-select-items";
import { ProfileApps } from "@/components/profile-apps";
import { ModifiedMarker } from "@/components/profile-setting-indicator";
import { SettingsSection } from "@/components/settings-section";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  backend,
  isBusy,
  isDesktop,
  message,
  processingOptions,
  type AppProfileRule,
  type DictationProfile,
  type ProcessingOption,
  type ProfileApplication,
} from "@/lib/backend";
import { languages } from "@/lib/languages";
import { useAutoSave } from "@/lib/use-auto-save";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { Pencil, Plus, Settings2, Trash2, Workflow } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

export function ProfileSelector({
  disabled = false,
  onPendingChange,
}: {
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { snapshot, loading, refresh, run } = useDictation();
  const [pending, setPending] = useState(false);
  const applying = useRef(false);
  const profiles = snapshot.dictationProfiles ?? [];
  const options = profiles.map((p) => ({ value: `profile:${p.id}`, label: p.name }));
  const recordingProfile =
    snapshot.status.phase === "recording" || snapshot.status.phase === "transcribing"
      ? snapshot.status.profileId
      : undefined;
  const selectedID = recordingProfile || snapshot.activeProfileId;
  const selected = selectedID ? `profile:${selectedID}` : null;
  const modified = !!snapshot.profileModified && selectedID === snapshot.activeProfileId;
  async function apply(id: string) {
    if (applying.current || disabled || loading || isBusy(snapshot.status.phase)) return;
    applying.current = true;
    setPending(true);
    onPendingChange?.(true);
    try {
      await run(async () => {
        await backend.applyProfile(id.slice("profile:".length));
        await refresh();
      }, false);
    } finally {
      applying.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-xs text-muted-foreground">Profile</span>
      <Select
        items={options}
        value={selected}
        disabled={
          disabled ||
          !isDesktop ||
          loading ||
          pending ||
          isBusy(snapshot.status.phase) ||
          !profiles.length
        }
        onValueChange={(id) => {
          if (id) void apply(id);
        }}
      >
        <Tooltip disabled={!modified}>
          <TooltipTrigger
            render={
              <SelectTrigger
                aria-label="Dictation profile"
                className="w-40 max-w-full bg-background"
              />
            }
          >
            <SelectValue placeholder="Choose a profile" className="min-w-0 truncate" />
            {modified && <ModifiedMarker />}
          </TooltipTrigger>
          <TooltipContent>Modified</TooltipContent>
        </Tooltip>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              onClick={() => {
                if (option.value === selected && modified) void apply(option.value);
              }}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Link
        to="/settings?section=dictation"
        aria-label="Manage dictation profiles"
        title="Manage dictation profiles"
        className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings2 className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function ProfilesPanel({ disabled }: { disabled: boolean }) {
  const { snapshot, refresh } = useDictation();
  const [editing, setEditing] = useState<DictationProfile | null>(null);
  const [deleting, setDeleting] = useState<DictationProfile | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [apps, setApps] = useState<ProfileApplication[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const profiles = snapshot.dictationProfiles ?? [];
  const rules = snapshot.appProfileRules ?? [];
  async function apply(id: string) {
    setPending(true);
    setError("");
    try {
      await backend.applyProfile(id);
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }
  async function loadApps() {
    if (loadingApps) return;
    setLoadingApps(true);
    try {
      setApps(await backend.profileApplications());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoadingApps(false);
    }
  }
  async function saveRules(next: AppProfileRule[]) {
    setPending(true);
    setError("");
    try {
      await backend.saveProfileAutomation(next, snapshot.profileShortcut ?? "");
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <SettingsSection title="Dictation profiles">
        <div className="space-y-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-lg text-xs leading-5 text-muted-foreground">
              Save a speech model, language, cleanup, and optional prompt together. Add apps to a
              profile to use it automatically when you start dictation with the shortcut in those
              apps, including all browser tabs.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={
                disabled ||
                pending ||
                profiles.filter((p) => p.id !== snapshot.defaultProfileId).length >= 20 ||
                !snapshot.settings.modelPath
              }
              onClick={() => {
                setError("");
                setEditing({
                  id: "",
                  name: "",
                  modelPath: snapshot.settings.modelPath,
                  language: snapshot.settings.language,
                  cleanText: snapshot.settings.cleanText,
                  autoPromptId: snapshot.textProcessing.autoPromptId,
                });
              }}
            >
              <Plus className="size-4" />
              New profile
            </Button>
          </div>
          {!profiles.length && (
            <p className="text-sm text-muted-foreground">
              No profiles yet. Create one from your saved settings.
            </p>
          )}
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1 basis-40">
                <p className="break-words text-sm font-medium">
                  <Tooltip
                    disabled={snapshot.activeProfileId !== profile.id || !snapshot.profileModified}
                  >
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={
                            snapshot.activeProfileId === profile.id && snapshot.profileModified
                              ? 0
                              : undefined
                          }
                          className="inline-flex max-w-full items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      }
                    >
                      <span className="break-words">{profile.name}</span>
                      {snapshot.activeProfileId === profile.id && snapshot.profileModified && (
                        <ModifiedMarker />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>Modified</TooltipContent>
                  </Tooltip>
                  {snapshot.activeProfileId === profile.id && (
                    <span className="ml-2 text-xs text-primary">Active</span>
                  )}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {snapshot.models.find((model) => model.path === profile.modelPath)?.name ??
                    profile.modelPath.split(/[\\/]/).pop()}{" "}
                  ·{" "}
                  {languages.find((language) => language.value === profile.language)?.label ??
                    profile.language}{" "}
                  · {profile.cleanText ? "Light cleanup" : "No cleanup"}
                  {profile.autoPromptId
                    ? ` · ${processingOptions(snapshot.textProcessing).find((p) => p.value === profile.autoPromptId)?.label ?? "Prompt or chain unavailable"}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Use ${profile.name}`}
                  disabled={
                    disabled ||
                    pending ||
                    (snapshot.activeProfileId === profile.id && !snapshot.profileModified)
                  }
                  onClick={() => void apply(profile.id)}
                >
                  Use
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit ${profile.name}`}
                  disabled={disabled || pending}
                  onClick={() => setEditing(profile)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                {profile.id !== snapshot.defaultProfileId && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${profile.name}`}
                    disabled={disabled || pending}
                    onClick={() => {
                      setError("");
                      setDeleting(profile);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
              <ProfileApps
                profile={profile}
                profiles={profiles}
                rules={rules}
                apps={apps}
                loading={loadingApps}
                disabled={disabled || pending || !isDesktop}
                onOpen={() => void loadApps()}
                onChange={(next) => void saveRules(next)}
              />
            </div>
          ))}
          {error && !deleting && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </SettingsSection>
      {editing && (
        <ProfileEditor
          key={editing.id}
          profile={editing}
          disabled={disabled}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={!!deleting}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Your current dictation settings and saved transcripts will be kept.
              {deleting &&
                rules.some((rule) => rule.profileId === deleting.id) &&
                " Its apps will use your manually selected profile again."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disabled || pending}
              onClick={async () => {
                if (!deleting) return;
                setPending(true);
                setError("");
                try {
                  await backend.deleteProfile(deleting.id);
                  await refresh();
                  setDeleting(null);
                } catch (cause) {
                  setError(message(cause));
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? "Deleting…" : "Delete profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfileEditor({
  profile,
  disabled,
  onClose,
}: {
  profile: DictationProfile;
  disabled: boolean;
  onClose: () => void;
}) {
  const { snapshot, refresh } = useDictation();
  const [saved, setSaved] = useState(profile);
  const [draft, setDraft, draftState] = useSavedDraft(`profile:${profile.id || "new"}`, saved);
  const profileID = useRef(profile.id);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const models = snapshot.models
    .filter((model) => model.installed)
    .map((model) => ({ value: model.path, label: model.name }));
  if (!models.some((model) => model.value === draft.modelPath))
    models.push({
      value: draft.modelPath,
      label: draft.modelPath.split(/[\\/]/).pop() || "Selected model",
    });
  const languageOptions = languages.some((language) => language.value === draft.language)
    ? languages
    : [...languages, { value: draft.language, label: draft.language }];
  const processing = processingOptions(snapshot.textProcessing);
  const prompts: ProcessingOption[] = [
    { value: "", label: "No automatic processing" },
    ...processing,
  ];
  const unavailablePrompt = !prompts.some((p) => p.value === draft.autoPromptId);
  if (unavailablePrompt)
    prompts.push({
      value: draft.autoPromptId,
      label: "Prompt or chain unavailable — choose another",
    });
  const selectedPrompt = prompts.find((prompt) => prompt.value === draft.autoPromptId);
  const reason = !draft.name.trim()
    ? "Give this profile a name."
    : Array.from(draft.name.trim()).length > 60 ||
        ["\r", "\n", "\0"].some((character) => draft.name.includes(character))
      ? "Use a profile name of up to 60 characters without line breaks."
      : !draft.modelPath
        ? "Choose a speech model."
        : unavailablePrompt
          ? "Choose an available prompt or chain."
          : draft.autoPromptId && !snapshot.textProcessing.enabled
            ? "Enable the shared text model first."
            : "";
  async function save() {
    setError("");
    try {
      const submitted = { ...draft, id: profileID.current || draft.id };
      const result = await backend.saveProfile(submitted);
      profileID.current = result.id;
      setDraft((old) => ({ ...old, id: result.id }));
      draftState.markSubmitted({ ...submitted, id: result.id });
      setSaved(result);
      await refresh();
    } catch (cause) {
      setError(message(cause));
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    draftKey: JSON.stringify(draft),
    dirty: draftState.dirty,
    canSave: !disabled && isDesktop && !reason,
    save,
    delay: 800,
  });
  async function close() {
    if (closing) return;
    setClosing(true);
    if (!draftState.dirty || reason || (await autoSave.retry())) onClose();
    setClosing(false);
  }
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {profile.id ? "Edit dictation profile" : "New dictation profile"}
          </DialogTitle>
          <DialogDescription>
            Saving a profile leaves your current settings in place. Choose Use to activate it.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={disabled || closing} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Profile name</Label>
            <Input
              id="profile-name"
              disabled={profile.id === snapshot.defaultProfileId}
              maxLength={60}
              placeholder="For example, Quick note or Email"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-model">Speech model</Label>
            <Select
              items={models}
              value={draft.modelPath}
              onValueChange={(value) => {
                if (value) setDraft({ ...draft, modelPath: value });
              }}
            >
              <SelectTrigger id="profile-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-language">Spoken language</Label>
            <Select
              items={languageOptions}
              value={draft.language}
              onValueChange={(value) => {
                if (value) setDraft({ ...draft, language: value });
              }}
            >
              <SelectTrigger id="profile-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Light cleanup</span>
            <Switch
              checked={draft.cleanText}
              onCheckedChange={(cleanText) => setDraft({ ...draft, cleanText })}
            />
          </label>
          <div className="space-y-2">
            <Label htmlFor="profile-prompt">After dictation</Label>
            <Select
              items={prompts}
              value={draft.autoPromptId}
              onValueChange={(value) => {
                if (value !== null) setDraft({ ...draft, autoPromptId: value });
              }}
            >
              <SelectTrigger
                id="profile-prompt"
                className="w-full"
                aria-description={selectedPrompt?.isChain ? "Prompt chain" : undefined}
              >
                {selectedPrompt?.isChain && (
                  <Workflow aria-hidden="true" className="size-3.5 text-muted-foreground" />
                )}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="">No automatic processing</SelectItem>
                  {unavailablePrompt && (
                    <SelectItem value={draft.autoPromptId}>
                      Prompt or chain unavailable — choose another
                    </SelectItem>
                  )}
                </SelectGroup>
                {processing.length > 0 && <SelectSeparator />}
                <ProcessingSelectItems options={processing} />
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">
              Automatic prompts and chains use your shared local text model. Configure and enable it
              in Prompts first.
            </p>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="items-center sm:justify-between">
          <AutoSaveStatus
            status={autoSave.status}
            reason={reason}
            retry={autoSave.retry}
            discard={() => setDraft(saved)}
            disabled={disabled || closing}
          />
          <Button variant="outline" disabled={closing} onClick={() => void close()}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
