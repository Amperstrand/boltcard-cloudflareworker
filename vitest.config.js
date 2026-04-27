import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    exclude: ["tests/do/**"],
  },
  resolve: {
    alias: {
      "cloudflare:workers": path.resolve(__dirname, "tests/cloudflare-workers-shim.js"),
    },
  },
});
