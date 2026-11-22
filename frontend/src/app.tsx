import { AppLayout } from "@/components/layout/app-layout";
import { RecoveryActions } from "@/components/shared/recovery-actions";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toast";
import { DictationProvider } from "@/features/dictation/components/dictation-provider";
import { useDictationConnection } from "@/features/dictation/hooks/use-dictation-state";
import { HomePage } from "@/features/home/pages/home-page";
import { DraftProvider } from "@/hooks/use-saved-draft";
import i18n from "@/i18n";
import { isDesktop } from "@/lib/backend";
import { createQueryClient } from "@/lib/queries/resource-queries";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { MotionConfig } from "motion/react";
import {
  Component,
  Suspense,
  createElement,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router";

function lazyExport<Props extends object, K extends string>(
  load: () => Promise<Record<K, ComponentType<Props>>>,
  name: K,
): ComponentType<Props> {
  const Component = lazy(async () => {
    try {
      const module = await load();
      const exported: ComponentType<Props> = module[name];
      return { default: exported };
    } catch (cause) {
      throw new LazyModuleLoadError(cause);
    }
  });
  return function LazyRoute(props: Props) {
    return createElement(Component, props);
  };
}

class LazyModuleLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "LazyModuleLoadError";
    if (cause instanceof Error && cause.stack) this.stack = cause.stack;
  }
}

const HistoryPage = lazyExport(
  () => import("@/features/history/pages/history-page"),
  "HistoryPage",
);
const HistoryEntryPage = lazyExport(
  () => import("@/features/history/pages/history-entry-page"),
  "HistoryEntryPage",
);
const ModelsPage = lazyExport(() => import("@/features/models/pages/models-page"), "ModelsPage");
const VocabularyPage = lazyExport(
  () => import("@/features/vocabulary/pages/vocabulary-page"),
  "VocabularyPage",
);
const PromptsPage = lazyExport(
  () => import("@/features/prompts/pages/prompts-page"),
  "PromptsPage",
);
const NotFoundPage = lazyExport(() => import("@/components/layout/not-found-page"), "NotFoundPage");
const SettingsPage = lazyExport(
  () => import("@/features/settings/pages/settings-page"),
  "SettingsPage",
);

function LazyFallback({ dialog = false }: { dialog?: boolean }) {
  const { t } = useTranslation();
  const { loading } = useDictationConnection();
  if (!dialog && isDesktop && loading) return null;
  return (
    <div
      role="status"
      data-slot="route-loading"
      className={
        dialog
          ? "flex h-full min-h-40 items-center justify-center p-6 text-sm text-muted-foreground"
          : "mt-6 flex items-center gap-3 text-sm text-muted-foreground"
      }
    >
      <span>{t("appLayout.loadingApp")}</span>
    </div>
  );
}

type LazyFailure = { message: string; stack: string; moduleLoad: boolean };
type LazyBoundaryState = { failure: LazyFailure | null; componentStack: string };

class LazyBoundary extends Component<
  { resetKey: string; dialog?: boolean; children: ReactNode },
  LazyBoundaryState
> {
  state: LazyBoundaryState = { failure: null, componentStack: "" };
  static getDerivedStateFromError(cause: unknown): LazyBoundaryState {
    const error =
      cause instanceof Error
        ? cause
        : new Error(typeof cause === "string" ? cause : i18n.t("errorBoundary.unknown"));
    return {
      failure: {
        message: error.message,
        stack: error.stack ?? "",
        moduleLoad: cause instanceof LazyModuleLoadError,
      },
      componentStack: "",
    };
  }
  componentDidCatch(_cause: unknown, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (this.state.failure && previous.resetKey !== this.props.resetKey) {
      this.setState({ failure: null, componentStack: "" });
    }
  }
  render() {
    const { failure, componentStack } = this.state;
    const { dialog = false, children } = this.props;
    if (failure) {
      return (
        <div
          className={
            dialog
              ? "flex h-full min-h-0 items-center justify-center overflow-y-auto p-6 text-foreground"
              : "py-6 text-foreground"
          }
        >
          <section
            aria-labelledby="lazy-recovery-title"
            className="w-full max-w-xl space-y-5 rounded-xl border bg-card p-6"
          >
            <div className="space-y-2">
              <h1 id="lazy-recovery-title" className="text-xl font-semibold">
                {i18n.t("errorBoundary.title")}
              </h1>
              <p role="alert" className="text-sm text-muted-foreground">
                {i18n.t("errorBoundary.description")}
              </p>
              <p className="text-sm text-muted-foreground">{i18n.t("errorBoundary.hint")}</p>
            </div>
            <RecoveryActions
              source={i18n.t("errorBoundary.source")}
              details={[failure.stack || failure.message, componentStack]
                .filter(Boolean)
                .join("\n\n")}
              // Browsers cache failed module fetches. Retrying the same import
              // cannot recover it; the explicit Reload action starts a new graph.
              onRetry={
                failure.moduleLoad
                  ? undefined
                  : () => this.setState({ failure: null, componentStack: "" })
              }
            />
          </section>
        </div>
      );
    }
    return <Suspense fallback={<LazyFallback dialog={dialog} />}>{children}</Suspense>;
  }
}

function LazySettingsSurface({
  focusTarget,
  beforeClose,
  saveNoticeRef,
}: {
  focusTarget: boolean;
  beforeClose: RefObject<(() => Promise<boolean>) | null>;
  saveNoticeRef: (node: HTMLDivElement | null) => void;
}) {
  const initialFocusHandled = useRef(false);
  useLayoutEffect(() => {
    if (initialFocusHandled.current) return;
    initialFocusHandled.current = true;
    if (focusTarget) return;
    const search = document.querySelector<HTMLInputElement>("[data-settings-search]");
    // The dialog may have focused its close button while this chunk loaded.
    // Restore the same initial search focus as an eagerly mounted Settings page.
    search?.focus({ preventScroll: true });
  }, [focusTarget]);
  return <SettingsPage beforeClose={beforeClose} saveNoticeRef={saveNoticeRef} />;
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <DictationProvider>
            <DraftProvider>
              <HashRouter>
                <AppRoutes />
              </HashRouter>
            </DraftProvider>
          </DictationProvider>
          {import.meta.env.DEV && import.meta.env.MODE !== "ui-test" && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </QueryClientProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

function AppRoutes() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen = location.pathname === "/settings";
  const settingsFocusTarget = new URLSearchParams(location.search).has("focus");
  const [appSaveNoticeHost, setAppSaveNoticeHost] = useState<HTMLDivElement | null>(null);
  const [settingsSaveNoticeHost, setSettingsSaveNoticeHost] = useState<HTMLDivElement | null>(null);
  const beforeSettingsClose = useRef<(() => Promise<boolean>) | null>(null);
  const closingSettings = useRef(false);
  const [background, setBackground] = useState(() =>
    settingsOpen ? { ...location, pathname: "/", search: "", hash: "" } : location,
  );
  useEffect(() => {
    if (!settingsOpen) setBackground(location);
  }, [location, settingsOpen]);
  async function closeSettings() {
    if (closingSettings.current) return;
    closingSettings.current = true;
    try {
      if (beforeSettingsClose.current && !(await beforeSettingsClose.current())) return;
      navigate(
        { pathname: background.pathname, search: background.search, hash: background.hash },
        { replace: true, state: background.state },
      );
    } finally {
      closingSettings.current = false;
    }
  }
  const activeRoute = settingsOpen ? background : location;
  return (
    <>
      <Routes location={activeRoute}>
        <Route element={<AppLayout saveNoticeRef={setAppSaveNoticeHost} />}>
          <Route index element={<HomePage />} />
          <Route
            path="history"
            element={
              <LazyBoundary resetKey={activeRoute.pathname}>
                <HistoryPage active={!settingsOpen} />
              </LazyBoundary>
            }
          />
          <Route
            path="history/:id"
            element={
              <LazyBoundary resetKey={activeRoute.pathname}>
                <HistoryEntryPage />
              </LazyBoundary>
            }
          />
          <Route
            path="models"
            element={
              <LazyBoundary resetKey={activeRoute.pathname}>
                <ModelsPage />
              </LazyBoundary>
            }
          />
          <Route
            path="vocabulary"
            element={
              <LazyBoundary resetKey={activeRoute.pathname}>
                <VocabularyPage />
              </LazyBoundary>
            }
          />
          <Route
            path="prompts"
            element={
              <LazyBoundary resetKey={activeRoute.pathname}>
                <PromptsPage />
              </LazyBoundary>
            }
          />
          <Route
            path="*"
            element={
              <LazyBoundary resetKey={activeRoute.pathname}>
                <NotFoundPage />
              </LazyBoundary>
            }
          />
        </Route>
      </Routes>
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) void closeSettings();
        }}
      >
        {settingsOpen && (
          <DialogContent
            aria-label={t("common.settings")}
            initialFocus={
              settingsFocusTarget
                ? false
                : () => document.querySelector<HTMLInputElement>("[data-settings-search]")
            }
            backdropClassName="bg-black/80 backdrop-blur-[2px]"
            className="@container/settings-dialog h-[min(48rem,calc(100dvh-32px))] w-[min(64rem,calc(100vw-32px))] max-w-none gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none @max-[42rem]/settings-dialog:[&>[data-slot=dialog-close]]:top-[8px] @max-[42rem]/settings-dialog:[&>[data-slot=dialog-close]]:right-[8px] @max-[42rem]/settings-dialog:[&>[data-slot=dialog-close]]:size-[44px]"
          >
            <LazyBoundary dialog resetKey={location.key}>
              <LazySettingsSurface
                focusTarget={settingsFocusTarget}
                beforeClose={beforeSettingsClose}
                saveNoticeRef={setSettingsSaveNoticeHost}
              />
            </LazyBoundary>
          </DialogContent>
        )}
      </Dialog>
      <Toaster
        saveNoticeHost={settingsOpen ? settingsSaveNoticeHost : appSaveNoticeHost}
        settingsOpen={settingsOpen}
      />
    </>
  );
}
