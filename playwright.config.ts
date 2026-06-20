import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "https://boltcardpoc.psbt.me";
const isLocal = baseURL.includes("127.0.0.1") || baseURL.includes("localhost");

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
    "hardware-financial.spec.ts",
    "hardware-selfservice.spec.ts",
    "user-stories.spec.ts",
  ],
  fullyParallel: false,
  retries: isLocal ? 1 : 2,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL,
    headless: true,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  ...(isLocal
    ? {
        webServer: {
          command: "npx wrangler dev --ip 127.0.0.1 --port 8787 --show-interactive-dev-session false",
          url: "http://127.0.0.1:8787/status",
          reuseExistingServer: true,
          timeout: 30000,
        },
      }
    : {}),
});
