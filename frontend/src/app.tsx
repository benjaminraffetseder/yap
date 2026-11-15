import { AppLayout } from "@/components/layout/app-layout";
import { DictationProvider } from "@/features/dictation/components/dictation-provider";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { HistoryEntryPage } from "@/features/history/pages/history-entry-page";
import { HistoryPage } from "@/features/history/pages/history-page";
import { HomePage } from "@/features/home/pages/home-page";
import { ModelsPage } from "@/features/models/pages/models-page";
import { NotFoundPage } from "@/components/layout/not-found-page";
import { PromptsPage } from "@/features/prompts/pages/prompts-page";
import { SettingsPage } from "@/features/settings/pages/settings-page";
import { VocabularyPage } from "@/features/vocabulary/pages/vocabulary-page";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MotionConfig } from "motion/react";
import { DraftProvider } from "@/hooks/use-saved-draft";
import { useTranslation } from "react-i18next";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createQueryClient } from "@/lib/queries/resource-queries";

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
  return (
    <>
      <Routes location={settingsOpen ? background : location}>
        <Route element={<AppLayout saveNoticeRef={setAppSaveNoticeHost} />}>
          <Route index element={<HomePage />} />
          <Route path="history" element={<HistoryPage active={!settingsOpen} />} />
          <Route path="history/:id" element={<HistoryEntryPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="vocabulary" element={<VocabularyPage />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="*" element={<NotFoundPage />} />
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
              new URLSearchParams(location.search).has("focus")
                ? false
                : () => document.querySelector<HTMLInputElement>("[data-settings-search]")
            }
            backdropClassName="bg-black/80 backdrop-blur-[2px]"
            className="@container/settings-dialog h-[min(48rem,calc(100dvh-32px))] w-[min(64rem,calc(100vw-32px))] max-w-none gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-none @max-[42rem]/settings-dialog:[&>[data-slot=dialog-close]]:top-[8px] @max-[42rem]/settings-dialog:[&>[data-slot=dialog-close]]:right-[8px] @max-[42rem]/settings-dialog:[&>[data-slot=dialog-close]]:size-[44px]"
          >
            <SettingsPage
              beforeClose={beforeSettingsClose}
              saveNoticeRef={setSettingsSaveNoticeHost}
            />
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
