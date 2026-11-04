import i18n from "@/i18n";
import type en from "./locales/en.json";

// Native status strings remain unchanged in backend state and event payloads.
// Translate only known presentation text, preserving details from native errors.
export function nativeText(value: string): string {
  const key = `native.${value}`;
  if (i18n.exists(key)) return i18n.t(key as keyof typeof en);
  const profile = /^Profile: (.+)$/.exec(value);
  if (profile) return i18n.t("dictationProvider.profile", { name: profile[1] });
  const recording = /^Recording\s+(\d+:\d{2})$/.exec(value);
  if (recording) return `${i18n.t("homePage.recording")} ${recording[1]}`;
  const history = /^(\d+:\d{2}) · (Saving|Not saving)( · .+)?$/.exec(value);
  if (history) return `${history[1]} · ${nativeText(history[2])}${history[3] ?? ""}`;
  const download = /^Checking or downloading (.+)…$/.exec(value);
  if (download) return i18n.t("native.downloadingModel", { model: download[1] });
  const step = /^Step (\d+) of (\d+) · (.+)$/.exec(value);
  if (step)
    return i18n.t("native.processingStep", { step: step[1], total: step[2], prompt: step[3] });
  return value;
}
