import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };

export const languages = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
] as const;

export const languageStorageKey = "desktop-language";

function supportedLanguage(value: string | null | undefined) {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return languages.find(({ code }) => code === base)?.code;
}

function initialLanguage() {
  if (typeof window === "undefined") return "en";
  try {
    const saved = supportedLanguage(localStorage.getItem(languageStorageKey));
    if (saved) return saved;
  } catch {
    // Restricted webviews may disable storage; switching still works in memory.
  }
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const language = supportedLanguage(candidate);
    if (language) return language;
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: initialLanguage(),
  supportedLngs: languages.map(({ code }) => code),
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
});

function updateDocument() {
  if (typeof document === "undefined") return;
  const language = i18n.resolvedLanguage ?? "en";
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
}

updateDocument();
i18n.on("languageChanged", () => {
  updateDocument();
  try {
    localStorage.setItem(languageStorageKey, i18n.resolvedLanguage ?? "en");
  } catch {
    // Keep the preference for this window when storage is unavailable.
  }
});

// The recording indicator uses its own webview and shares this preference.
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key !== languageStorageKey) return;
    const language = supportedLanguage(event.newValue) ?? initialLanguage();
    if (language !== i18n.resolvedLanguage) void i18n.changeLanguage(language);
  });

export default i18n;
