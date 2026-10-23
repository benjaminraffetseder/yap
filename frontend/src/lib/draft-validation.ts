/* eslint-disable no-control-regex -- These checks mirror backend text validation. */
import type { TextProcessing, VocabularyEntry } from "@/lib/backend";

const length = (value: string) => Array.from(value).length;
const validText = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
const validID = (value: string) =>
  !!value &&
  new TextEncoder().encode(value).length <= 80 &&
  validText(value) &&
  !/[\r\n\x00]/.test(value);
const validName = (value: string, max: number) =>
  !!value.trim() &&
  length(value.trim()) <= max &&
  validText(value) &&
  !/[\r\n\x00]/.test(value.trim());

export function validateTextProcessing(value: TextProcessing): string {
  try {
    const raw = value.endpoint.trim();
    const url = new URL(raw);
    const authority = raw.match(/^https?:\/\/([^/]+)/)?.[1] ?? "";
    const path = raw.slice(raw.indexOf(authority) + authority.length);
    const host = authority.startsWith("[")
      ? authority.slice(0, authority.indexOf("]") + 1)
      : authority.split(":")[0];
    const ipv4 = host.split(".");
    const loopback =
      host.toLowerCase() === "localhost" ||
      (ipv4.length === 4 &&
        ipv4[0] === "127" &&
        ipv4.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) ||
      (host.startsWith("[") &&
        (url.hostname === "[::1]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]+\]$/i.test(url.hostname)));
    const port = authority.startsWith("[")
      ? authority.slice(authority.indexOf("]") + 1)
      : authority.slice(host.length);
    if (
      !loopback ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      raw.includes("?") ||
      raw.includes("#") ||
      raw.includes("%") ||
      raw.includes("\\") ||
      path.replace(/\/+$/, "") !== "/v1" ||
      (port && !/^:\d*$/.test(port)) ||
      (port.length > 1 && (Number(port.slice(1)) < 1 || Number(port.slice(1)) > 65535))
    )
      return "Use an HTTP(S) loopback URL ending in /v1, without credentials or query parameters.";
  } catch {
    return "Enter a local server URL, such as http://127.0.0.1:11434/v1.";
  }
  if (
    !validText(value.model) ||
    length(value.model.trim()) > 200 ||
    /[\r\n\x00]/.test(value.model.trim())
  )
    return "Enter a valid model identifier (up to 200 characters).";
  if (value.enabled && !value.model.trim())
    return "Enter the local model identifier before enabling processing.";
  if (value.prompts.length > 30) return "Save up to 30 prompts.";
  const ids = new Set<string>();
  for (const prompt of value.prompts) {
    if (!validID(prompt.id) || ids.has(prompt.id))
      return "Prompt identifiers must be unique and nonempty.";
    if (!validName(prompt.name, 80)) return "Give each prompt a name of up to 80 characters.";
    if (
      !prompt.instruction.trim() ||
      !validText(prompt.instruction) ||
      length(prompt.instruction.trim()) > 8000 ||
      prompt.instruction.includes("\0")
    )
      return `${prompt.name} needs instructions of up to 8,000 characters.`;
    ids.add(prompt.id);
  }
  if ((value.chains?.length ?? 0) > 30) return "Save up to 30 prompt chains.";
  for (const chain of value.chains ?? []) {
    if (!validID(chain.id) || ids.has(chain.id))
      return "Prompt and chain identifiers must be unique and nonempty.";
    if (!validName(chain.name, 80)) return "Give each chain a name of up to 80 characters.";
    if (!chain.steps.length || chain.steps.length > 10)
      return `${chain.name} needs between 1 and 10 steps.`;
    const steps = new Set<string>();
    for (const [index, step] of chain.steps.entries()) {
      if (!validID(step.id) || steps.has(step.id))
        return `${chain.name} needs unique step identifiers.`;
      if (!value.prompts.some((prompt) => prompt.id === step.promptId))
        return `${chain.name} step ${index + 1} needs an existing prompt. Update chains before deleting their prompts.`;
      if (
        !["original", "transcript"].includes(step.input) &&
        (!step.input.startsWith("step:") || !steps.has(step.input.slice(5)))
      )
        return `${chain.name} step ${index + 1} must use the original, saved transcript, or an earlier step.`;
      steps.add(step.id);
    }
    ids.add(chain.id);
  }
  if (value.autoPromptId && (!value.enabled || !ids.has(value.autoPromptId)))
    return "Enable a model and select a saved prompt or chain for automatic processing.";
  return "";
}

export type VocabularyDraft = Omit<VocabularyEntry, "aliases"> & { aliases: string };
export const vocabularyDraft = (entries: VocabularyEntry[]): VocabularyDraft[] =>
  entries.map((entry) => ({ ...entry, aliases: entry.aliases.join(", ") }));
export function vocabularyPayload(
  draft: VocabularyDraft[],
  saved: VocabularyEntry[],
): VocabularyEntry[] {
  const existing = new Set(saved.map((entry) => entry.id));
  return draft
    .filter((entry) => existing.has(entry.id) || entry.canonical.trim() || entry.aliases.trim())
    .map((entry) => ({
      ...entry,
      aliases: entry.aliases
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean),
    }));
}
export function validateVocabulary(entries: VocabularyEntry[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const phrases: { phrase: string; owner: string }[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || new TextEncoder().encode(entry.id).length > 64 || ids.has(entry.id))
      errors[entry.id] = "Vocabulary entry IDs must be unique.";
    ids.add(entry.id);
    if (entries.length > 100) errors[entry.id] = "Use at most 100 vocabulary entries.";
    if (entry.aliases.length > 10) errors[entry.id] = "Use at most 10 aliases per term.";
    for (const phrase of [entry.canonical, ...entry.aliases]) {
      if (
        !phrase.trim() ||
        !validText(phrase) ||
        length(phrase.trim()) > 80 ||
        /\p{Cc}/u.test(phrase.trim())
      )
        errors[entry.id] = "Use 1–80 characters without line breaks for each spelling and alias.";
      // Unicode-aware case-insensitive matching uses simple folding, like Go's
      // EqualFold (including micro sign, long-s, and final sigma).
      const pattern = new RegExp(`^${phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "iu");
      const duplicate = phrases.find(
        (previous) => previous.owner !== entry.id && pattern.test(previous.phrase),
      );
      if (duplicate) {
        const reason = `“${phrase.trim()}” is already assigned to another term.`;
        errors[entry.id] = reason;
        errors[duplicate.owner] = reason;
      }
      phrases.push({ phrase: phrase.trim(), owner: entry.id });
    }
  }
  return errors;
}
