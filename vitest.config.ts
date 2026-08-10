import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    testTimeout: process.env.CI ? 600_000 : 300_000, // 10 minutes in CI, 5 minutes locally - covers long physics sims (canyon02-sim: 600s, hills01-sim: 180s, golden: 120s)
    teardownTimeout: 30_000, // Increased from 5s to 30s for cleaner cleanup of heavy sims
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,
        singleFork: false, // Run tests in parallel (default) for faster overall execution
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
    // Increase Vitest's internal timeout for worker communication
    // This prevents "[vitest-worker]: Timeout calling 'onTaskUpdate'" errors
    // when running long-running physics simulations
    hookTimeout: 300_000, // 5 minutes for test hooks (beforeAll, afterAll, etc.)
    workerTimeout: 300_000, // 5 minutes for worker communication timeout (onTaskUpdate)
  },
});
