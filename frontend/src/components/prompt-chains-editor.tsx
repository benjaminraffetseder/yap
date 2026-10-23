import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ProfileSettingIndicator } from "@/components/profile-setting-indicator";
import type { PromptChain, PromptChainStep, TextProcessing } from "@/lib/backend";

const emptyChains: PromptChain[] = [];

function validOrder(steps: PromptChainStep[]) {
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.input.startsWith("step:") && !seen.has(step.input.slice(5))) return false;
    seen.add(step.id);
  }
  return true;
}

export function PromptChainsEditor({
  config,
  disabled,
  onChange,
  onConfigureModel,
}: {
  config: TextProcessing;
  disabled: boolean;
  onChange: (value: Partial<TextProcessing>) => void;
  onConfigureModel: () => void;
}) {
  const chains = config.chains ?? emptyChains;
  const [selected, setSelected] = useState(chains[0]?.id ?? "");
  const [deleting, setDeleting] = useState(false);
  const chain = chains.find((item) => item.id === selected);
  useEffect(() => {
    if (!chains.some((item) => item.id === selected)) setSelected(chains[0]?.id ?? "");
  }, [chains, selected]);
  function update(value: Partial<PromptChain>) {
    onChange({
      chains: chains.map((item) => (item.id === selected ? { ...item, ...value } : item)),
    });
  }
  function add() {
    const id = crypto.randomUUID();
    onChange({
      chains: [
        ...chains,
        {
          id,
          name: "New chain",
          steps: [
            { id: crypto.randomUUID(), promptId: config.prompts[0]?.id ?? "", input: "original" },
          ],
        },
      ],
    });
    setSelected(id);
  }
  function move(index: number, offset: number) {
    if (!chain) return [];
    const steps = [...chain.steps];
    [steps[index], steps[index + offset]] = [steps[index + offset], steps[index]];
    return steps;
  }
  const chainOptions = chains.map((item) => ({
    value: item.id,
    label: item.name || "Untitled chain",
  }));
  const promptOptions = config.prompts.map((prompt) => ({
    value: prompt.id,
    label: prompt.name || "Untitled prompt",
  }));
  return (
    <section aria-label="Prompt chains" className="space-y-5">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Run saved prompts in order. Each step can use the original transcription, your saved
        transcript, or an earlier step. Every completed result is kept; the last step is the final
        output.
      </p>
      <fieldset disabled={disabled} className="min-w-0 space-y-5 disabled:opacity-60">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="saved-chain">Saved chain</Label>
            <Select
              items={chainOptions}
              value={chain?.id ?? null}
              onValueChange={(id) => {
                if (id) setSelected(id);
              }}
              disabled={disabled || !chains.length}
            >
              <SelectTrigger id="saved-chain" className="data-[size=default]:h-9 w-full">
                <SelectValue placeholder="No saved chains" />
              </SelectTrigger>
              <SelectContent>
                {chainOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={disabled || chains.length >= 30 || !config.prompts.length}
            onClick={add}
          >
            <Plus className="size-4" />
            Add chain
          </Button>
        </div>
        {!config.prompts.length && (
          <p className="text-sm text-muted-foreground">Add a prompt before creating a chain.</p>
        )}
        {!chain && config.prompts.length > 0 && (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            No prompt chains yet. Add a chain to combine your saved prompts.
          </p>
        )}
        {chain && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-48 flex-1 space-y-2">
                <Label htmlFor="chain-name">Chain name</Label>
                <Input
                  id="chain-name"
                  maxLength={80}
                  value={chain.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Label htmlFor="chain-automatic">Run chain after dictation</Label>
                <ProfileSettingIndicator field="autoPromptId" value={config.autoPromptId} />
                <Switch
                  id="chain-automatic"
                  checked={config.autoPromptId === chain.id}
                  disabled={disabled || !config.enabled}
                  onCheckedChange={(checked) => onChange({ autoPromptId: checked ? chain.id : "" })}
                />
              </div>
            </div>
            {!config.enabled && (
              <p className="text-xs text-muted-foreground">
                Enable LLM processing in{" "}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={onConfigureModel}
                >
                  Text model
                </button>{" "}
                to run chains automatically.
              </p>
            )}
            {config.enabled && (
              <p className="text-xs text-muted-foreground">
                {config.autoPromptId === chain.id
                  ? "This chain runs after each dictation. Only its final result is copied or pasted."
                  : config.autoPromptId
                    ? "Turning this on replaces the current automatic prompt or chain."
                    : "Automatic processing is off."}
              </p>
            )}
            <ol className="space-y-3">
              {chain.steps.map((step, index) => {
                const inputOptions = [
                  { value: "original", label: "Original transcription" },
                  { value: "transcript", label: "Saved transcript (including edits)" },
                  ...chain.steps.slice(0, index).map((earlier, earlierIndex) => ({
                    value: `step:${earlier.id}`,
                    label: `Step ${earlierIndex + 1}: ${config.prompts.find((prompt) => prompt.id === earlier.promptId)?.name || "Untitled prompt"}`,
                  })),
                ];
                const referenced = chain.steps.some((other) => other.input === `step:${step.id}`);
                return (
                  <li key={step.id} className="space-y-4 rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Step {index + 1}</h3>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move step ${index + 1} up`}
                          disabled={disabled || index === 0 || !validOrder(move(index, -1))}
                          onClick={() => update({ steps: move(index, -1) })}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move step ${index + 1} down`}
                          disabled={
                            disabled ||
                            index === chain.steps.length - 1 ||
                            !validOrder(move(index, 1))
                          }
                          onClick={() => update({ steps: move(index, 1) })}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove step ${index + 1}`}
                          title={
                            referenced
                              ? "Change the inputs using this step before removing it."
                              : "Remove step"
                          }
                          disabled={disabled || chain.steps.length === 1 || referenced}
                          onClick={() =>
                            update({ steps: chain.steps.filter((item) => item.id !== step.id) })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`chain-prompt-${step.id}`}>Prompt</Label>
                        <Select
                          items={promptOptions}
                          value={step.promptId || null}
                          disabled={disabled}
                          onValueChange={(promptId) => {
                            if (promptId)
                              update({
                                steps: chain.steps.map((item) =>
                                  item.id === step.id ? { ...item, promptId } : item,
                                ),
                              });
                          }}
                        >
                          <SelectTrigger
                            id={`chain-prompt-${step.id}`}
                            aria-label={`Step ${index + 1} prompt`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Choose a prompt" />
                          </SelectTrigger>
                          <SelectContent>
                            {promptOptions.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`chain-input-${step.id}`}>Use text from</Label>
                        <Select
                          items={inputOptions}
                          value={step.input}
                          disabled={disabled}
                          onValueChange={(input) => {
                            if (input)
                              update({
                                steps: chain.steps.map((item) =>
                                  item.id === step.id ? { ...item, input } : item,
                                ),
                              });
                          }}
                        >
                          <SelectTrigger
                            id={`chain-input-${step.id}`}
                            aria-label={`Step ${index + 1} input`}
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {inputOptions.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {referenced && (
                      <p className="text-xs text-muted-foreground">
                        Used by a later step. Change that input before removing or moving this step
                        after it.
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap justify-between gap-3">
              <Button
                variant="outline"
                disabled={disabled || chain.steps.length >= 10}
                onClick={() =>
                  update({
                    steps: [
                      ...chain.steps,
                      {
                        id: crypto.randomUUID(),
                        promptId: config.prompts[0]?.id ?? "",
                        input: `step:${chain.steps.at(-1)!.id}`,
                      },
                    ],
                  })
                }
              >
                <Plus className="size-4" />
                Add step
              </Button>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="size-4" />
                Delete chain
              </Button>
            </div>
          </>
        )}
      </fieldset>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chain?</DialogTitle>
            <DialogDescription>
              “{chain?.name}” will be removed when you save. Its prompts and previously generated
              results are kept.
              {config.autoPromptId === chain?.id && " Automatic processing will be turned off."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                onChange({
                  chains: chains.filter((item) => item.id !== selected),
                  autoPromptId: config.autoPromptId === selected ? "" : config.autoPromptId,
                });
                setDeleting(false);
              }}
            >
              Delete chain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
