import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "operator-ui.spec.ts",
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "https://boltcardpoc.psbt.me",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
