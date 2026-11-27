import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.playwright/test-results",
  use: { baseURL: "http://127.0.0.1:5175", browserName: "chromium" },
  webServer: {
    // Avoid Node 26's Buffer.byteLength fast API abort during sustained Vite traffic.
    // https://github.com/nodejs/node/issues/66870
    command:
      "node --no-turbo-fast-api-calls node_modules/vite/bin/vite.js --mode ui-test --host 127.0.0.1 --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
  },
});
