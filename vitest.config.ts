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
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.config.ts",
        "**/dist/**",
        "**/node_modules/**",
        "**/scripts/**",
      ],
    },
  },
});
