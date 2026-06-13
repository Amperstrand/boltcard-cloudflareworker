import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "operator-ui.spec.ts",
    "virtual-card.spec.ts",
    "financial-flows.spec.ts",
    "hardware-lifecycle.spec.ts",
    "cardholder-selfservice.spec.ts",
    "identity-2fa.spec.ts",
    "nfc-ui.spec.ts",
  ],
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "https://boltcardpoc.psbt.me",
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
