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
import { HashRouter, Route, Routes } from "react-router";

export function App() {
  return (
    <ThemeProvider>
      <Toaster />
      <DictationProvider>
        <HashRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="history/:id" element={<HistoryEntryPage />} />
              <Route path="models" element={<ModelsPage />} />
              <Route path="vocabulary" element={<VocabularyPage />} />
              <Route path="prompts" element={<PromptsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </DictationProvider>
    </ThemeProvider>
  );
}
