import { useDictation } from "@/components/dictation-provider";
import { ProfileSettingIndicator } from "@/components/profile-setting-indicator";
import { SettingRow, SettingsSection, ToggleSetting } from "@/components/settings-section";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import {
  backend,
  defaultTextProcessing,
  isBusy,
  isDesktop,
  message,
  type TextProcessing,
  type TextPrompt,
} from "@/lib/backend";
import { useModelDiscovery } from "@/lib/use-model-discovery";
import { useTextRequest } from "@/lib/use-text-request";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

const localServers = [
  { value: "ollama", label: "Ollama", endpoint: "http://127.0.0.1:11434/v1" },
  {
    value: "lm-studio",
    label: "LM Studio",
    endpoint: "http://127.0.0.1:1234/v1",
  },
  {
    value: "llama-server",
    label: "llama-server",
    endpoint: "http://127.0.0.1:8080/v1",
  },
];
const serverOptions = [...localServers, { value: "custom", label: "Custom" }];
const sections = [
  { value: "prompts", label: "Prompts" },
  { value: "models", label: "Text model" },
];
export function PromptsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sections.some((item) => item.value === searchParams.get("section"))
    ? searchParams.get("section")!
    : "prompts";
  const { snapshot, refresh, clearError, loading } = useDictation();
  const saved = snapshot.textProcessing;
  const [draft, setDraft] = useSavedDraft<TextProcessing>("prompts", saved);
  const [selected, setSelected] = useState(saved.prompts[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<TextPrompt | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelDeleteButton = useRef<HTMLButtonElement>(null);
  const modelTest = useTextRequest();
  const refinement = useTextRequest();
  const [refining, setRefining] = useState<{
    prompt: TextPrompt;
    endpoint: string;
    model: string;
  } | null>(null);
  const [refinementNotice, setRefinementNotice] = useState("");
  const refineButton = useRef<HTMLButtonElement>(null);
  const discovery = useModelDiscovery(draft.endpoint, isDesktop && !loading);
  const [manualModel, setManualModel] = useState(false);
  const [customServer, setCustomServer] = useState(false);
  const presetEndpoint = draft.endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace("://localhost:", "://127.0.0.1:");
  const server = customServer
    ? "custom"
    : (localServers.find((item) => item.endpoint === presetEndpoint)?.value ?? "custom");
  const listed = discovery.models.includes(draft.model);
  const manual = manualModel || !listed;
  const modelOptions = [
    ...discovery.models.map((id) => ({ value: `model:${id}`, label: id })),
    { value: "manual", label: "Enter model ID manually" },
  ];
  useEffect(() => {
    if (!draft.prompts.some((p) => p.id === selected)) setSelected(draft.prompts[0]?.id ?? "");
  }, [draft.prompts, selected]);
  useEffect(() => {
    if (modelTest.pending) {
      toastManager.close("prompt-model-test");
      return;
    }
    if (modelTest.result)
      toastManager.add({
        id: "prompt-model-test",
        type: "success",
        title: "Model responded successfully.",
      });
    else if (modelTest.error)
      toastManager.add({
        id: "prompt-model-test",
        type: "error",
        title: modelTest.error,
        priority: "high",
        timeout: 8000,
      });
  }, [modelTest.pending, modelTest.result, modelTest.error]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const busy = isBusy(snapshot.status.phase) || saving || modelTest.pending || refinement.pending;
  const controlsDisabled = !isDesktop || busy || loading;
  const promptOptions = draft.prompts.map((prompt) => ({
    value: prompt.id,
    label: prompt.name || "Untitled prompt",
  }));
  const prompt = draft.prompts.find((p) => p.id === selected);
  const automaticPrompt = draft.prompts.find((p) => p.id === draft.autoPromptId);
  const includedPrompt = defaultTextProcessing.prompts.find((p) => p.id === selected);
  const refinementCurrent =
    !!refining &&
    draft.prompts.some(
      (p) => p.id === refining.prompt.id && p.instruction === refining.prompt.instruction,
    ) &&
    draft.endpoint === refining.endpoint &&
    draft.model === refining.model;
  function update(value: Partial<TextProcessing>) {
    setDraft((old) => ({ ...old, ...value }));
    modelTest.clear();
    setRefinementNotice("");
  }
  function selectSection(value: string) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("section", value);
        return next;
      },
      { replace: true },
    );
  }
  function addPrompt() {
    if (controlsDisabled || draft.prompts.length >= 30) return;
    const id = crypto.randomUUID();
    update({ prompts: [...draft.prompts, { id, name: "New prompt", instruction: "" }] });
    setSelected(id);
  }
  function updatePrompt(value: Partial<TextPrompt>) {
    update({
      prompts: draft.prompts.map((p) => (p.id === selected ? { ...p, ...value } : p)),
    });
  }
  function deletePrompt() {
    if (!deleting || controlsDisabled || !draft.prompts.some((p) => p.id === deleting.id)) return;
    update({
      prompts: draft.prompts.filter((p) => p.id !== deleting.id),
      autoPromptId: draft.autoPromptId === deleting.id ? "" : draft.autoPromptId,
    });
    setDeleting(null);
  }
  function refine() {
    if (!prompt || busy || loading) return;
    const value = {
      prompt: { ...prompt },
      endpoint: draft.endpoint,
      model: draft.model,
    };
    setRefining(value);
    setRefinementNotice("");
    void refinement.request((id) =>
      backend.refinePrompt(id, value.endpoint, value.model, value.prompt.instruction),
    );
  }
  function closeRefinement() {
    if (refinement.pending) void refinement.cancel();
    setRefining(null);
  }
  async function save() {
    if (controlsDisabled) return;
    setSaving(true);
    clearError();
    toastManager.close("prompt-save");
    try {
      const value = await backend.textProcessing(draft);
      setDraft(value);
      modelTest.clear();
      await refresh();
      toastManager.add({
        id: "prompt-save",
        type: "success",
        title: "Prompts saved.",
      });
    } catch (cause) {
      toastManager.add({
        id: "prompt-save",
        type: "error",
        title: message(cause),
        priority: "high",
        timeout: 8000,
      });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="@container space-y-5">
      <Tabs
        value={section}
        onValueChange={(value) => {
          if (typeof value === "string") selectSection(value);
        }}
        className="gap-4"
      >
        <header
          aria-label="Prompts"
          className="sticky top-0 z-20 space-y-3 bg-background pt-1 pb-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Prompts</h1>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {dirty && (
                <>
                  <span role="status" className="text-xs text-muted-foreground">
                    Unsaved changes
                  </span>
                  <Button
                    variant="ghost"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setDraft(saved);
                      setManualModel(false);
                      setCustomServer(false);
                      modelTest.clear();
                    }}
                  >
                    Discard changes
                  </Button>
                </>
              )}
              {!dirty && <span className="sr-only">All changes saved</span>}
              <Button
                pressFeedback
                disabled={controlsDisabled || !dirty}
                onClick={() => void save()}
              >
                <Save aria-hidden="true" className="size-4" />
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList
              aria-label="Prompts sections"
              className="max-w-full group-data-[orientation=horizontal]/tabs:h-10"
            >
              {sections.map((item) => (
                <TabsTrigger key={item.value} value={item.value} className="px-2.5">
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </header>
        <TabsContent value="models" keepMounted>
          <SettingsSection title="Text model">
            <fieldset disabled={controlsDisabled} className="divide-y disabled:opacity-60">
              <ToggleSetting
                title="Enable LLM processing"
                checked={draft.enabled}
                disabled={controlsDisabled}
                onCheckedChange={(checked) =>
                  update({
                    enabled: checked,
                    autoPromptId: checked ? draft.autoPromptId : "",
                  })
                }
              />
              <SettingRow title="Server" htmlFor="llm-server">
                <Select
                  items={serverOptions}
                  value={server}
                  disabled={!isDesktop || busy || loading}
                  onValueChange={(value) => {
                    if (value === "custom") setCustomServer(true);
                    else {
                      const preset = localServers.find((item) => item.value === value);
                      if (preset) {
                        setCustomServer(false);
                        update({ endpoint: preset.endpoint });
                      }
                    }
                  }}
                >
                  <SelectTrigger
                    id="llm-server"
                    className="data-[size=default]:h-9 w-full rounded-md bg-background"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    <div className="p-1">
                      {serverOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </div>
                  </SelectContent>
                </Select>
              </SettingRow>
              <SettingRow title="Local server URL" htmlFor="llm-endpoint">
                <Input
                  id="llm-endpoint"
                  value={draft.endpoint}
                  placeholder="http://127.0.0.1:1234/v1"
                  aria-describedby="llm-endpoint-help"
                  onChange={(event) => update({ endpoint: event.target.value })}
                />
                <p id="llm-endpoint-help" className="mt-2 text-xs text-muted-foreground">
                  Use the local /v1 base URL, without /models or /api.
                </p>
              </SettingRow>
              <SettingRow
                title="Model"
                htmlFor="llm-picker"
                description="Models are listed for the selected server. Requests go to this computer; your server controls any onward connections."
              >
                <div className="space-y-3">
                  <Select
                    items={modelOptions}
                    value={manual ? "manual" : `model:${draft.model}`}
                    disabled={!isDesktop || busy || loading}
                    onValueChange={(value) => {
                      if (value === "manual") setManualModel(true);
                      else if (value?.startsWith("model:")) {
                        setManualModel(false);
                        update({ model: value.slice(6) });
                      }
                    }}
                  >
                    <SelectTrigger
                      id="llm-picker"
                      className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"
                      aria-describedby="llm-discovery-status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} align="start">
                      <div className="p-1">
                        {modelOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </div>
                    </SelectContent>
                  </Select>
                  {manual && (
                    <div className="space-y-2">
                      <Label htmlFor="llm-model">Model identifier</Label>
                      <Input
                        id="llm-model"
                        maxLength={200}
                        value={draft.model}
                        placeholder="Model ID from your server"
                        onChange={(event) => {
                          setManualModel(true);
                          update({ model: event.target.value });
                        }}
                      />
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={discovery.phase === "checking"}
                    onClick={() => void discovery.refresh()}
                  >
                    <RefreshCw
                      className={`size-3.5 ${discovery.phase === "checking" ? "animate-spin motion-reduce:animate-none" : ""}`}
                    />
                    Refresh models
                  </Button>
                  <p
                    id="llm-discovery-status"
                    role={discovery.phase === "error" ? "alert" : "status"}
                    className={`text-xs ${discovery.phase === "error" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {discovery.phase === "checking"
                      ? "Checking server…"
                      : discovery.phase === "error"
                        ? discovery.error
                        : discovery.phase === "ready"
                          ? discovery.models.length === 0
                            ? "Server responded. No models listed. Download or load a model in your server, then refresh."
                            : draft.model && !listed
                              ? "Server responded. This model is not listed. Load it in your server or choose another; Test model can check a manual ID."
                              : `Server responded. ${discovery.models.length} ${discovery.models.length === 1 ? "model" : "models"} available.`
                          : "Checking available models."}
                  </p>
                </div>
              </SettingRow>
            </fieldset>
            <SettingRow title="Connection test">
              {modelTest.pending ? (
                <div className="flex flex-wrap items-center gap-3" role="status">
                  <span className="text-sm">Testing model…</span>
                  <Button variant="outline" size="sm" onClick={() => void modelTest.cancel()}>
                    Cancel test
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    disabled={controlsDisabled || dirty || !saved.enabled}
                    onClick={() => void modelTest.request(backend.testTextModel)}
                  >
                    Test model
                  </Button>
                  {dirty && (
                    <span className="text-xs text-muted-foreground">Save before testing.</span>
                  )}
                </div>
              )}
            </SettingRow>
          </SettingsSection>
        </TabsContent>
        <TabsContent value="prompts" keepMounted>
          <fieldset disabled={controlsDisabled} className="min-w-0 disabled:opacity-60">
            <div className="mb-4 flex items-end gap-3 @3xl:hidden">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor="saved-prompt">Saved prompt</Label>
                <Select
                  items={promptOptions}
                  value={selected || null}
                  disabled={controlsDisabled || draft.prompts.length === 0}
                  onValueChange={(value) => {
                    if (value !== null) setSelected(value);
                  }}
                >
                  <SelectTrigger
                    id="saved-prompt"
                    className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"
                  >
                    <SelectValue placeholder="No saved prompts" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    {promptOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="[&>span]:min-w-0 [&>span]:whitespace-normal [&>span]:break-words"
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="ghost"
                disabled={controlsDisabled || draft.prompts.length >= 30}
                onClick={addPrompt}
              >
                <Plus aria-hidden="true" className="size-4" />
                Add prompt
              </Button>
            </div>
            <div className="grid min-w-0 items-start gap-5 @3xl:grid-cols-[13rem_minmax(0,1fr)] @3xl:gap-8">
              <section
                aria-labelledby="prompt-library-title"
                className="hidden min-w-0 @3xl:sticky @3xl:top-36 @3xl:block @3xl:border-r @3xl:border-border/50 @3xl:pr-5"
              >
                <header className="mb-3 flex items-center justify-between gap-2 pl-3">
                  <h2
                    id="prompt-library-title"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Saved prompts
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add prompt"
                    disabled={controlsDisabled || draft.prompts.length >= 30}
                    onClick={addPrompt}
                  >
                    <Plus aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Button>
                </header>
                <nav
                  aria-label="Saved prompts"
                  className="max-h-[max(12rem,calc(100dvh-15rem))] space-y-0.5 overflow-y-auto overscroll-contain pb-2"
                >
                  {draft.prompts.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={item.name || "Untitled prompt"}
                      aria-pressed={selected === item.id}
                      disabled={controlsDisabled}
                      onClick={() => {
                        setSelected(item.id);
                        setRefinementNotice("");
                      }}
                      className="relative flex min-h-10 w-full min-w-0 items-center rounded-md py-2 pr-2 pl-3 text-left text-muted-foreground outline-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed aria-pressed:text-foreground aria-pressed:before:opacity-100"
                    >
                      <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-1.5 text-sm">
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {item.name || "Untitled prompt"}
                        </span>
                        {draft.autoPromptId === item.id && (
                          <span className="text-[10px] text-primary">Automatic</span>
                        )}
                      </span>
                    </button>
                  ))}
                </nav>
              </section>
              <section aria-label="Prompt details" className="flex min-w-0 flex-col">
                {prompt ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-5">
                    <header className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="sr-only">{prompt.name || "Untitled prompt"}</h2>
                        <Label htmlFor="prompt-name" className="sr-only">
                          Name
                        </Label>
                        <input
                          id="prompt-name"
                          value={prompt.name}
                          placeholder="Prompt name"
                          maxLength={80}
                          onChange={(event) => updatePrompt({ name: event.target.value })}
                          className="-ml-2 h-12 min-w-40 flex-1 rounded-md border border-transparent bg-transparent px-2 text-2xl font-medium tracking-tight outline-none placeholder:text-muted-foreground hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        />
                        <div className="flex items-center gap-3">
                          <div className="flex min-h-8 items-center gap-1.5">
                            <Label
                              htmlFor="auto-prompt"
                              className="text-xs font-normal text-muted-foreground"
                            >
                              Run after dictation
                            </Label>
                            <ProfileSettingIndicator
                              field="autoPromptId"
                              value={draft.autoPromptId}
                              currentLabel={
                                draft.autoPromptId
                                  ? automaticPrompt
                                    ? automaticPrompt.name || "Untitled prompt"
                                    : "Prompt unavailable"
                                  : "No automatic processing"
                              }
                            />
                            <Switch
                              id="auto-prompt"
                              className="ml-1.5"
                              checked={draft.autoPromptId === prompt.id}
                              disabled={controlsDisabled || !draft.enabled}
                              aria-describedby="auto-prompt-help"
                              onCheckedChange={(checked) =>
                                update({ autoPromptId: checked ? prompt.id : "" })
                              }
                            />
                          </div>
                          <Menu.Root>
                            <Menu.Trigger
                              ref={deleteButton}
                              disabled={controlsDisabled}
                              render={<Button variant="ghost" size="icon-sm" />}
                              aria-label="More prompt actions"
                            >
                              <Ellipsis aria-hidden="true" className="size-4" />
                            </Menu.Trigger>
                            <Menu.Portal>
                              <Menu.Positioner align="end" sideOffset={4} className="z-50">
                                <Menu.Popup
                                  finalFocus={() => (deleting ? false : true)}
                                  className="min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 motion-popup"
                                >
                                  {includedPrompt && (
                                    <Menu.Item
                                      disabled={controlsDisabled}
                                      onClick={() =>
                                        updatePrompt({ instruction: includedPrompt.instruction })
                                      }
                                      className="rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
                                    >
                                      Reset instructions
                                    </Menu.Item>
                                  )}
                                  <Menu.Item
                                    disabled={controlsDisabled}
                                    onClick={() => setDeleting({ ...prompt })}
                                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive outline-none data-highlighted:bg-destructive/10"
                                  >
                                    <Trash2 aria-hidden="true" className="size-4" />
                                    Delete prompt
                                  </Menu.Item>
                                </Menu.Popup>
                              </Menu.Positioner>
                            </Menu.Portal>
                          </Menu.Root>
                        </div>
                      </div>
                      <p
                        id="auto-prompt-help"
                        role="status"
                        className={`text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere] ${draft.enabled && (!automaticPrompt || draft.autoPromptId === prompt.id) ? "sr-only" : ""}`}
                      >
                        {!draft.enabled ? (
                          <>
                            Enable LLM processing in{" "}
                            <button
                              type="button"
                              onClick={() => selectSection("models")}
                              className="text-primary underline underline-offset-4 focus-visible:outline-ring"
                            >
                              Text model
                            </button>{" "}
                            to run prompts automatically.
                          </>
                        ) : draft.autoPromptId === prompt.id ? (
                          "Runs automatically after every dictation."
                        ) : automaticPrompt ? (
                          `Turn on to replace ${automaticPrompt.name || "Untitled prompt"} after dictation.`
                        ) : (
                          "Automatic processing is off."
                        )}
                      </p>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <Label htmlFor="prompt-instruction" className="sr-only">
                        Instructions
                      </Label>
                      <p id="prompt-instruction-help" className="sr-only">
                        Describe the result you want. Your transcript is supplied automatically.
                      </p>
                      <textarea
                        id="prompt-instruction"
                        rows={9}
                        maxLength={8000}
                        value={prompt.instruction}
                        aria-describedby="prompt-instruction-help"
                        onChange={(event) => updatePrompt({ instruction: event.target.value })}
                        className="h-[clamp(18rem,calc(100dvh-18rem),32rem)] min-h-64 w-full resize-y rounded-md border-0 bg-transparent px-0 py-3 text-[15px] leading-7 text-foreground/90 outline-none focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ring/50"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <Button
                          ref={refineButton}
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-7 px-2 text-xs font-normal text-muted-foreground hover:text-primary"
                          disabled={
                            controlsDisabled || !draft.model.trim() || !prompt.instruction.trim()
                          }
                          onClick={refine}
                        >
                          <Sparkles aria-hidden="true" className="size-3.5" />
                          Refine prompt
                        </Button>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Array.from(prompt.instruction).length.toLocaleString()} / 8,000
                        </span>
                      </div>
                    </div>
                    {refinementNotice && (
                      <p role="status" className="text-xs text-primary">
                        {refinementNotice}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold">No saved prompts</h2>
                    <p className="text-sm text-muted-foreground">
                      Add a prompt or start with Cleanup and Summary.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() =>
                        update({
                          prompts: defaultTextProcessing.prompts.map((p) => ({
                            ...p,
                          })),
                        })
                      }
                    >
                      Restore default prompts
                    </Button>
                  </div>
                )}
              </section>
            </div>
          </fieldset>
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!deleting}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={cancelDeleteButton}
          finalFocus={deleteButton}
        >
          <DialogHeader>
            <DialogTitle>Delete this prompt?</DialogTitle>
            <DialogDescription>
              “{deleting?.name || "Untitled prompt"}” will be removed when you save your changes.
              {deleting &&
                draft.autoPromptId === deleting.id &&
                " Automatic processing after dictation will be turned off."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelDeleteButton} variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={controlsDisabled || !draft.prompts.some((p) => p.id === deleting?.id)}
              onClick={deletePrompt}
            >
              Delete prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!refining}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) closeRefinement();
        }}
      >
        <DialogContent
          finalFocus={refineButton}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl"
        >
          {refining && (
            <>
              <DialogHeader>
                <DialogTitle>Refine prompt</DialogTitle>
                <DialogDescription>
                  Review the refined instructions before applying them to your draft.
                </DialogDescription>
              </DialogHeader>
              <div className="grid items-start gap-4 md:grid-cols-2">
                <section className="min-w-0 space-y-2">
                  <Label htmlFor="refine-original">Your instructions</Label>
                  <textarea
                    id="refine-original"
                    readOnly
                    rows={9}
                    value={refining.prompt.instruction}
                    className="max-h-[40vh] w-full resize-y rounded-md border bg-muted/20 px-3 py-2 text-sm leading-6"
                  />
                </section>
                <section className="min-w-0 space-y-2">
                  <Label htmlFor="refine-preview">Refined instructions</Label>
                  <textarea
                    id="refine-preview"
                    readOnly
                    rows={9}
                    value={refinement.result}
                    placeholder={
                      refinement.pending ? "Refining instructions…" : "No refined instructions yet."
                    }
                    className="max-h-[40vh] w-full resize-y rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm leading-6"
                  />
                </section>
              </div>
              <p className="break-words text-xs text-muted-foreground">{refining.model}</p>
              {refinement.pending && (
                <div role="status" className="flex items-center gap-3">
                  <span className="text-sm">Refining instructions…</span>
                  <Button variant="outline" size="sm" onClick={() => void refinement.cancel()}>
                    Cancel refinement
                  </Button>
                </div>
              )}
              {refinement.error && (
                <p role="alert" className="text-sm text-destructive">
                  {refinement.error}
                </p>
              )}
              {!refinementCurrent && (
                <p role="alert" className="text-sm text-destructive">
                  Prompt or model settings changed. Close this preview and refine again.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeRefinement}>
                  Discard preview
                </Button>
                {!refinement.pending && (
                  <Button
                    variant="outline"
                    disabled={!refinementCurrent || isBusy(snapshot.status.phase)}
                    onClick={() =>
                      void refinement.request((id) =>
                        backend.refinePrompt(
                          id,
                          refining.endpoint,
                          refining.model,
                          refining.prompt.instruction,
                        ),
                      )
                    }
                  >
                    Refine again
                  </Button>
                )}
                <Button
                  disabled={
                    !refinement.result ||
                    refinement.pending ||
                    !refinementCurrent ||
                    Array.from(refinement.result).length > 8000
                  }
                  onClick={() => {
                    if (!refinementCurrent) return;
                    update({
                      prompts: draft.prompts.map((p) =>
                        p.id === refining.prompt.id ? { ...p, instruction: refinement.result } : p,
                      ),
                    });
                    setRefining(null);
                    setRefinementNotice("Refined instructions applied. Save changes to keep them.");
                  }}
                >
                  Apply to draft
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
