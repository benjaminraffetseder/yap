import { nativeText } from "@/i18n/native-text";
import { useTranslation } from "react-i18next";
import { AudioDropImport } from "@/components/audio-drop-import";
import { CommandMenu } from "@/components/command-menu";
import { useDictation } from "@/components/dictation-provider";
import { ImportQueue } from "@/components/import-queue/import-queue";
import { RecordingStatus } from "@/components/recording-status";
import { RecoveryActions } from "@/components/recovery-actions";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { backend, backendVersionMismatchMessage, isDesktop } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Events } from "@wailsio/runtime";
import {
  AudioLines,
  BookOpen,
  HardDriveDownload,
  History,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";

const sidebarKey = "yap-sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(sidebarKey) === "true";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { t } = useTranslation();
  const navigation = [
    { to: "/", label: t("appLayout.dictate"), icon: Mic },
    { to: "/history", label: t("common.history"), icon: History },
    { to: "/models", label: t("modelsPage.models"), icon: HardDriveDownload },
    { to: "/vocabulary", label: t("common.vocabulary"), icon: BookOpen },
    { to: "/prompts", label: t("promptsPage.promptsChains"), icon: Sparkles },
    { to: "/settings", label: t("common.settings"), icon: Settings2 },
  ];

  const { snapshot, error, clearError, loading, run, refresh, update } = useDictation();
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissedUpdate, setDismissedUpdate] = useState("");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const sidebarWidth = collapsed ? "4.5rem" : "13.75rem";
  const [commandOpen, setCommandOpen] = useState(false);
  const toggleLabel = collapsed ? t("appLayout.expandSidebar") : t("appLayout.collapseSidebar");
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

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(sidebarKey, String(next));
    } catch {
      /* Use the current session preference. */
    }
  }

  return (
    <TooltipProvider delay={250}>
      <div
        className="group/layout flex min-h-screen"
        style={
          {
            "--sidebar-width": sidebarWidth,
          } as CSSProperties
        }
      >
        <aside
          id="app-sidebar"
          className="sticky top-0 flex h-screen w-[var(--sidebar-width)] shrink-0 flex-col border-r bg-sidebar px-3 py-4 transition-[width] duration-200 ease-out motion-reduce:transition-none"
        >
          <div className="mb-6 flex h-11 items-center justify-between">
            {!collapsed && (
              <NavLink
                to="/"
                className="flex items-center gap-2.5 pl-3"
                aria-label={t("appLayout.yapHome")}
              >
                <AudioLines className="size-5 text-primary" aria-hidden="true" />
                <span className="text-xl font-semibold tracking-tight">yap.</span>
              </NavLink>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-lg" />
                }
                onClick={toggleSidebar}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                aria-controls="app-sidebar"
              >
                {collapsed ? (
                  <PanelLeftOpen aria-hidden="true" />
                ) : (
                  <PanelLeftClose aria-hidden="true" />
                )}
              </TooltipTrigger>
              <TooltipContent side="right">{toggleLabel}</TooltipContent>
            </Tooltip>
          </div>
          <nav aria-label={t("appLayout.mainNavigation")} className="flex flex-1 flex-col gap-1">
            {navigation.map(({ to, label, icon: Icon }) => (
              <Tooltip key={`${to}-${collapsed}`} disabled={!collapsed}>
                <TooltipTrigger
                  render={<NavLink to={to} end={to !== "/history"} />}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary",
                    to === "/settings" && "mt-auto",
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ))}
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          <div className={homeSurface ? undefined : "mx-auto max-w-5xl px-6 py-8 lg:px-10"}>
            {showNotices && (
              <div className={homeSurface ? "mx-auto max-w-5xl px-6 pt-6 lg:px-10" : undefined}>
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
                      {t("appLayout.downloadTheInstallerQuitYapFromThe")}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="sm" onClick={() => void run(backend.downloadUpdate, false)}>
                        {t("appLayout.downloadUpdate")}
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
        <ImportQueue sidebarWidth={sidebarWidth} />
        <CommandMenu
          open={commandOpen}
          onOpenChange={setCommandOpen}
          collapsed={collapsed}
          toggleSidebar={toggleSidebar}
        />
        <AudioDropImport />
      </div>
    </TooltipProvider>
  );
}
