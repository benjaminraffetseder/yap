import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  // Keep UI tests and the desktop development server in separate caches.
  cacheDir: mode === "ui-test" ? "node_modules/.vite-ui-test" : "node_modules/.vite",
  // The isolated motion fixture imports this outside the app's entry graph.
  // Discover it up front so a cold test cache cannot reload a mounted fixture.
  optimizeDeps: mode === "ui-test" ? { include: ["@base-ui/react/accordion"] } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === "ui-test"
      ? [
          {
            name: "yap-test-transport",
            transformIndexHtml() {
              return [
                {
                  tag: "script",
                  attrs: { type: "module", src: "/tests/wails-mock.ts" },
                  injectTo: "head" as const,
                },
              ];
            },
          },
        ]
      : []),
  ],
  // Match Tailwind 4's supported engines and the macOS 13.3 WebKit minimum.
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        indicator: fileURLToPath(new URL("./indicator.html", import.meta.url)),
      },
    },
    target: ["safari16.4", "chrome111", "firefox128"],
    cssTarget: ["safari16.4", "chrome111", "firefox128"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@bindings": fileURLToPath(new URL("./bindings", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", strictPort: true },
}));
