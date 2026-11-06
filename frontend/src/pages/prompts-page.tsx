import i18n from "@/i18n";
import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { AutoSaveStatus } from "@/components/auto-save-status";
import { useDictation } from "@/components/dictation-provider";
import { ProfileSettingIndicator } from "@/components/profile-setting-indicator";
import { PromptChainsEditor } from "@/components/prompt-chains-editor";
import { RevisionHistory } from "@/components/revision-history";
import { SectionTabs } from "@/components/section-tabs";
import { SettingRow, ToggleSetting } from "@/components/settings-section";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  backend,
  defaultTextProcessing,
  isBusy,
  isDesktop,
  message,
  type TextProcessing,
  type TextPrompt,
} from "@/lib/backend";
import { deleteDraftItem } from "@/lib/delete-draft-item";
import { validateTextProcessing } from "@/lib/draft-validation";
import { useAutoSave } from "@/lib/use-auto-save";
import { useModelDiscovery } from "@/lib/use-model-discovery";
import { useSavedDraft } from "@/lib/use-saved-draft";
import { useTextRequest } from "@/lib/use-text-request";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, History, Info, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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

function AutomationHelp({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Tooltip open={open} onOpenChange={setOpen} triggerId={id}>
      <TooltipTrigger
        id={id}
        closeOnClick={false}
        render={<Button type="button" variant="ghost" size="icon-sm" />}
        aria-label={t("uiPolish.promptAutomationInfo")}
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent role="tooltip" side="bottom" className="leading-5">
        {t(active ? "uiPolish.automaticPromptHelp" : "uiPolish.promptAutomationOff")}
      </TooltipContent>
    </Tooltip>
  );
}

export function PromptsPage() {
  const { t } = useTranslation();
  const serverOptions = [...localServers, { value: "custom", label: t("promptsPage.custom") }];
  const sections = [
    { value: "prompts", label: t("promptsPage.prompts") },
    { value: "chains", label: t("promptsPage.chains") },
    { value: "models", label: t("promptsPage.textModel") },
  ];

  const [searchParams, setSearchParams] = useSearchParams();
  const section = sections.some((item) => item.value === searchParams.get("section"))
    ? searchParams.get("section")!
    : "prompts";
  const { snapshot, refresh, clearError, loading } = useDictation();
  const saved = snapshot.textProcessing;
  const [draft, setDraft, draftState] = useSavedDraft<TextProcessing>("prompts", saved);
  const [selected, setSelected] = useState(saved.prompts[0]?.id ?? "");
  const [saveError, setSaveError] = useState("");
  const [historyPrompt, setHistoryPrompt] = useState<TextPrompt | null>(null);
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
    { value: "manual", label: t("promptsPage.enterModelIDManually") },
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
        title: i18n.t("promptsPage.modelRespondedSuccessfully"),
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
  const dirty = draftState.dirty;
  const reason = validateTextProcessing(draft);
  const busy = isBusy(snapshot.status.phase) || modelTest.pending || refinement.pending;
  const controlsDisabled = !isDesktop || busy || loading;
  const promptOptions = draft.prompts.map((prompt) => ({
    value: prompt.id,
    label: prompt.name || t("promptsPage.untitledPrompt"),
  }));
  const prompt = draft.prompts.find((p) => p.id === selected);
  const automaticPrompt = [...draft.prompts, ...(draft.chains ?? [])].find(
    (p) => p.id === draft.autoPromptId,
  );
  const dependentChains = (draft.chains ?? []).filter((chain) =>
    chain.steps.some((step) => step.promptId === deleting?.id),
  );
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
    update({
      prompts: [...draft.prompts, { id, name: t("promptsPage.newPrompt"), instruction: "" }],
    });
    setSelected(id);
  }
  function updatePrompt(value: Partial<TextPrompt>) {
    update({
      prompts: draft.prompts.map((p) => (p.id === selected ? { ...p, ...value } : p)),
    });
  }
  function deletePrompt() {
    if (
      !deleting ||
      controlsDisabled ||
      dependentChains.length ||
      !draft.prompts.some((p) => p.id === deleting.id)
    )
      return;
    deleteDraftItem(
      draft,
      {
        ...draft,
        prompts: draft.prompts.filter((p) => p.id !== deleting.id),
        autoPromptId: draft.autoPromptId === deleting.id ? "" : draft.autoPromptId,
      },
      setDraft,
      "Prompt",
    );
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
    clearError();
    setSaveError("");
    try {
      await backend.textProcessing(draft);
      draftState.markSubmitted(draft);
      modelTest.clear();
      await refresh();
    } catch (cause) {
      setSaveError(message(cause));
      toastManager.add({
        id: "prompt-save",
        type: "error",
        title: message(cause),
        priority: "high",
        timeout: 8000,
      });
      throw cause;
    }
  }
  const autoSave = useAutoSave({
    draftKey: JSON.stringify(draft),
    dirty,
    canSave: !controlsDisabled && !reason,
    save,
    delay: 1000,
  });
  return (
    <div className="@container/prompts space-y-5">
      <Tabs
        value={section}
        onValueChange={(value) => {
          if (typeof value === "string") selectSection(value);
        }}
        className="gap-4"
      >
        <header
          aria-label={t("promptsPage.promptsChains")}
          className="sticky top-0 z-20 space-y-3 bg-background pt-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("promptsPage.promptsChains")}
              </h1>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <AutoSaveStatus
                status={autoSave.status}
                showDiscard={dirty && !autoSave.saving}
                reason={reason}
                retry={autoSave.retry}
                disabled={controlsDisabled}
                discard={() => {
                  setDraft(saved);
                  setManualModel(false);
                  setCustomServer(false);
                  modelTest.clear();
                }}
              />
            </div>
          </div>
          <SectionTabs label={t("promptsPage.promptsSections")} sections={sections} />
        </header>
        {saveError && autoSave.failed && (
          <p role="alert" className="text-xs text-destructive">
            {saveError}
          </p>
        )}
        <TabsContent value="models" keepMounted>
          <p className="mb-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("uiPolish.textModelIntro")}
          </p>
          <details className="mb-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("uiPolish.localTextSetup")}
            </summary>
            <p className="mt-2 max-w-2xl leading-6">{t("uiPolish.localTextSetupHelp")}</p>
          </details>
          <section aria-label={t("promptsPage.textModel")} className="max-w-3xl divide-y">
            <fieldset disabled={controlsDisabled} className="divide-y disabled:opacity-60">
              <ToggleSetting
                title={t("uiPolish.enableTextProcessing")}
                description={
                  !draft.enabled
                    ? t("uiPolish.textProcessingOff")
                    : t("uiPolish.processingEnabledHelp")
                }
                checked={draft.enabled}
                disabled={controlsDisabled}
                onCheckedChange={(checked) =>
                  update({
                    enabled: checked,
                    autoPromptId: checked ? draft.autoPromptId : "",
                  })
                }
              />
              <SettingRow title={t("promptsPage.server")} htmlFor="llm-server">
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
              <details
                open={server === "custom" || undefined}
                className="py-3 text-xs text-muted-foreground"
              >
                <summary
                  className={
                    server === "custom"
                      ? "hidden"
                      : "cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  }
                >
                  {t("uiPolish.serverAddress")}
                </summary>
                <SettingRow title={t("promptsPage.localServerURL")} htmlFor="llm-endpoint">
                  <Input
                    id="llm-endpoint"
                    value={draft.endpoint}
                    placeholder="http://127.0.0.1:1234/v1"
                    aria-describedby="llm-endpoint-help"
                    onChange={(event) => update({ endpoint: event.target.value })}
                  />
                  <p id="llm-endpoint-help" className="mt-2 text-xs text-muted-foreground">
                    {t("promptsPage.useTheLocalV1BaseURLWithout")}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {t("promptsPage.modelsAreListedForTheSelectedServer")}
                  </p>
                </SettingRow>
              </details>
            </fieldset>
            <SettingRow title={t("common.model")} htmlFor="llm-picker">
              <div className="space-y-3">
                <fieldset disabled={controlsDisabled} className="space-y-3 disabled:opacity-60">
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
                      <Label htmlFor="llm-model">{t("promptsPage.modelIdentifier")}</Label>
                      <Input
                        id="llm-model"
                        maxLength={200}
                        value={draft.model}
                        placeholder={t("promptsPage.modelIDFromYourServer")}
                        onChange={(event) => {
                          setManualModel(true);
                          update({ model: event.target.value });
                        }}
                      />
                    </div>
                  )}
                </fieldset>
                <div
                  role="group"
                  aria-label={t("promptsPage.connectionTest")}
                  className="space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {modelTest.pending ? (
                      <div className="flex flex-wrap items-center gap-3" role="status">
                        <span className="text-sm">{t("promptsPage.testingModel")}</span>
                        <Button variant="outline" size="sm" onClick={() => void modelTest.cancel()}>
                          {t("promptsPage.cancelTest")}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          size="sm"
                          disabled={controlsDisabled || dirty || !saved.enabled}
                          onClick={() => void modelTest.request(backend.testTextModel)}
                        >
                          {t("promptsPage.testModel")}
                        </Button>
                        {dirty && (
                          <span className="text-xs text-muted-foreground">
                            {t("promptsPage.waitUntilSavedBeforeTesting")}
                          </span>
                        )}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={controlsDisabled || discovery.phase === "checking"}
                      onClick={() => void discovery.refresh()}
                    >
                      <RefreshCw
                        className={`size-3.5 ${discovery.phase === "checking" ? "animate-spin motion-reduce:animate-none" : ""}`}
                      />
                      {t("promptsPage.refreshModels")}
                    </Button>
                  </div>
                  <p
                    id="llm-discovery-status"
                    hidden={modelTest.pending}
                    role={
                      modelTest.error ? undefined : discovery.phase === "error" ? "alert" : "status"
                    }
                    className={`text-xs leading-5 ${modelTest.error || discovery.phase === "error" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {modelTest.error
                      ? nativeText(modelTest.error)
                      : modelTest.result
                        ? t("promptsPage.modelRespondedSuccessfully")
                        : discovery.phase === "checking"
                          ? t("promptsPage.checkingServer")
                          : discovery.phase === "error"
                            ? discovery.error
                            : discovery.phase === "ready"
                              ? discovery.models.length === 0
                                ? t("promptsPage.serverRespondedNoModelsListedDownloadOr")
                                : draft.model && !listed
                                  ? t("promptsPage.serverRespondedThisModelIsNotListed")
                                  : t("promptsPage.serverRespondedAvailable", {
                                      count: discovery.models.length,
                                    })
                              : t("promptsPage.checkingAvailableModels")}
                  </p>
                </div>
              </div>
            </SettingRow>
          </section>
        </TabsContent>
        <TabsContent value="chains" keepMounted>
          <PromptChainsEditor
            config={draft}
            disabled={controlsDisabled}
            onChange={update}
            onConfigureModel={() => selectSection("models")}
            onDelete={(chain) =>
              deleteDraftItem(
                draft,
                {
                  ...draft,
                  chains: (draft.chains ?? []).filter((item) => item.id !== chain.id),
                  autoPromptId: draft.autoPromptId === chain.id ? "" : draft.autoPromptId,
                },
                setDraft,
                "Chain",
              )
            }
          />
        </TabsContent>
        <TabsContent value="prompts" keepMounted>
          <fieldset disabled={controlsDisabled} className="min-w-0 disabled:opacity-60">
            <div className="mb-4 flex items-end gap-3 @3xl:hidden">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor="saved-prompt">{t("promptsPage.savedPrompt")}</Label>
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
                    <SelectValue placeholder={t("promptsPage.noSavedPrompts")} />
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
                {t("promptsPage.addPrompt")}
              </Button>
            </div>
            <div className="grid min-w-0 items-start gap-5 @3xl:grid-cols-[13rem_minmax(0,1fr)] @3xl:gap-8">
              <section
                aria-labelledby="prompt-library-title"
                className="hidden min-w-0 @3xl:sticky @3xl:top-36 @3xl:block @3xl:border-r @3xl:border-border/50 @3xl:pr-5"
              >
                <header className="mb-3 space-y-3">
                  <h2
                    id="prompt-library-title"
                    className="px-3 text-sm font-medium text-muted-foreground"
                  >
                    {t("promptsPage.savedPrompts")}
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    aria-label={t("promptsPage.addPrompt")}
                    disabled={controlsDisabled || draft.prompts.length >= 30}
                    onClick={addPrompt}
                  >
                    <Plus aria-hidden="true" className="size-4 text-muted-foreground" />
                    {t("promptsPage.addPrompt")}
                  </Button>
                </header>
                <nav
                  aria-label={t("promptsPage.savedPrompts")}
                  className="max-h-[max(12rem,calc(100dvh-15rem))] space-y-0.5 overflow-y-auto overscroll-contain pb-2"
                >
                  {draft.prompts.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={item.name || t("promptsPage.untitledPrompt")}
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
                          {item.name || t("promptsPage.untitledPrompt")}
                        </span>
                        {draft.autoPromptId === item.id && (
                          <span className="text-[10px] text-primary">
                            {t("promptsPage.automatic")}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </nav>
              </section>
              <section
                aria-label={t("promptsPage.promptDetails")}
                className="flex min-w-0 flex-col"
              >
                {prompt ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-5">
                    <header className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="sr-only">
                          {prompt.name || t("promptsPage.untitledPrompt")}
                        </h2>
                        <Label htmlFor="prompt-name" className="sr-only">
                          {t("promptsPage.name")}
                        </Label>
                        <input
                          id="prompt-name"
                          value={prompt.name}
                          placeholder={t("promptsPage.promptName")}
                          maxLength={80}
                          onChange={(event) => updatePrompt({ name: event.target.value })}
                          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-xl font-medium tracking-tight outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                        />
                        <div className="flex items-center gap-3">
                          <Menu.Root>
                            <Menu.Trigger
                              ref={deleteButton}
                              disabled={controlsDisabled}
                              render={<Button variant="ghost" size="icon-sm" />}
                              aria-label={t("promptsPage.morePromptActions")}
                            >
                              <Ellipsis aria-hidden="true" className="size-4" />
                            </Menu.Trigger>
                            <Menu.Portal>
                              <Menu.Positioner align="end" sideOffset={4} className="z-50">
                                <Menu.Popup
                                  finalFocus={() => (deleting ? false : true)}
                                  className="min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 motion-popup"
                                >
                                  <Menu.Item
                                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
                                    onClick={() => setHistoryPrompt(prompt)}
                                  >
                                    <History aria-hidden="true" className="size-4" />
                                    {t("promptsPage.versionHistory")}
                                  </Menu.Item>
                                  {includedPrompt && (
                                    <Menu.Item
                                      disabled={controlsDisabled}
                                      onClick={() =>
                                        updatePrompt({ instruction: includedPrompt.instruction })
                                      }
                                      className="rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
                                    >
                                      {t("promptsPage.resetInstructions")}
                                    </Menu.Item>
                                  )}
                                  <Menu.Item
                                    disabled={controlsDisabled}
                                    onClick={() => setDeleting({ ...prompt })}
                                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive outline-none data-highlighted:bg-destructive/10"
                                  >
                                    <Trash2 aria-hidden="true" className="size-4" />
                                    {t("promptsPage.deletePrompt")}
                                  </Menu.Item>
                                </Menu.Popup>
                              </Menu.Positioner>
                            </Menu.Portal>
                          </Menu.Root>
                        </div>
                      </div>
                      <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <Label htmlFor="auto-prompt" className="text-sm font-medium">
                            {t("promptsPage.runAfterDictation")}
                          </Label>
                          <AutomationHelp
                            key={prompt.id}
                            active={draft.autoPromptId === prompt.id}
                          />
                        </div>
                        <ProfileSettingIndicator
                          field="autoPromptId"
                          value={draft.autoPromptId}
                          currentLabel={
                            draft.autoPromptId
                              ? automaticPrompt
                                ? automaticPrompt.name || t("promptsPage.untitledPrompt")
                                : t("promptsPage.promptUnavailable")
                              : t("common.noAutomaticProcessing")
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
                      <p
                        id="auto-prompt-help"
                        role="status"
                        className={
                          draft.enabled && (draft.autoPromptId === prompt.id || !automaticPrompt)
                            ? "sr-only"
                            : "text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                        }
                      >
                        {!draft.enabled ? (
                          <>
                            {t("promptsPage.enableLLMProcessingIn")}{" "}
                            <button
                              type="button"
                              onClick={() => selectSection("models")}
                              className="text-primary underline underline-offset-4 focus-visible:outline-ring"
                            >
                              {t("promptsPage.textModel")}
                            </button>{" "}
                            {t("promptsPage.toRunPromptsAutomatically")}
                          </>
                        ) : draft.autoPromptId === prompt.id ? (
                          t("uiPolish.automaticPromptHelp")
                        ) : automaticPrompt ? (
                          t("promptsPage.turnOnToReplaceAfterDictation", {
                            prompt: automaticPrompt.name || t("promptsPage.untitledPrompt"),
                          })
                        ) : (
                          t("uiPolish.promptAutomationOff")
                        )}
                      </p>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <Label htmlFor="prompt-instruction">{t("promptsPage.instructions")}</Label>
                      <p
                        id="prompt-instruction-help"
                        className="text-sm leading-6 text-muted-foreground"
                      >
                        {t("promptsPage.describeTheResultYouWantYourTranscript")}
                      </p>
                      <textarea
                        id="prompt-instruction"
                        rows={6}
                        maxLength={8000}
                        value={prompt.instruction}
                        aria-describedby="prompt-instruction-help"
                        onChange={(event) => updatePrompt({ instruction: event.target.value })}
                        className="max-h-96 min-h-36 w-full resize-y rounded-lg border border-input bg-card px-4 py-3 text-[15px] leading-7 text-foreground outline-none [field-sizing:content] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <Button
                          ref={refineButton}
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-foreground"
                          disabled={
                            controlsDisabled || !draft.model.trim() || !prompt.instruction.trim()
                          }
                          onClick={refine}
                        >
                          <Sparkles aria-hidden="true" className="size-3.5" />
                          {t("promptsPage.refinePrompt")}
                        </Button>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Array.from(prompt.instruction).length.toLocaleString(
                            i18n.resolvedLanguage,
                          )}{" "}
                          / 8,000
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("uiPolish.refineHelp")}</p>
                    {refinementNotice && (
                      <p role="status" className="text-xs text-primary">
                        {refinementNotice}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold">{t("promptsPage.noSavedPrompts")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("promptsPage.addAPromptOrStartWithCleanup")}
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
                      {t("promptsPage.restoreDefaultPrompts")}
                    </Button>
                  </div>
                )}
              </section>
            </div>
          </fieldset>
        </TabsContent>
      </Tabs>
      {historyPrompt && (
        <RevisionHistory
          kind="prompt"
          itemId={historyPrompt.id}
          title={t("promptsPage.promptVersionHistory")}
          current={JSON.stringify(
            draft.prompts.find((item) => item.id === historyPrompt.id) ?? historyPrompt,
          )}
          onClose={() => setHistoryPrompt(null)}
          onRestore={(value) => {
            const previous = JSON.parse(value) as TextPrompt;
            setDraft((old) => ({
              ...old,
              prompts: old.prompts.map((item) =>
                item.id === historyPrompt.id
                  ? { ...item, name: previous.name, instruction: previous.instruction }
                  : item,
              ),
            }));
          }}
        />
      )}
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
            <DialogTitle>{t("promptsPage.deleteThisPrompt")}</DialogTitle>
            <DialogDescription>
              {t("promptsPage.deleteDescription", {
                name: deleting?.name || t("promptsPage.untitledPrompt"),
              })}
              {deleting &&
                draft.autoPromptId === deleting.id &&
                t("promptsPage.automaticProcessingAfterDictationWillBeTurnedOff")}
              {dependentChains.length > 0 &&
                t("promptsPage.dependentChains", {
                  chains: dependentChains.map((chain) => chain.name).join(", "),
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelDeleteButton} variant="outline" onClick={() => setDeleting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                controlsDisabled ||
                dependentChains.length > 0 ||
                !draft.prompts.some((p) => p.id === deleting?.id)
              }
              onClick={deletePrompt}
            >
              {t("promptsPage.deletePrompt")}
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
                <DialogTitle>{t("promptsPage.refinePrompt")}</DialogTitle>
                <DialogDescription>
                  {t("promptsPage.reviewTheRefinedInstructionsBeforeApplyingThem")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid items-start gap-4 md:grid-cols-2">
                <section className="min-w-0 space-y-2">
                  <Label htmlFor="refine-original">{t("promptsPage.yourInstructions")}</Label>
                  <textarea
                    id="refine-original"
                    readOnly
                    rows={9}
                    value={refining.prompt.instruction}
                    className="max-h-[40vh] w-full resize-y rounded-md border bg-muted/20 px-3 py-2 text-sm leading-6"
                  />
                </section>
                <section className="min-w-0 space-y-2">
                  <Label htmlFor="refine-preview">{t("promptsPage.refinedInstructions")}</Label>
                  <textarea
                    id="refine-preview"
                    readOnly
                    rows={9}
                    value={refinement.result}
                    placeholder={
                      refinement.pending
                        ? t("promptsPage.refiningInstructions")
                        : t("promptsPage.noRefinedInstructionsYet")
                    }
                    className="max-h-[40vh] w-full resize-y rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm leading-6"
                  />
                </section>
              </div>
              <p className="break-words text-xs text-muted-foreground">{refining.model}</p>
              {refinement.pending && (
                <div role="status" className="flex items-center gap-3">
                  <span className="text-sm">{t("promptsPage.refiningInstructions")}</span>
                  <Button variant="outline" size="sm" onClick={() => void refinement.cancel()}>
                    {t("promptsPage.cancelRefinement")}
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
                  {t("promptsPage.promptOrModelSettingsChangedCloseThis")}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeRefinement}>
                  {t("promptsPage.discardPreview")}
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
                    {t("promptsPage.refineAgain")}
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
                    setRefinementNotice(t("promptsPage.refinedInstructionsApplied"));
                  }}
                >
                  {t("promptsPage.applyToDraft")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
