import i18n from "@/i18n";
import type { DictationProfile, PromptChain, TextProcessing, TextPrompt } from "@/lib/backend";

export type OnboardingUseCase = "everyday" | "email" | "notes" | "custom";
export type SpeedPreference = "speed" | "balanced" | "quality";
export type RecipeKind = "none" | "prompt" | "chain";

export type WorkflowDraft = {
  prompt: TextPrompt;
  chainPrompts: [TextPrompt, TextPrompt];
  chain: PromptChain;
};

export function defaultRecipeKind(useCase: OnboardingUseCase): RecipeKind {
  return useCase === "email" ? "prompt" : useCase === "notes" ? "chain" : "none";
}

export function createWorkflowDraft(useCase: OnboardingUseCase): WorkflowDraft {
  const copy = {
    prompt: i18n.t(`onboarding.starter.${useCase}.prompt`),
    cleanup: i18n.t("onboarding.starter.cleanup"),
    structure: i18n.t(`onboarding.starter.${useCase}.structure`),
  };
  const firstStepID = crypto.randomUUID();
  const secondStepID = crypto.randomUUID();
  const firstPromptID = crypto.randomUUID();
  const secondPromptID = crypto.randomUUID();
  return {
    prompt: {
      id: crypto.randomUUID(),
      name: i18n.t("onboarding.starter.promptName"),
      instruction: copy.prompt,
    },
    chainPrompts: [
      {
        id: firstPromptID,
        name: i18n.t("onboarding.starter.cleanupName"),
        instruction: copy.cleanup,
      },
      {
        id: secondPromptID,
        name: i18n.t("onboarding.starter.structureName"),
        instruction: copy.structure,
      },
    ],
    chain: {
      id: crypto.randomUUID(),
      name: i18n.t("onboarding.starter.chainName"),
      steps: [
        { id: firstStepID, promptId: firstPromptID, input: "original" },
        { id: secondStepID, promptId: secondPromptID, input: `step:${firstStepID}` },
      ],
    },
  };
}

// Draft definitions are included only for the selected recipe. The saved prompt
// and chain arrays remain untouched until the atomic onboarding completion.
export function buildWorkflowConfig(
  base: TextProcessing,
  draft: WorkflowDraft,
  kind: RecipeKind,
  enabled: boolean,
): TextProcessing {
  const config: TextProcessing = {
    ...base,
    enabled,
    autoPromptId: "",
    prompts: [...base.prompts],
    chains: [...(base.chains ?? [])],
  };
  if (kind === "prompt") {
    config.prompts.push({ ...draft.prompt });
    config.autoPromptId = enabled ? draft.prompt.id : "";
  } else if (kind === "chain") {
    config.prompts.push(...draft.chainPrompts.map((prompt) => ({ ...prompt })));
    config.chains!.push({
      ...draft.chain,
      steps: draft.chain.steps.map((step) => ({ ...step })),
    });
    config.autoPromptId = enabled ? draft.chain.id : "";
  }
  return config;
}

export function moveChainStep(draft: WorkflowDraft, index: number, offset: number): PromptChain {
  const steps = [...draft.chain.steps];
  const target = index + offset;
  if (index < 0 || target < 0 || target >= steps.length) return draft.chain;
  [steps[index], steps[target]] = [steps[target], steps[index]];
  const seen = new Set<string>();
  return {
    ...draft.chain,
    steps: steps.map((step, stepIndex) => {
      const valid = !step.input.startsWith("step:") || seen.has(step.input.slice(5));
      const normalized = valid
        ? step
        : { ...step, input: stepIndex > 0 ? `step:${steps[stepIndex - 1].id}` : "original" };
      seen.add(step.id);
      return normalized;
    }),
  };
}

export function uniqueProfileName(base: string, profiles: DictationProfile[] | undefined) {
  const occupied = new Set([
    "default",
    ...(profiles ?? []).map((profile) => profile.name.trim().toLowerCase()),
  ]);
  const trimmed = base.trim() || "My dictation";
  if (!occupied.has(trimmed.toLowerCase())) return trimmed;
  for (let index = 2; ; index++) {
    const candidate = `${trimmed} ${index}`;
    if (!occupied.has(candidate.toLowerCase())) return candidate;
  }
}

export function profileTextConnection(config: TextProcessing): DictationProfile["textModel"] {
  return {
    provider: config.provider ?? "external",
    contextLength: config.contextLength ?? 0,
    enabled: config.enabled,
    endpoint: config.endpoint,
    model: config.model,
  };
}
