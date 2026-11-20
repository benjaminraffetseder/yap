import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { moveChainStep, type RecipeKind, type WorkflowDraft } from "../lib/onboarding-draft";

const recipeKinds: RecipeKind[] = ["none", "prompt", "chain"];

export function RecipeEditor({
  kind,
  draft,
  disabled,
  onKind,
  onDraft,
}: {
  kind: RecipeKind;
  draft: WorkflowDraft;
  disabled: boolean;
  onKind: (kind: RecipeKind) => void;
  onDraft: (draft: WorkflowDraft) => void;
}) {
  const { t } = useTranslation();
  return (
    <FieldGroup>
      <FieldSet disabled={disabled}>
        <FieldLegend>{t("onboarding.recipeChoice")}</FieldLegend>
        <FieldDescription>{t("onboarding.recipeChoiceHelp")}</FieldDescription>
        <div className="grid gap-2 sm:grid-cols-3">
          {recipeKinds.map((value) => (
            <FieldLabel
              key={value}
              className="cursor-pointer rounded-lg border p-3 has-checked:border-primary/40 has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <Field orientation="horizontal">
                <input
                  type="radio"
                  name="onboarding-recipe"
                  value={value}
                  checked={kind === value}
                  onChange={() => onKind(value)}
                  className="size-4 shrink-0 accent-primary"
                />
                <FieldContent>
                  <FieldTitle>{t(`onboarding.recipe.${value}`)}</FieldTitle>
                </FieldContent>
              </Field>
            </FieldLabel>
          ))}
        </div>
      </FieldSet>
      {kind === "prompt" && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-prompt-name">{t("onboarding.promptName")}</FieldLabel>
            <Input
              id="onboarding-prompt-name"
              value={draft.prompt.name}
              disabled={disabled}
              maxLength={80}
              onChange={(event) =>
                onDraft({
                  ...draft,
                  prompt: { ...draft.prompt, name: event.target.value },
                })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="onboarding-prompt-instructions">
              {t("onboarding.starterInstructions")}
            </FieldLabel>
            <Textarea
              id="onboarding-prompt-instructions"
              value={draft.prompt.instruction}
              disabled={disabled}
              rows={6}
              maxLength={8000}
              onChange={(event) =>
                onDraft({
                  ...draft,
                  prompt: { ...draft.prompt, instruction: event.target.value },
                })
              }
            />
            <FieldDescription>{t("onboarding.instructionsHelp")}</FieldDescription>
          </Field>
        </FieldGroup>
      )}
      {kind === "chain" && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-chain-name">{t("onboarding.chainName")}</FieldLabel>
            <Input
              id="onboarding-chain-name"
              value={draft.chain.name}
              disabled={disabled}
              maxLength={80}
              onChange={(event) =>
                onDraft({
                  ...draft,
                  chain: { ...draft.chain, name: event.target.value },
                })
              }
            />
          </Field>
          <ol className="flex flex-col gap-4">
            {draft.chain.steps.map((step, index) => {
              const prompt = draft.chainPrompts.find((item) => item.id === step.promptId)!;
              const inputs = [
                { value: "original", label: t("onboarding.inputOriginal") },
                { value: "transcript", label: t("onboarding.inputTranscript") },
                ...(index > 0
                  ? [
                      {
                        value: `step:${draft.chain.steps[index - 1].id}`,
                        label: t("onboarding.inputPrevious", { index }),
                      },
                    ]
                  : []),
              ];
              return (
                <li key={step.id} className="rounded-xl border p-4">
                  <FieldGroup className="gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {t("onboarding.chainStep", { index: index + 1, name: prompt.name })}
                      </h3>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("onboarding.moveStepUp", { index: index + 1 })}
                          disabled={disabled || index === 0}
                          onClick={() =>
                            onDraft({ ...draft, chain: moveChainStep(draft, index, -1) })
                          }
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("onboarding.moveStepDown", { index: index + 1 })}
                          disabled={disabled || index === draft.chain.steps.length - 1}
                          onClick={() =>
                            onDraft({ ...draft, chain: moveChainStep(draft, index, 1) })
                          }
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <Field>
                      <FieldLabel htmlFor={`onboarding-step-name-${step.id}`}>
                        {t("onboarding.stepPromptName", { index: index + 1 })}
                      </FieldLabel>
                      <Input
                        id={`onboarding-step-name-${step.id}`}
                        value={prompt.name}
                        disabled={disabled}
                        maxLength={80}
                        onChange={(event) =>
                          onDraft({
                            ...draft,
                            chainPrompts: draft.chainPrompts.map((item) =>
                              item.id === prompt.id ? { ...item, name: event.target.value } : item,
                            ) as WorkflowDraft["chainPrompts"],
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`onboarding-step-input-${step.id}`}>
                        {t("onboarding.stepInput", { index: index + 1 })}
                      </FieldLabel>
                      <Select
                        items={inputs}
                        value={step.input}
                        disabled={disabled}
                        onValueChange={(input) => {
                          if (!input) return;
                          onDraft({
                            ...draft,
                            chain: {
                              ...draft.chain,
                              steps: draft.chain.steps.map((item) =>
                                item.id === step.id ? { ...item, input } : item,
                              ),
                            },
                          });
                        }}
                      >
                        <SelectTrigger id={`onboarding-step-input-${step.id}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {inputs.map((input) => (
                              <SelectItem key={input.value} value={input.value}>
                                {input.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`onboarding-step-instructions-${step.id}`}>
                        {t("onboarding.stepInstructions", { index: index + 1 })}
                      </FieldLabel>
                      <Textarea
                        id={`onboarding-step-instructions-${step.id}`}
                        value={prompt.instruction}
                        disabled={disabled}
                        rows={5}
                        maxLength={8000}
                        onChange={(event) =>
                          onDraft({
                            ...draft,
                            chainPrompts: draft.chainPrompts.map((item) =>
                              item.id === prompt.id
                                ? { ...item, instruction: event.target.value }
                                : item,
                            ) as WorkflowDraft["chainPrompts"],
                          })
                        }
                      />
                    </Field>
                  </FieldGroup>
                </li>
              );
            })}
          </ol>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("onboarding.chainDraftHelp")}
          </p>
        </FieldGroup>
      )}
    </FieldGroup>
  );
}
