import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.playwright/test-results",
  use: { baseURL: "http://127.0.0.1:5175", browserName: "chromium" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
  },
})
