import { ProfileSettingIndicator } from "@/components/profile-setting-indicator";
import { RevisionHistory } from "@/components/revision-history";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PromptChain, PromptChainStep, TextProcessing } from "@/lib/backend";
import { validateTextProcessing } from "@/lib/draft-validation";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  Ellipsis,
  FileAudio,
  FileText,
  History,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const emptyChains: PromptChain[] = [];
const menuClass =
  "min-w-48 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 motion-popup";
const menuItemClass =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-disabled:text-muted-foreground/50";

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
  onDelete,
}: {
  config: TextProcessing;
  disabled: boolean;
  onChange: (value: Partial<TextProcessing>) => void;
  onConfigureModel: () => void;
  onDelete: (chain: PromptChain) => void;
}) {
  const chains = config.chains ?? emptyChains;
  const [selected, setSelected] = useState(chains[0]?.id ?? "");
  const [deleting, setDeleting] = useState(false);
  const [history, setHistory] = useState<PromptChain | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const focusNewName = useRef(false);
  const chain = chains.find((item) => item.id === selected);
  const automatic = config.autoPromptId === chain?.id;
  const automaticName = [...config.prompts, ...chains].find(
    (item) => item.id === config.autoPromptId,
  )?.name;

  useEffect(() => {
    if (!chains.some((item) => item.id === selected)) setSelected(chains[0]?.id ?? "");
  }, [chains, selected]);
  useEffect(() => {
    if (chain && focusNewName.current) {
      focusNewName.current = false;
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [chain]);

  function update(value: Partial<PromptChain>) {
    onChange({
      chains: chains.map((item) => (item.id === selected ? { ...item, ...value } : item)),
    });
  }
  function addChain() {
    const id = crypto.randomUUID();
    focusNewName.current = true;
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
  function addStep(promptId: string) {
    if (!chain || disabled || chain.steps.length >= 10) return;
    update({
      steps: [
        ...chain.steps,
        { id: crypto.randomUUID(), promptId, input: `step:${chain.steps.at(-1)!.id}` },
      ],
    });
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
    <section aria-label="Prompt chains" className="@container min-w-0 space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">
        Turn a dictation into a finished result, one prompt at a time.
      </p>
      <fieldset disabled={disabled} className="min-w-0 space-y-5 disabled:opacity-60">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <Label htmlFor="saved-chain" className="sr-only">
              Saved chain
            </Label>
            <Select
              items={chainOptions}
              value={chain?.id ?? null}
              onValueChange={(id) => {
                if (id) setSelected(id);
              }}
              disabled={disabled || !chains.length}
            >
              <SelectTrigger
                id="saved-chain"
                className="data-[size=default]:h-9 w-full @xl:max-w-sm"
              >
                <Workflow aria-hidden="true" className="size-4 text-muted-foreground" />
                <SelectValue className="min-w-0 truncate" placeholder="No saved chains" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="start">
                {chainOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="[&>span]:min-w-0">
                    <Workflow
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{item.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            disabled={disabled || chains.length >= 30 || !config.prompts.length}
            onClick={addChain}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add chain
          </Button>
        </div>

        {!chain && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
            <Workflow aria-hidden="true" className="size-8 text-muted-foreground/60" />
            <div className="space-y-1">
              <h2 className="text-sm font-medium">Your prompts, working together</h2>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                {config.prompts.length
                  ? "Add a chain, then choose the prompts to run. Try Cleanup → Summary → Email."
                  : "Add a saved prompt before creating your first chain."}
              </p>
            </div>
          </div>
        )}

        {chain && (
          <>
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="space-y-1 px-4 pt-4 pb-3">
                <Label htmlFor="chain-name" className="text-xs text-muted-foreground">
                  Chain name
                </Label>
                <Input
                  ref={nameInput}
                  id="chain-name"
                  maxLength={80}
                  value={chain.name}
                  onChange={(event) => update({ name: event.target.value })}
                  className="h-9 border-transparent bg-transparent px-2 text-base font-medium shadow-none dark:bg-transparent"
                />
              </div>
              <div className="flex items-center justify-between gap-4 border-t bg-muted/15 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="chain-automatic" className="text-sm">
                    Run chain after dictation
                  </Label>
                  <p id="chain-automatic-help" className="text-xs leading-5 text-muted-foreground">
                    {!config.enabled ? (
                      <>
                        Enable your{" "}
                        <button
                          type="button"
                          className="underline underline-offset-4"
                          onClick={onConfigureModel}
                        >
                          text model
                        </button>{" "}
                        to run automatically.
                      </>
                    ) : automatic ? (
                      "Use the last step as your dictation result."
                    ) : automaticName ? (
                      `Replaces ${automaticName} when turned on.`
                    ) : (
                      "Run this chain when you finish recording."
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ProfileSettingIndicator field="autoPromptId" value={config.autoPromptId} />
                  <Switch
                    id="chain-automatic"
                    checked={automatic}
                    disabled={disabled || !config.enabled}
                    aria-describedby="chain-automatic-help"
                    onCheckedChange={(checked) =>
                      onChange({ autoPromptId: checked ? chain.id : "" })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Steps</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {chain.steps.length} / 10
                </span>
              </div>
              <ol className="divide-y overflow-hidden rounded-xl border bg-card">
                {chain.steps.map((step, index) => {
                  const inputOptions = [
                    {
                      value: "original",
                      label: "Original transcription",
                      description: "Unedited speech recognition",
                    },
                    {
                      value: "transcript",
                      label: "Saved transcript",
                      description: "Includes saved corrections and cleanup",
                    },
                    ...chain.steps.slice(0, index).map((earlier, earlierIndex) => ({
                      value: `step:${earlier.id}`,
                      label: `Step ${earlierIndex + 1}: ${config.prompts.find((prompt) => prompt.id === earlier.promptId)?.name || "Untitled prompt"}`,
                      description: "Use this step's generated result",
                    })),
                  ];
                  const referenced = chain.steps.some((other) => other.input === `step:${step.id}`);
                  const InputIcon =
                    step.input === "original"
                      ? FileAudio
                      : step.input === "transcript"
                        ? FileText
                        : CornerDownRight;
                  return (
                    <li
                      key={step.id}
                      aria-label={`Step ${index + 1}`}
                      className="grid grid-cols-[1.75rem_minmax(0,1fr)_2rem] items-start gap-x-3 gap-y-3 p-4 @xl:grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)_2rem]"
                    >
                      <span
                        aria-hidden="true"
                        className="col-start-1 row-start-1 mt-6 flex size-7 items-center justify-center rounded-full border bg-muted/25 text-xs font-medium tabular-nums text-muted-foreground"
                      >
                        {index + 1}
                      </span>
                      <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-2">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <Label
                            htmlFor={`chain-prompt-${step.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Prompt
                          </Label>
                          {index === chain.steps.length - 1 && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              Final output
                            </span>
                          )}
                        </div>
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
                            className="data-[size=default]:h-9 w-full min-w-0 bg-background"
                          >
                            <SelectValue
                              className="min-w-0 truncate"
                              placeholder="Choose a prompt"
                            />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false} align="start">
                            {promptOptions.map((item) => (
                              <SelectItem
                                key={item.value}
                                value={item.value}
                                className="[&>span]:min-w-0"
                              >
                                <span className="truncate">{item.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-2 @xl:col-start-3 @xl:row-start-1">
                        <Label
                          htmlFor={`chain-input-${step.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Use text from
                        </Label>
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
                            className="data-[size=default]:h-9 w-full min-w-0 bg-background"
                          >
                            <InputIcon
                              aria-hidden="true"
                              className="size-3.5 text-muted-foreground"
                            />
                            <SelectValue className="min-w-0 truncate" />
                          </SelectTrigger>
                          <SelectContent
                            alignItemWithTrigger={false}
                            align="start"
                            className="min-w-64 max-w-[calc(100vw-2rem)]"
                          >
                            {inputOptions.map((item) => (
                              <SelectItem
                                key={item.value}
                                value={item.value}
                                aria-label={item.label}
                                aria-description={item.description}
                                className="py-2 [&>span]:min-w-0"
                              >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span className="truncate">{item.label}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {item.description}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-start-3 row-start-1 mt-6 @xl:col-start-4">
                        <Menu.Root>
                          <Menu.Trigger
                            disabled={disabled}
                            aria-label={`Step ${index + 1} actions`}
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                              />
                            }
                          >
                            <Ellipsis aria-hidden="true" className="size-4" />
                          </Menu.Trigger>
                          <Menu.Portal>
                            <Menu.Positioner align="end" sideOffset={4} className="z-50">
                              <Menu.Popup className={menuClass}>
                                <Menu.Item
                                  aria-label={`Move step ${index + 1} up`}
                                  disabled={disabled || index === 0 || !validOrder(move(index, -1))}
                                  onClick={() => update({ steps: move(index, -1) })}
                                  className={menuItemClass}
                                >
                                  <ArrowUp aria-hidden="true" className="size-4" />
                                  Move up
                                </Menu.Item>
                                <Menu.Item
                                  aria-label={`Move step ${index + 1} down`}
                                  disabled={
                                    disabled ||
                                    index === chain.steps.length - 1 ||
                                    !validOrder(move(index, 1))
                                  }
                                  onClick={() => update({ steps: move(index, 1) })}
                                  className={menuItemClass}
                                >
                                  <ArrowDown aria-hidden="true" className="size-4" />
                                  Move down
                                </Menu.Item>
                                <Menu.Item
                                  aria-label={`Remove step ${index + 1}`}
                                  disabled={disabled || chain.steps.length === 1 || referenced}
                                  onClick={() =>
                                    update({
                                      steps: chain.steps.filter((item) => item.id !== step.id),
                                    })
                                  }
                                  className={`${menuItemClass} text-destructive data-highlighted:bg-destructive/10`}
                                >
                                  <Trash2 aria-hidden="true" className="size-4" />
                                  Remove step
                                </Menu.Item>
                                {referenced && (
                                  <p className="mt-1 max-w-56 border-t px-3 pt-2 pb-1 text-xs leading-5 text-muted-foreground">
                                    Later steps use this result. Change their input before removing
                                    this step or moving it after them.
                                  </p>
                                )}
                              </Menu.Popup>
                            </Menu.Positioner>
                          </Menu.Portal>
                        </Menu.Root>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <Menu.Root>
                <Menu.Trigger
                  disabled={disabled || chain.steps.length >= 10 || !config.prompts.length}
                  render={
                    <Button
                      variant="outline"
                      className="w-full border-dashed text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <Plus aria-hidden="true" className="size-4" />
                  Add step
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner align="start" sideOffset={4} className="z-50">
                    <Menu.Popup
                      className={`${menuClass} max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto`}
                    >
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Choose a prompt to add
                      </p>
                      {promptOptions.map((prompt) => (
                        <Menu.Item
                          key={prompt.value}
                          onClick={() => addStep(prompt.value)}
                          className={menuItemClass}
                        >
                          <Sparkles
                            aria-hidden="true"
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="min-w-0 truncate">{prompt.label}</span>
                        </Menu.Item>
                      ))}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs leading-5 text-muted-foreground">
                  Steps run in order. Every completed result is kept.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setHistory(chain)}>
                  <History aria-hidden="true" className="size-3.5" />
                  Version history
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Delete chain
                </Button>
              </div>
            </div>
          </>
        )}
      </fieldset>
      {history && (
        <RevisionHistory
          kind="chain"
          itemId={history.id}
          title="Chain version history"
          prompts={config.prompts}
          current={JSON.stringify(chains.find((item) => item.id === history.id) ?? history)}
          onClose={() => setHistory(null)}
          validate={(value) => {
            const previous = JSON.parse(value) as PromptChain;
            const missing = previous.steps.some(
              (step) => !config.prompts.some((prompt) => prompt.id === step.promptId),
            );
            return missing
              ? "This version uses a prompt that no longer exists. Restore or recreate that prompt first."
              : validateTextProcessing({
                  ...config,
                  chains: chains.map((item) =>
                    item.id === history.id ? { ...previous, id: history.id } : item,
                  ),
                });
          }}
          onRestore={(value) => {
            const previous = JSON.parse(value) as PromptChain;
            onChange({
              chains: chains.map((item) =>
                item.id === history.id
                  ? { ...item, name: previous.name, steps: previous.steps }
                  : item,
              ),
            });
          }}
        />
      )}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chain?</DialogTitle>
            <DialogDescription>
              “{chain?.name}” will be removed. Its prompts and previously generated results are
              kept.
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
                if (chain) onDelete(chain);
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
