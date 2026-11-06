import { Popover } from "@base-ui/react/popover";
import { useTranslation } from "react-i18next";
import { nativeText } from "@/i18n/native-text";
import { AudioImportButton } from "@/components/audio-import-button";
import { ProfileSelector } from "@/components/dictation-profiles";
import { useDictation } from "@/components/dictation-provider";
import { HomeResultPanel } from "@/components/home-result-panel";
import { ShortcutStatus } from "@/components/shortcut-status";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { backend, duration, isBusy, isDesktop } from "@/lib/backend";
import { useMotionPreference } from "@/lib/use-motion-preference";
import { SetupPage } from "@/pages/setup-page";
import {
  ChevronDown,
  Download,
  Keyboard,
  Loader2,
  Mic,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resultFallback = useRef<HTMLButtonElement>(null);
  const reduced = useMotionPreference();
  const { snapshot, loading, level, run, installModel } = useDictation();
  const { status, settings, ready } = snapshot;
  const [now, setNow] = useState(Date.now());
  const [historyPending, setHistoryPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [profileReceipt, setProfileReceipt] = useState("");
  const [latestVisible, setLatestVisible] = useState(false);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const recording = status.phase === "recording";
  const downloading = status.phase === "downloading" && !status.importId;
  const downloadPercent = Math.round(Math.min(1, Math.max(0, status.progress)) * 100);
  const working = isBusy(status.phase) && !recording;
  const activeModel = snapshot.models.find(
    (model) => model.path === settings.modelPath && model.installed,
  );
  const currentProfile = snapshot.dictationProfiles?.find(
    (profile) =>
      profile.id ===
      ((recording || status.phase === "transcribing" ? status.profileId : undefined) ||
        snapshot.activeProfileId),
  );
  const selectedModel = activeModel
    ? `model:${activeModel.id}`
    : settings.modelPath
      ? `custom:${settings.modelPath}`
      : null;
  const modelOptions = snapshot.models.map((model) => ({
    value: `model:${model.id}`,
    label: model.name,
    download: !model.installed,
  }));
  if (settings.modelPath && !activeModel)
    modelOptions.unshift({
      value: selectedModel!,
      label: settings.modelPath.split(/[\\/]/).pop() || t("homePage.customModel"),
      download: false,
    });
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [recording]);
  async function record() {
    setPending(true);
    await run(recording ? backend.stop : backend.start);
    setPending(false);
  }
  async function selectModel(value: string | null) {
    if (
      !isDesktop ||
      loading ||
      pending ||
      switchingModel ||
      switchingProfile ||
      isBusy(status.phase) ||
      value === selectedModel
    )
      return;
    const model = snapshot.models.find((model) => `model:${model.id}` === value);
    if (!model) return;
    setSwitchingModel(true);
    try {
      if (model.installed)
        await run(() => backend.settings({ ...settings, modelPath: model.path }));
      else await installModel(model);
    } finally {
      setSwitchingModel(false);
    }
  }
  const savingToHistory =
    recording || status.phase === "transcribing"
      ? snapshot.recordingSaveHistory
      : settings.saveHistory;
  if (isDesktop && !loading && !settings.setupComplete) return <SetupPage />;
  return (
    <div
      data-slot="home-surface"
      data-home-has-result={latestVisible || undefined}
      className="@container/home flex min-h-0 flex-1 flex-col overflow-y-auto px-[clamp(1rem,4vw,1.5rem)] py-4 lg:px-[clamp(1rem,4vw,2.5rem)]"
    >
      <h1 className="sr-only">{t("uiPolish.homeWorkspaceTitle")}</h1>
      <div
        data-slot="home-document-frame"
        className={`mx-auto flex min-h-min w-full max-w-[59rem] flex-col rounded-2xl border bg-card [--home-inset:clamp(16px,2.5vw,28px)] ${latestVisible ? "flex-1" : "shrink-0"}`}
      >
        <section
          data-slot="home-recorder"
          aria-label={t("homePage.dictationRecorder")}
          className="shrink-0 border-b bg-transparent"
        >
          <div
            data-slot="home-recorder-toolbar"
            className="home-reading-inset mx-auto flex w-full max-w-5xl flex-wrap items-center gap-1.5 px-[clamp(1rem,4vw,1.5rem)] py-4 @max-[24rem]/home:py-2 @max-[12rem]/home:gap-[8px] @max-[12rem]/home:px-[12px] @max-[12rem]/home:py-[8px] @min-[34rem]/home:gap-3 lg:px-[clamp(1rem,4vw,2.5rem)]"
          >
            <Button
              ref={resultFallback}
              data-slot="home-record-button"
              disabled={
                !isDesktop || working || loading || pending || switchingModel || switchingProfile
              }
              onClick={() => {
                if (!ready && !recording) navigate("/models");
                else void record();
              }}
              className="h-auto min-h-10 max-w-full whitespace-normal @max-[12rem]/home:min-h-[44px] @max-[12rem]/home:min-w-[44px] @max-[12rem]/home:px-[8px] @max-[12rem]/home:has-[>svg]:px-[8px]"
            >
              {working || pending ? (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : recording ? (
                <Square aria-hidden="true" className="size-3.5 fill-current" />
              ) : !ready ? (
                <Download aria-hidden="true" className="size-4" />
              ) : (
                <Mic aria-hidden="true" className="size-4" />
              )}
              <span className="@max-[12rem]/home:sr-only">
                {recording
                  ? t("homePage.stopRecording")
                  : downloading
                    ? t("modelsPage.downloading")
                    : status.phase === "transcribing"
                      ? t("importQueueRow.transcribing")
                      : working
                        ? t("uiPolish.working")
                        : !ready
                          ? t("uiPolish.chooseSpeechModel")
                          : t("homePage.startRecording")}
              </span>
            </Button>
            {recording && (
              <div className="flex items-center gap-3 text-sm text-primary">
                <span className="font-mono tabular-nums">
                  {duration(Math.max(0, now - status.startedAt))}
                </span>
                <span
                  data-slot="recording-level-meter"
                  aria-hidden="true"
                  className="flex h-6 items-center gap-1"
                >
                  {Array.from({ length: 9 }, (_, index) => (
                    <span
                      key={index}
                      className="h-6 w-1 rounded-full bg-current transition-[transform,opacity] duration-150 motion-reduce:transition-[opacity]"
                      style={{
                        transform: reduced
                          ? "scaleY(0.375)"
                          : `scaleY(${(4 + level * (8 + 12 * Math.sin(index * 1.7) ** 2)) / 24})`,
                        opacity: reduced ? 0.35 + level * 0.65 : undefined,
                      }}
                    />
                  ))}
                </span>
              </div>
            )}
            <div
              data-slot="home-recording-options-group"
              className={`flex min-w-0 max-w-full flex-wrap items-center gap-1.5 ${savingToHistory ? "" : "@max-[24rem]/home:order-3 @max-[24rem]/home:basis-full"}`}
            >
              <Popover.Root
                open={optionsOpen}
                onOpenChange={(value) => {
                  if (!switchingProfile) setOptionsOpen(value);
                }}
              >
                <Popover.Trigger
                  render={
                    <Button
                      ref={optionsTrigger}
                      variant="ghost"
                      className="relative h-auto min-h-10 min-w-10 max-w-full gap-0 text-muted-foreground @max-[12rem]/home:min-h-[44px] @max-[12rem]/home:min-w-[44px] @max-[12rem]/home:px-[8px] @min-[34rem]/home:gap-2"
                    />
                  }
                  aria-label={t("uiPolish.recordingOptions")}
                  title={
                    snapshot.profileModified
                      ? `${t("uiPolish.recordingOptions")} · ${t("dictationProfiles.modified")}`
                      : undefined
                  }
                  aria-expanded={optionsOpen}
                  aria-describedby="home-recording-context"
                  disabled={switchingProfile}
                >
                  <SlidersHorizontal
                    aria-hidden="true"
                    className="size-4 @min-[34rem]/home:hidden"
                  />
                  {snapshot.profileModified && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-2 right-2 size-1.5 rounded-full bg-primary @min-[34rem]/home:hidden"
                    />
                  )}
                  <span className="hidden min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 @min-[34rem]/home:flex">
                    <span>{t("uiPolish.recordingOptions")}</span>
                    {currentProfile && (
                      <span className="hidden max-w-36 truncate text-xs font-normal @min-[34rem]/home:inline">
                        · {currentProfile.name}
                      </span>
                    )}
                    {snapshot.profileModified && (
                      <span className="text-xs text-primary">
                        {t("dictationProfiles.modified")}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`hidden size-3.5 shrink-0 @min-[34rem]/home:block ${optionsOpen ? "rotate-180" : ""}`}
                  />
                </Popover.Trigger>
                <Popover.Portal keepMounted>
                  <Popover.Positioner
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    collisionAvoidance={{ side: "shift", align: "shift" }}
                    className="z-40"
                  >
                    <Popover.Popup
                      aria-label={t("uiPolish.recordingOptions")}
                      className="w-96 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] space-y-4 overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none motion-popup"
                    >
                      <div
                        id="home-recording-options"
                        role="region"
                        aria-label={t("uiPolish.recordingOptions")}
                        className="space-y-4 [overflow-wrap:anywhere]"
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("a")) setOptionsOpen(false);
                        }}
                      >
                        <div data-slot="home-recorder-profile">
                          <ProfileSelector
                            disabled={switchingModel || pending}
                            onPendingChange={setSwitchingProfile}
                            onReviewOpen={() => setOptionsOpen(false)}
                            reviewReturnFocusRef={optionsTrigger}
                            onReceipt={setProfileReceipt}
                          />
                        </div>
                        {(ready || snapshot.models.length > 0) && (
                          <div data-slot="home-recorder-options" className="space-y-4">
                            <div data-slot="home-recorder-model" className="space-y-2">
                              <p className="text-xs text-muted-foreground">
                                {t("common.speechModel")}
                              </p>
                              <Select
                                items={modelOptions}
                                value={selectedModel}
                                disabled={
                                  !isDesktop ||
                                  loading ||
                                  pending ||
                                  switchingModel ||
                                  switchingProfile ||
                                  isBusy(status.phase)
                                }
                                onValueChange={(value) => void selectModel(value)}
                              >
                                <SelectTrigger
                                  aria-label={t("common.speechModel")}
                                  className="min-h-9 w-full data-[size=default]:h-auto *:data-[slot=select-value]:line-clamp-none"
                                >
                                  <SelectValue
                                    placeholder={t("homePage.selectAModel")}
                                    className="min-w-0 whitespace-normal break-words"
                                  />
                                </SelectTrigger>
                                <SelectContent alignItemWithTrigger={false}>
                                  {modelOptions.map((model) => (
                                    <SelectItem key={model.value} value={model.value}>
                                      {model.label}
                                      {model.download && (
                                        <Download
                                          role="img"
                                          aria-label={t("homePage.downloadRequired")}
                                          className="size-3.5 text-muted-foreground"
                                        />
                                      )}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div data-slot="home-recorder-history" className="space-y-2">
                              <label
                                htmlFor="recorder-save-history"
                                className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-sm"
                              >
                                {t("homePage.saveToHistory")}
                                <Switch
                                  id="recorder-save-history"
                                  size="sm"
                                  checked={settings.saveHistory}
                                  disabled={
                                    !isDesktop ||
                                    loading ||
                                    historyPending ||
                                    status.phase === "backup"
                                  }
                                  aria-describedby="recorder-history-hint"
                                  onCheckedChange={async (enabled) => {
                                    setHistoryPending(true);
                                    try {
                                      await run(() => backend.setSaveHistory(enabled));
                                    } finally {
                                      setHistoryPending(false);
                                    }
                                  }}
                                />
                              </label>
                              <span id="recorder-history-hint" className="sr-only">
                                {isBusy(status.phase)
                                  ? t("homePage.changesApplyToYourNextDictation")
                                  : t("homePage.appliesToRecordingsAndAudioImports")}
                              </span>
                              {(recording || status.phase === "transcribing") && (
                                <p className="text-xs text-muted-foreground">
                                  {snapshot.recordingSaveHistory
                                    ? t("homePage.savingToHistory")
                                    : t("homePage.notSavingToHistory")}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="space-y-1 border-t pt-3 text-xs leading-5 text-muted-foreground">
                          <p>
                            {t("settingsPage.globalShortcut")}:{" "}
                            <kbd className="font-mono text-foreground">{settings.shortcut}</kbd>
                          </p>
                          <p>{t("homePage.useYourShortcutToDictateIntoAnother")}</p>
                        </div>
                      </div>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
              {!savingToHistory && (
                <span
                  role="status"
                  aria-label={t("homePage.notSavingToHistory")}
                  title={t("homePage.notSavingToHistory")}
                  className="inline-flex max-w-full items-center rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-xs font-normal text-muted-foreground"
                >
                  {t("uiPolish.historyOff")}
                </span>
              )}
            </div>
            <p role="status" className="sr-only">
              {profileReceipt}
            </p>
            <span id="home-recording-context" className="sr-only">
              {[
                currentProfile?.name,
                snapshot.profileModified ? t("dictationProfiles.modified") : "",
                activeModel?.name,
                settings.shortcut,
                savingToHistory ? t("homePage.saveToHistory") : t("homePage.notSavingToHistory"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <div
              data-slot="home-recorder-import"
              className="ml-auto min-w-0 max-w-full @max-[24rem]/home:[&_[data-slot=button]]:size-10 @max-[24rem]/home:[&_[data-slot=button]]:px-0 @max-[12rem]/home:[&_[data-slot=button]]:size-[44px]"
            >
              <AudioImportButton
                showDownloadProgress={false}
                quiet
                label={
                  <>
                    <span className="hidden @min-[34rem]/home:inline">
                      {t("audioImportButton.importAudio")}
                    </span>
                    <span className="@max-[24rem]/home:sr-only @min-[34rem]/home:hidden">
                      {t("uiPolish.importShort")}
                    </span>
                  </>
                }
              />
            </div>
            {(working || loading) && latestVisible && (
              <p role="status" className="basis-full text-sm text-muted-foreground">
                {loading ? t("homePage.connecting") : nativeText(status.message)}
              </p>
            )}
            {downloading && (
              <div className="flex w-full items-center gap-3">
                <Progress
                  aria-label={t("homePage.downloadProgress")}
                  value={downloadPercent}
                  className="min-w-0 flex-1"
                />
                <span className="text-xs tabular-nums">{downloadPercent}%</span>
                <Button variant="ghost" size="sm" onClick={() => void run(backend.cancel, false)}>
                  {t("homePage.cancelDownload")}
                </Button>
              </div>
            )}
          </div>
        </section>
        <div
          data-slot="home-workspace"
          data-home-embedded="true"
          className={`flex min-h-0 flex-col gap-3 ${latestVisible ? "flex-1" : ""}`}
        >
          <div className="home-reading-inset shrink-0 pt-3 empty:hidden">
            {(status.shortcutError ||
              status.profileShortcutError ||
              status.indicatorError ||
              status.trayError) && (
              <section
                aria-label={t("uiPolish.appStatus")}
                className="shrink-0 space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
              >
                <ShortcutStatus variant="notice" />
                {!status.shortcutError && <ShortcutStatus variant="notice" profile />}
                {(status.indicatorError || status.trayError) && (
                  <details
                    className={`text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere] ${status.shortcutError || status.profileShortcutError ? "border-t border-amber-500/20 pt-2" : ""}`}
                  >
                    <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span role="status">
                        {t(
                          status.shortcutError || status.profileShortcutError
                            ? "uiPolish.otherSystemNotices"
                            : "uiPolish.systemNotices",
                        )}{" "}
                        ({Number(!!status.indicatorError) + Number(!!status.trayError)})
                      </span>
                    </summary>
                    <div className="mt-1.5 space-y-1.5">
                      <p>{t("uiPolish.systemNoticesImpact")}</p>
                      <ul className="list-inside list-disc space-y-1">
                        {status.indicatorError && <li>{nativeText(status.indicatorError)}</li>}
                        {status.trayError && <li>{nativeText(status.trayError)}</li>}
                      </ul>
                      <Button
                        variant="ghost"
                        size="sm"
                        render={<Link to="/settings?section=advanced" />}
                      >
                        {t("uiPolish.openAdvancedSettings")}
                      </Button>
                    </div>
                  </details>
                )}
              </section>
            )}
          </div>
          <HomeResultPanel
            embedded
            fallbackFocus={resultFallback}
            onPresenceChange={setLatestVisible}
          />
          {!latestVisible && (
            <section className="flex min-h-56 shrink-0 flex-col items-center justify-center px-6 py-8 text-center">
              <Mic aria-hidden="true" className="mb-4 size-6 text-muted-foreground" />
              <h2
                aria-live="polite"
                aria-atomic="true"
                className="text-xl font-semibold tracking-tight"
              >
                {loading
                  ? t("homePage.connecting")
                  : recording
                    ? t("homePage.recording")
                    : working
                      ? nativeText(status.message)
                      : ready
                        ? t("homePage.readyToRecord")
                        : t("homePage.installASpeechModel")}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {loading
                  ? t("homePage.gettingYourDictationToolsReady")
                  : recording
                    ? t("homePage.speakNaturallyClickStopWhenYouRe")
                    : working
                      ? downloading
                        ? t("homePage.yourSpeechModelIsOnItsWay")
                        : t("homePage.youCanStartAnotherDictationWhenThis")
                      : ready
                        ? t("uiPolish.homeWorkspaceEmpty")
                        : t("homePage.chooseAModelToTurnYourVoice")}
              </p>
              {ready && !working && !recording && (
                <p className="mt-6 flex max-w-full flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Keyboard aria-hidden="true" className="size-4" />
                  <kbd className="rounded border bg-background px-2 py-1 font-mono text-foreground">
                    {settings.shortcut}
                  </kbd>
                  <span>{t("homePage.useYourShortcutToDictateIntoAnother")}</span>
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
