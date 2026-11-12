import { AppLayout } from "@/components/app-layout";
import { DictationProvider } from "@/components/dictation-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { HistoryEntryPage } from "@/pages/history-entry-page";
import { HistoryPage } from "@/pages/history-page";
import { HomePage } from "@/pages/home-page";
import { ModelsPage } from "@/pages/models-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { PromptsPage } from "@/pages/prompts-page";
import { SettingsPage } from "@/pages/settings-page";
import { VocabularyPage } from "@/pages/vocabulary-page";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { MotionConfig } from "motion/react";
import { DraftProvider } from "@/lib/use-saved-draft";
import { useTranslation } from "react-i18next";

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <DictationProvider>
          <DraftProvider>
            <HashRouter>
              <AppRoutes />
            </HashRouter>
          </DraftProvider>
        </DictationProvider>
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
