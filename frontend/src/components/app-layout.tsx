import appIcon from "@/assets/app-icon.svg";
import { AudioDropImport } from "@/components/audio-drop-import";
import { CommandMenu } from "@/components/command-menu";
import { useDictation } from "@/components/dictation-provider";
import { ProcessingPanel, ProcessingPanelToggle } from "@/components/processing-panel";
import { RecordingStatus } from "@/components/recording-status";
import { RecoveryActions } from "@/components/recovery-actions";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { nativeText } from "@/i18n/native-text";
import { backendVersionMismatchMessage, isDesktop } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Events } from "@wailsio/runtime";
import { BookOpen, HardDriveDownload, History, Mic, Settings2, Sparkles } from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

export function AppLayout({ saveNoticeRef }: { saveNoticeRef?: Ref<HTMLDivElement> }) {
  const { t } = useTranslation();
  const navigation = [
    { to: "/", label: t("appLayout.dictate"), icon: Mic },
    { to: "/history", label: t("common.history"), icon: History },
    { to: "/models", label: t("modelsPage.models"), icon: HardDriveDownload },
    { to: "/vocabulary", label: t("common.vocabulary"), icon: BookOpen },
    {
      to: "/prompts",
      label: t("promptsPage.promptsChains"),
      shortLabel: t("promptsPage.prompts"),
      icon: Sparkles,
    },
    { to: "/settings", label: t("common.settings"), icon: Settings2 },
  ];

  const {
    snapshot,
    error,
    clearError,
    loading,
    run,
    refresh,
    update,
    updateError,
    checkingUpdates,
    installingUpdate,
    installUpdate,
  } = useDictation();
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissedUpdate, setDismissedUpdate] = useState("");
  const sidebarWidth = "clamp(56px, 10vw, 5.75rem)";
  const sidebar = useRef<HTMLElement>(null);
  const [compactNavigation, setCompactNavigation] = useState(false);
  useLayoutEffect(() => {
    const rail = sidebar.current;
    if (!rail) return;
    const measure = () => {
      const fullWidth = parseFloat(getComputedStyle(document.documentElement).fontSize) * 5.75;
      setCompactNavigation(rail.getBoundingClientRect().width < fullWidth - 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  const [commandOpen, setCommandOpen] = useState(false);
  const connectionFailure = !!error && (loading || error === backendVersionMismatchMessage);
  const homeSurface =
    location.pathname === "/" &&
    (!isDesktop || snapshot.settings.setupComplete) &&
    !loading &&
    !connectionFailure;
  const showUpdate = update?.available && dismissedUpdate !== update.latestVersion;
  const showNotices = !isDesktop || connectionFailure || loading || showUpdate;
  useEffect(() => {
    const showResult = () => navigate("/");
    window.addEventListener("yap:show-result", showResult);
    const off = isDesktop
      ? Events.On("desktop:navigate", ({ data }: { data: unknown }) => {
          if (
            typeof data === "string" &&
            [
              "/",
              "/history",
              "/settings",
              "/settings?section=dictation&focus=shortcut",
              "/settings?section=dictation&focus=profile-cycle-shortcut",
            ].includes(data)
          )
            navigate(data);
        })
      : () => {};
    return () => {
      off();
      window.removeEventListener("yap:show-result", showResult);
    };
  }, [navigate]);
  useEffect(() => {
    if (!error || connectionFailure) return;
    toastManager.add({
      id: "app-error",
      type: "error",
      title: nativeText(error),
      priority: "high",
      timeout: 8000,
    });
    clearError();
  }, [error, connectionFailure, clearError]);

  return (
    <TooltipProvider delay={250}>
      <div
        className={cn(
          "group/layout flex lg:has-[[data-chat-open]]:h-dvh lg:has-[[data-chat-open]]:overflow-hidden",
          homeSurface ? "h-dvh overflow-hidden" : "min-h-screen",
        )}
        style={
          {
            "--sidebar-width": sidebarWidth,
          } as CSSProperties
        }
      >
        <aside
          ref={sidebar}
          id="app-sidebar"
          data-compact-navigation={compactNavigation || undefined}
          className={cn(
            "sticky top-0 flex h-screen w-[var(--sidebar-width)] shrink-0 flex-col overflow-y-auto border-r bg-sidebar",
            compactNavigation ? "px-[4px] py-[12px]" : "px-2 py-4",
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-center",
              compactNavigation ? "mb-[12px] h-[44px]" : "mb-4 h-11",
            )}
          >
            <Link
              to="/"
              className={cn(
                "flex items-center justify-center rounded-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                compactNavigation ? "size-[44px]" : "size-11",
              )}
              aria-label={t("appLayout.yapHome")}
            >
              <img
                src={appIcon}
                className="size-8"
                width={32}
                height={32}
                alt=""
                aria-hidden="true"
              />
            </Link>
          </div>
          <nav aria-label={t("appLayout.mainNavigation")} className="flex flex-1 flex-col gap-1">
            {navigation.map(({ to, label, shortLabel, icon: Icon }) => (
              <Fragment key={to}>
                {to === "/settings" && (
                  <div className="mt-auto">
                    <ProcessingPanelToggle compact={compactNavigation} />
                  </div>
                )}
                <Tooltip disabled={!compactNavigation}>
                  <TooltipTrigger
                    render={
                      <NavLink
                        to={to}
                        end={to !== "/history"}
                        aria-label={label}
                        className={cn(
                          "flex shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary",
                          compactNavigation ? "h-[44px] px-0" : "h-14 px-1",
                        )}
                      />
                    }
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span
                      className={cn("max-w-full text-xs leading-5", compactNavigation && "sr-only")}
                    >
                      {shortLabel ?? label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              </Fragment>
            ))}
          </nav>
        </aside>
        <main
          id="main-content"
          className={cn(
            "min-w-0 flex-1 lg:has-[[data-chat-open]]:flex lg:has-[[data-chat-open]]:min-h-0 lg:has-[[data-chat-open]]:flex-col",
            homeSurface && "flex min-h-0 flex-col",
          )}
        >
          <div
            className={
              homeSurface
                ? "flex min-h-0 flex-1 flex-col"
                : "mx-auto max-w-5xl px-[clamp(1rem,4vw,1.5rem)] py-8 lg:px-[clamp(1rem,4vw,2.5rem)] lg:has-[[data-chat-open]]:mx-0 lg:has-[[data-chat-open]]:flex lg:has-[[data-chat-open]]:min-h-0 lg:has-[[data-chat-open]]:max-w-none lg:has-[[data-chat-open]]:flex-1 lg:has-[[data-chat-open]]:flex-col"
            }
          >
            <div
              ref={saveNoticeRef}
              data-slot="app-save-notice-host"
              className="shrink-0 empty:hidden"
            />
            {showNotices && (
              <div
                className={
                  homeSurface
                    ? "mx-auto max-h-[40vh] w-full max-w-5xl shrink-0 overflow-y-auto px-6 pt-4 lg:px-10"
                    : undefined
                }
              >
                {!isDesktop && (
                  <div className="mb-6 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    {t("appLayout.browserPreviewNativeFeaturesRequireTheDesktop")}
                  </div>
                )}
                {connectionFailure && (
                  <section
                    aria-label={t("appLayout.connectionRecovery")}
                    className="mb-6 space-y-4 rounded-lg border border-destructive/30 bg-card p-4"
                  >
                    <div className="space-y-2">
                      <h2 className="text-sm font-semibold">
                        {t("appLayout.couldnTConnectToYap")}
                      </h2>
                      <p role="alert" className="text-sm text-destructive">
                        {nativeText(error)}
                      </p>
                    </div>
                    <RecoveryActions
                      source={t("appLayout.backendConnection")}
                      details={error}
                      retryLabel={t("appLayout.retryLoading")}
                      onRetry={() => void run(refresh, false)}
                    />
                  </section>
                )}
                {isDesktop && loading && !connectionFailure && (
                  <div
                    role="status"
                    className="mt-6 flex items-center gap-3 text-sm text-muted-foreground"
                  >
                    <span>{t("appLayout.loadingApp")}</span>
                    <Button variant="outline" size="sm" onClick={() => void run(refresh, false)}>
                      {t("appLayout.retryLoading")}
                    </Button>
                  </div>
                )}
                {showUpdate && update && (
                  <section
                    aria-label={t("appLayout.appUpdateAvailable")}
                    className="mb-6 space-y-3 rounded-lg border bg-card p-4"
                  >
                    <p className="text-sm font-medium">
                      Yap {update.latestVersion} {t("appLayout.isAvailable")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("appLayout.installUpdateInstructions")}
                    </p>
                    {updateError && (
                      <p role="alert" className="text-sm text-destructive">
                        {updateError}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        size="sm"
                        disabled={checkingUpdates || installingUpdate}
                        onClick={() => void installUpdate()}
                      >
                        {t(
                          installingUpdate
                            ? "updatePanel.installing"
                            : update.ready
                              ? "appLayout.restartUpdate"
                              : "appLayout.installUpdate",
                        )}
                      </Button>
                      <Link
                        to="/settings?section=general"
                        className="text-sm text-primary underline underline-offset-4"
                      >
                        {t("appLayout.updateDetails")}
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDismissedUpdate(update.latestVersion)}
                      >
                        {t("appLayout.later")}
                      </Button>
                    </div>
                  </section>
                )}
              </div>
            )}
            <Outlet />
          </div>
        </main>
        <RecordingStatus />
        <ProcessingPanel />
        <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
        <AudioDropImport />
      </div>
    </TooltipProvider>
  );
}
