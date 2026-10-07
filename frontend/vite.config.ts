import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => ({
  base: "./",
  // The UI test server must not rewrite dependencies used by wails dev.
  cacheDir: mode === "ui-test" ? "node_modules/.vite-ui-test" : "node_modules/.vite",
  plugins: [react(), tailwindcss()],
  // Match Tailwind 4's supported engines and the macOS 13.3 WebKit minimum.
  build: { target: ["safari16.4", "chrome111", "firefox128"], cssTarget: ["safari16.4", "chrome111", "firefox128"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@wails": fileURLToPath(new URL("./wailsjs", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1" },
}))
