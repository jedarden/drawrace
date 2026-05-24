import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    testTimeout: 60_000,
    setupFiles: ["./apps/web/src/test-setup.ts"],
    reporters: process.env.CI ? ["default", "./scripts/collect-test-results.ts"] : ["default"],
  },
});
