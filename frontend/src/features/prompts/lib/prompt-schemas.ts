import { z } from "zod";
import i18n from "@/i18n";
import type { TextProcessing } from "@/lib/backend";
import {
  identifierSchema,
  instructionSchema,
  modelIdentifierSchema,
  nameSchema,
} from "@/lib/validation/primitives";

const promptShape = z.object({ id: z.string(), name: z.string(), instruction: z.string() });
const chainStepShape = z.object({ id: z.string(), promptId: z.string(), input: z.string() });
const chainShape = z.object({ id: z.string(), name: z.string(), steps: z.array(chainStepShape) });
const identifier = identifierSchema(80);
const name = nameSchema(80);

function endpointIssue(endpoint: string): string {
  try {
    const raw = endpoint.trim();
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
      return i18n.t("draftValidation.useAnHTTPSLoopbackURLEnding");
  } catch {
    return i18n.t("draftValidation.enterALocalServerURLSuchAs");
  }
  return "";
}

// Object shapes reject malformed input; ordered domain checks keep the existing
// first-error contract while also providing paths for individual form controls.
export const textProcessingSchema = z
  .object({
    provider: z.string().optional(),
    contextLength: z.number().optional(),
    enabled: z.boolean(),
    endpoint: z.string(),
    model: z.string(),
    autoPromptId: z.string(),
    prompts: z.array(promptShape),
    chains: z.array(chainShape).optional(),
  })
  .superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (value.provider === "builtin") {
      const max = value.model === "gemma-4-12b" ? 262144 : 131072;
      if (!["gemma-4-e2b", "gemma-4-e4b", "gemma-4-12b"].includes(value.model))
        issue(["model"], i18n.t("textModels.chooseModel"));
      const context = value.contextLength ?? 0;
      if (
        context !== 0 &&
        (!Number.isInteger(context) || context < 2048 || context > max || context % 1024 !== 0)
      )
        issue(
          ["contextLength"],
          i18n.t("textModels.invalidContext", { max: max.toLocaleString(i18n.resolvedLanguage) }),
        );
    } else {
      const message = endpointIssue(value.endpoint);
      if (message) issue(["endpoint"], message);
    }
    if (!modelIdentifierSchema.safeParse(value.model).success)
      issue(["model"], i18n.t("draftValidation.enterAValidModelIdentifierUpTo"));
    if (value.enabled && !value.model.trim())
      issue(["model"], i18n.t("draftValidation.enterTheLocalModelIdentifierBeforeEnabling"));
    if (value.prompts.length > 30) issue(["prompts"], i18n.t("draftValidation.saveUpTo30Prompts"));
    const ids = new Set<string>();
    for (const [index, prompt] of value.prompts.entries()) {
      if (!identifier.safeParse(prompt.id).success || ids.has(prompt.id))
        issue(
          ["prompts", index, "id"],
          i18n.t("draftValidation.promptIdentifiersMustBeUniqueAndNonempty"),
        );
      if (!name.safeParse(prompt.name).success)
        issue(["prompts", index, "name"], i18n.t("draftValidation.giveEachPromptANameOfUp"));
      if (!instructionSchema.safeParse(prompt.instruction).success)
        issue(
          ["prompts", index, "instruction"],
          i18n.t("draftValidation.needsInstructionsOfUpTo8000", { name: prompt.name }),
        );
      ids.add(prompt.id);
    }
    if ((value.chains?.length ?? 0) > 30)
      issue(["chains"], i18n.t("draftValidation.saveUpTo30PromptChains"));
    for (const [index, chain] of (value.chains ?? []).entries()) {
      const at = ["chains", index];
      if (!identifier.safeParse(chain.id).success || ids.has(chain.id))
        issue([...at, "id"], i18n.t("draftValidation.promptAndChainIdentifiersMustBeUnique"));
      if (!name.safeParse(chain.name).success)
        issue([...at, "name"], i18n.t("draftValidation.giveEachChainANameOfUp"));
      if (!chain.steps.length || chain.steps.length > 10)
        issue(
          [...at, "steps"],
          i18n.t("draftValidation.needsBetween1And10Steps", { name: chain.name }),
        );
      const steps = new Set<string>();
      for (const [stepIndex, step] of chain.steps.entries()) {
        const stepAt = [...at, "steps", stepIndex];
        if (!identifier.safeParse(step.id).success || steps.has(step.id))
          issue(
            [...stepAt, "id"],
            i18n.t("draftValidation.needsUniqueStepIdentifiers", { name: chain.name }),
          );
        if (!value.prompts.some((prompt) => prompt.id === step.promptId))
          issue(
            [...stepAt, "promptId"],
            i18n.t("draftValidation.stepNeedsAnExistingPromptUpdateChains", {
              name: chain.name,
              index: stepIndex + 1,
            }),
          );
        if (
          !["original", "transcript"].includes(step.input) &&
          (!step.input.startsWith("step:") || !steps.has(step.input.slice(5)))
        )
          issue(
            [...stepAt, "input"],
            i18n.t("draftValidation.stepMustUseTheOriginalSavedTranscript", {
              name: chain.name,
              index: stepIndex + 1,
            }),
          );
        steps.add(step.id);
      }
      ids.add(chain.id);
    }
    if (value.autoPromptId && (!value.enabled || !ids.has(value.autoPromptId)))
      issue(["autoPromptId"], i18n.t("draftValidation.enableAModelAndSelectASaved"));
  }) satisfies z.ZodType<TextProcessing>;
