import { HashRouter, Route, Routes } from "react-router"
import { AppLayout } from "@/components/app-layout"
import { ThemeProvider } from "@/components/theme-provider"
import { HomePage } from "@/pages/home-page"
import { SettingsPage } from "@/pages/settings-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { DictationProvider } from "@/components/dictation-provider"
import { HistoryPage } from "@/pages/history-page"
import { HistoryEntryPage } from "@/pages/history-entry-page"
import { ModelsPage } from "@/pages/models-page"
import { VocabularyPage } from "@/pages/vocabulary-page"
import { PromptsPage } from "@/pages/prompts-page"

export function App() {
  return (
    <ThemeProvider>
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
  )
}
