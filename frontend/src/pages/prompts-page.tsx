import { useDictation } from "@/components/dictation-provider";
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
import { Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
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
  { value: "models", label: "Models" },
  { value: "prompts", label: "Prompts" },
];
export function PromptsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sections.some((item) => item.value === searchParams.get("section"))
    ? searchParams.get("section")!
    : "models";
  const { snapshot, refresh, clearError, loading } = useDictation();
  const saved = snapshot.textProcessing;
  const [draft, setDraft] = useState<TextProcessing>(saved);
  const [selected, setSelected] = useState(saved.prompts[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<TextPrompt | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelDeleteButton = useRef<HTMLButtonElement>(null);
  const baseline = useRef(saved);
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
    const previous = baseline.current;
    baseline.current = saved;
    setDraft((old) => (JSON.stringify(old) === JSON.stringify(previous) ? saved : old));
  }, [saved]);
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
  const automaticOptions = [{ value: "", label: "No automatic processing" }, ...promptOptions];
  const prompt = draft.prompts.find((p) => p.id === selected);
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
          if (typeof value === "string")
            setSearchParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.set("section", value);
                return next;
              },
              { replace: true },
            );
        }}
        className="gap-5"
      >
        <header
          aria-label="Prompts"
          className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 bg-background py-2"
        >
          <h1 className="sr-only">Prompts</h1>
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
            <Button disabled={controlsDisabled || !dirty} onClick={() => void save()}>
              <Save aria-hidden="true" className="size-4" />
              {saving ? "Saving…" : "Save prompts"}
            </Button>
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
                      className={`size-3.5 ${discovery.phase === "checking" ? "animate-spin" : ""}`}
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
          <fieldset disabled={controlsDisabled} className="space-y-5 disabled:opacity-60">
            <SettingsSection
              title="Saved prompts"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={draft.prompts.length >= 30}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    update({
                      prompts: [...draft.prompts, { id, name: "New prompt", instruction: "" }],
                    });
                    setSelected(id);
                  }}
                >
                  <Plus className="size-4" />
                  Add prompt
                </Button>
              }
            >
              {draft.prompts.length > 0 ? (
                <>
                  <SettingRow title="Prompt" htmlFor="saved-prompt">
                    <Select
                      items={promptOptions}
                      value={selected || null}
                      disabled={controlsDisabled}
                      onValueChange={(value) => {
                        if (value !== null) setSelected(value);
                      }}
                    >
                      <SelectTrigger
                        id="saved-prompt"
                        className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"
                      >
                        <SelectValue placeholder="Choose a prompt" />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} align="start">
                        {promptOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingRow>
                  {prompt && (
                    <>
                      <SettingRow title="Name" htmlFor="prompt-name">
                        <Input
                          id="prompt-name"
                          value={prompt.name}
                          maxLength={80}
                          onChange={(event) => updatePrompt({ name: event.target.value })}
                        />
                      </SettingRow>
                      <SettingRow
                        title="Instructions"
                        htmlFor="prompt-instruction"
                        description="The transcript is supplied separately. Describe how to transform it."
                      >
                        <div className="space-y-3">
                          <textarea
                            id="prompt-instruction"
                            rows={7}
                            maxLength={8000}
                            value={prompt.instruction}
                            onChange={(event) => updatePrompt({ instruction: event.target.value })}
                            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 focus-visible:outline-ring"
                          />
                          <Button
                            ref={refineButton}
                            variant="outline"
                            size="sm"
                            disabled={!draft.model.trim() || !prompt.instruction.trim()}
                            onClick={refine}
                          >
                            <Sparkles aria-hidden="true" className="size-3.5" />
                            Refine prompt
                          </Button>
                          {!draft.model.trim() && (
                            <p className="text-xs text-muted-foreground">
                              Choose a text model to refine instructions.
                            </p>
                          )}
                          {refinementNotice && (
                            <p role="status" className="text-xs text-primary">
                              {refinementNotice}
                            </p>
                          )}
                        </div>
                      </SettingRow>
                      <SettingRow title="Manage prompt">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            ref={deleteButton}
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleting({ ...prompt })}
                          >
                            <Trash2 className="size-4" />
                            Delete prompt
                          </Button>
                          {defaultTextProcessing.prompts.some((p) => p.id === selected) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                updatePrompt({
                                  instruction: defaultTextProcessing.prompts.find(
                                    (p) => p.id === selected,
                                  )!.instruction,
                                })
                              }
                            >
                              Reset instructions
                            </Button>
                          )}
                        </div>
                      </SettingRow>
                    </>
                  )}
                </>
              ) : (
                <SettingRow title="Default prompts">
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
                </SettingRow>
              )}
            </SettingsSection>
            <SettingsSection title="Automatic processing">
              <SettingRow
                title="After dictation"
                htmlFor="auto-prompt"
                description="When enabled, the result is saved and copied or pasted automatically. If processing fails or is cancelled, the speech transcript stays in History and nothing is copied or pasted. You can also preview prompts from History."
              >
                <Select
                  items={automaticOptions}
                  value={draft.autoPromptId}
                  disabled={controlsDisabled || !draft.enabled}
                  onValueChange={(value) => {
                    if (value !== null) update({ autoPromptId: value });
                  }}
                >
                  <SelectTrigger
                    id="auto-prompt"
                    className="data-[size=default]:h-9 w-full min-w-0 rounded-md bg-background"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    {automaticOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            </SettingsSection>
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
                    setRefinementNotice("Refined instructions applied. Save prompts to keep them.");
                  }}
                >
                  Use instructions
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
