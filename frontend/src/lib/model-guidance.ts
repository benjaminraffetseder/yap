import type { Model } from "@/lib/backend";
import { languages } from "@/lib/languages";
import { modelProfiles } from "@/lib/model-profiles";

export const guidanceLanguages = [
  { value: "auto", label: "Not sure / multiple languages" },
  ...[...new Set(Object.values(modelProfiles).flatMap((profile) => profile.languages))]
    .sort()
    .map((language) => ({ value: language, label: language })),
];

export const guidanceTasks = [
  { value: "everyday", label: "Emails & everyday dictation" },
  { value: "quick", label: "Quick notes / small download" },
  { value: "quality", label: "Difficult audio / quality first" },
] as const;

export type GuidanceTask = (typeof guidanceTasks)[number]["value"];

export function initialGuidanceLanguage(code: string) {
  return languages.find((language) => language.value === code && code !== "auto")?.label ?? "auto";
}

export function recommendSpeechModel(models: Model[], language: string, task: GuidanceTask) {
  const eligible = models.filter((model) => {
    const profile = modelProfiles[model.id];
    return (
      profile &&
      (language === "auto" ? profile.languages.length > 1 : profile.languages.includes(language))
    );
  });
  const english = language === "English";
  if (task === "quality") {
    return eligible.sort(
      (a, b) =>
        modelProfiles[b.id].accuracy.score - modelProfiles[a.id].accuracy.score ||
        modelProfiles[b.id].speed.score - modelProfiles[a.id].speed.score ||
        a.size - b.size,
    )[0];
  }
  const priorities =
    task === "quick"
      ? [english ? "moonshine-v2-tiny" : "base", "tiny", "base", "small"]
      : [
          english ? "moonshine-v2-small" : language === "auto" ? "small" : "parakeet-tdt-0.6b-v3",
          "small",
          "base",
        ];
  return (
    priorities.map((id) => eligible.find((model) => model.id === id)).find(Boolean) ??
    eligible.sort(
      (a, b) => modelProfiles[b.id].languages.length - modelProfiles[a.id].languages.length,
    )[0]
  );
}
