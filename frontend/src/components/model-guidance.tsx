import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Model } from "@/lib/backend";
import {
  guidanceLanguages,
  guidanceTasks,
  initialGuidanceLanguage,
  recommendSpeechModel,
  type GuidanceTask,
} from "@/lib/model-guidance";
import { modelProfiles } from "@/lib/model-profiles";
import { ArrowDown } from "lucide-react";
import { useId, useState } from "react";

export function ModelGuidance({
  models,
  language,
  selectedModelPath,
  onShow,
}: {
  models: Model[];
  language: string;
  selectedModelPath: string;
  onShow: (model: Model) => void;
}) {
  const id = useId();
  const [spokenLanguage, setSpokenLanguage] = useState(() => initialGuidanceLanguage(language));
  const [task, setTask] = useState<GuidanceTask>("everyday");
  const model = recommendSpeechModel(models, spokenLanguage, task);
  const profile = model && modelProfiles[model.id];
  const downloadSize =
    model &&
    `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(model.size / 1_000_000)} MB`;

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6"
    >
      <div>
        <h2 id={`${id}-heading`} className="text-base font-semibold">
          Find a starting point
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Choose your language and task for a suggestion. This only guides this page; your settings
          stay unchanged.
        </p>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-language`}>Language for guidance</Label>
          <Select
            items={guidanceLanguages}
            value={spokenLanguage}
            onValueChange={(value) => {
              if (value !== null) setSpokenLanguage(value);
            }}
          >
            <SelectTrigger
              id={`${id}-language`}
              className="h-auto! min-h-10 w-full min-w-0 whitespace-normal [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:break-words"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {guidanceLanguages.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="[&>*]:min-w-0 [&>*]:shrink [&>*]:break-words [&>*]:whitespace-normal"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-task`}>What will you dictate?</Label>
          <Select
            items={guidanceTasks}
            value={task}
            onValueChange={(value) => {
              if (value !== null) setTask(value);
            }}
          >
            <SelectTrigger
              id={`${id}-task`}
              className="h-auto! min-h-10 w-full min-w-0 whitespace-normal [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:break-words"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {guidanceTasks.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  className="[&>*]:min-w-0 [&>*]:shrink [&>*]:break-words [&>*]:whitespace-normal"
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="rounded-xl bg-muted/50 p-4"
      >
        {model && profile ? (
          <>
            <p className="text-xs font-medium text-muted-foreground">Suggested starting point</p>
            <p className="mt-1 font-semibold break-words">{model.name}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{profile.tagline}</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {spokenLanguage === "auto"
                ? "Broad language coverage while you decide."
                : `Supports ${spokenLanguage}.`}{" "}
              Speed: {profile.speed.label.toLowerCase()} · Quality:{" "}
              {profile.accuracy.label.toLowerCase()} · Download: {downloadSize}.
            </p>
          </>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            No catalog suggestion for this language is available. Browse every model below or use
            your own model in Settings.
          </p>
        )}
      </div>
      {model && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            variant="outline"
            className="h-auto min-h-9 whitespace-normal"
            onClick={() => onShow(model)}
          >
            Show model
            <ArrowDown className="size-3.5" aria-hidden="true" />
          </Button>
          <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
            {model.installed && model.path === selectedModelPath
              ? "This model is already active for your next dictation."
              : model.installed
                ? "Already downloaded. Choose Use model below to switch."
                : model.removable
                  ? "Choose Repair & use below to check the files and switch when ready."
                  : "Choose Download & use below to install and switch when ready."}
          </p>
        </div>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Speed and quality are qualitative guides. Results depend on your device, language and audio.
        All models remain available below.
      </p>
    </section>
  );
}
