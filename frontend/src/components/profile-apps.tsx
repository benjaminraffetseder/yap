import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppProfileRule, DictationProfile, ProfileApplication } from "@/lib/backend";
import { Plus, X } from "lucide-react";

const ruleLimit = 50;

export function ProfileApps({
  profile,
  profiles,
  rules,
  apps,
  loading,
  disabled,
  onOpen,
  onChange,
}: {
  profile: DictationProfile;
  profiles: DictationProfile[];
  rules: AppProfileRule[];
  apps: ProfileApplication[];
  loading: boolean;
  disabled: boolean;
  onOpen: () => void;
  onChange: (rules: AppProfileRule[]) => void;
}) {
  const assigned = rules.filter((rule) => rule.profileId === profile.id);
  const options = apps
    .filter((app) => !assigned.some((rule) => rule.applicationId === app.id))
    .map((app) => {
      const owner = rules.find((rule) => rule.applicationId === app.id);
      return {
        value: app.id,
        label: app.name,
        owner: owner && profiles.find((p) => p.id === owner.profileId)?.name,
        assigned: !!owner,
      };
    });
  const full = rules.length >= ruleLimit;
  function add(id: string) {
    const app = apps.find((item) => item.id === id);
    if (!app) return;
    if (rules.some((rule) => rule.applicationId === app.id))
      onChange(
        rules.map((rule) =>
          rule.applicationId === app.id ? { ...rule, profileId: profile.id } : rule,
        ),
      );
    else if (!full)
      onChange([
        ...rules,
        { applicationId: app.id, applicationName: app.name, profileId: profile.id },
      ]);
  }
  return (
    <div
      role="group"
      aria-label={`Apps for ${profile.name}`}
      className="flex basis-full flex-wrap items-center gap-1.5"
    >
      {assigned.map((rule) => (
        <Badge
          key={rule.applicationId}
          variant="secondary"
          className="h-6 max-w-full min-w-0 gap-0.5 pr-0.5"
        >
          <span className="min-w-0 truncate" title={rule.applicationName}>
            {rule.applicationName}
          </span>
          <button
            type="button"
            aria-label={`Remove ${rule.applicationName} from ${profile.name}`}
            disabled={disabled}
            onClick={() =>
              onChange(rules.filter((item) => item.applicationId !== rule.applicationId))
            }
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
      <Select
        items={options}
        value={null}
        disabled={disabled}
        onOpenChange={(open) => {
          if (open) onOpen();
        }}
        onValueChange={(id) => {
          if (id) add(id);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Add app to ${profile.name}`}
          className="rounded-full border-dashed px-2 text-xs data-[size=sm]:h-6 data-placeholder:text-muted-foreground [&_svg:not([class*='size-'])]:size-3"
        >
          <Plus aria-hidden="true" className="size-3" />
          <SelectValue placeholder="Add app" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start" className="w-64">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={full && !option.assigned}>
              <span className="min-w-0 truncate">{option.label}</span>
              {option.owner && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {option.owner}
                </span>
              )}
            </SelectItem>
          ))}
          {!options.length && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {loading
                ? "Loading open apps…"
                : apps.length
                  ? "All open apps are already added. Open another app, then try again."
                  : "Open the app you want to add, then try again."}
            </p>
          )}
          {full && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              You can assign up to {ruleLimit} apps.
            </p>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
