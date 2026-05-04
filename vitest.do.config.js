import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/do/**/*.test.{js,ts}"],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          OPERATOR_PIN: "1234",
          ISSUER_KEY: "00000000000000000000000000000000",
        },
      },
    }),
  ],
});
