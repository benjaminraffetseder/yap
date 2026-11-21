import i18n from "@/i18n";
import type { Model } from "@/lib/backend";

const modelNames: Record<string, string> = {
  "large-v3": "Whisper Large v3",
  "large-v3-turbo": "Whisper Large v3 Turbo",
  "parakeet-tdt-0.6b-v3": "NVIDIA Parakeet TDT v3",
  "moonshine-base": "Moonshine Base",
  "moonshine-v2-tiny": "Moonshine V2 Tiny",
  "moonshine-v2-small": "Moonshine V2 Small",
  "moonshine-v2-medium": "Moonshine V2 Medium",
};

export function speechModelLabel(model: string, catalog: Pick<Model, "id" | "name">[] = []) {
  const id = model.replace(/^ggml-/i, "").replace(/\.bin$/i, "");
  const known = catalog.find((item) => item.id.toLowerCase() === id.toLowerCase());
  if (known) return known.name;
  const match = /^(tiny|base|small|medium)(\.en)?$/i.exec(id);
  return match
    ? `Whisper ${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}${match[2] ? i18n.t("dictationRow.english") : ""}`
    : (modelNames[id.toLowerCase()] ?? model);
}
