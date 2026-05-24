/**
 * Vitest reporter that writes test results to JSON for metrics collection.
 *
 * Add to vitest.config.ts:
 *   test: {
 *     reporters: ['./scripts/collect-test-results.ts']
 *   }
 */

import { writeFile } from "fs/promises";
import { join } from "path";

interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  retries: number;
  duration: number;
}

interface TestResults {
  timestamp: string;
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
  };
}

export default {
  name: "drawrace-test-results",

  async onFinished(files: any[]) {
    const tests: TestResult[] = [];
    let flakyCount = 0;

    for (const file of files) {
      for (const test of file.tests || []) {
        const retries = test.retryCount || test.retries || 0;
        if (retries > 0) {
          flakyCount++;
        }

        tests.push({
          name: `${file.name} > ${test.name}`,
          status: test.result?.state || test.status || "unknown",
          retries,
          duration: test.result?.duration || test.duration || 0,
        });
      }
    }

    const summary = {
      total: tests.length,
      passed: tests.filter((t) => t.status === "passed").length,
      failed: tests.filter((t) => t.status === "failed").length,
      skipped: tests.filter((t) => t.status === "skipped").length,
      flaky: flakyCount,
    };

    const results: TestResults = {
      timestamp: new Date().toISOString(),
      tests,
      summary,
    };

    const outputPath = join(process.cwd(), "test-results.json");
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    console.error(`Test results written to ${outputPath}`);
  },
};
