import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/integration/**/*.test.{js,ts}"],
    testTimeout: 30000,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          OPERATOR_PIN: "1234",
          OPERATOR_SESSION_SECRET: "test-integration-session-secret",
          ISSUER_KEY: "00000000000000000000000000000001",
        },
      },
    }),
  ],
});
