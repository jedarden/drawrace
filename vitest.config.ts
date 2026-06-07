import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    testTimeout: 60_000,
    teardownTimeout: 5_000,
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
    setupFiles: ["./apps/web/src/test-setup.ts"],
    reporters: process.env.CI ? ["default", "./scripts/collect-test-results.ts"] : ["default"],
  },
});
