import { fileURLToPath, URL } from "node:url"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig(({ mode }) => ({
  base: "./",
  // The UI test server must not rewrite dependencies used by wails dev.
  cacheDir: mode === "ui-test" ? "node_modules/.vite-ui-test" : "node_modules/.vite",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@wails": fileURLToPath(new URL("./wailsjs", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1" },
}))
