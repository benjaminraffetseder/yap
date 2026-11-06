import { SetIndicatorTheme } from "@bindings/yap/app";
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";
type ThemeContextValue = { theme: Theme; setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const storageKey = "desktop-theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage may be unavailable in a restricted webview.
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(readTheme);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    let firstFrame = 0;
    let secondFrame = 0;
    const apply = async () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      root.dataset.themeSwitching = "";
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
      // Commit both text and surfaces together; avoid interpolating through
      // low-contrast color combinations while switching themes.
      void root.offsetWidth;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          delete root.dataset.themeSwitching;
        });
      });
      try {
        await SetIndicatorTheme(dark);
      } catch {
        // Browser previews do not have a native indicator.
      }
    };
    void apply();
    media.addEventListener("change", apply);
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      delete root.dataset.themeSwitching;
      media.removeEventListener("change", apply);
    };
  }, [theme]);

  function setTheme(value: Theme) {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* Keep in-memory preference. */
    }
    updateTheme(value);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
