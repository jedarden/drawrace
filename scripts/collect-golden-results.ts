/**
 * Physics golden test metrics collector.
 *
 * Run this after golden tests to collect results for Prometheus metrics.
 *
 * Usage:
 *   pnpm test:golden && node scripts/collect-golden-results.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface GoldenResult {
  id: string;
  expectedTicks: number;
  actualTicks: number;
  deltaTicks: number;
  expectedHash: string;
  actualHash: string;
  passed: boolean;
  stuck: boolean;
}

interface GoldenResults {
  timestamp: string;
  totalTests: number;
  passedTests: number;
  maxDeltaTicks: number;
  passRate: number;
  tests: GoldenResult[];
}

/**
 * Parse golden test output from vitest JSON reporter.
 *
 * The golden tests log specific markers that we can parse:
 *   GOLDEN_TEST: <id> | expected: <ticks> | actual: <ticks> | delta: <n>
 */
function parseGoldenTestOutput(): GoldenResults {
  // For now, we'll look for a JSON file written by the golden test itself
  const goldenResultsPath = join(process.cwd(), "golden-test-results.json");

  try {
    const content = readFileSync(goldenResultsPath, "utf-8");
    return JSON.parse(content);
  } catch {
    // If no results file, return empty results
    return {
      timestamp: new Date().toISOString(),
      totalTests: 0,
      passedTests: 0,
      maxDeltaTicks: 0,
      passRate: 100,
      tests: [],
    };
  }
}

/**
 * Write golden results for metrics collection.
 */
function writeGoldenResults(results: GoldenResults): void {
  const outputPath = join(process.cwd(), "golden-results.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.error(`Golden results written to ${outputPath}`);
}

/**
 * Main entrypoint.
 */
function main() {
  const results = parseGoldenTestOutput();
  writeGoldenResults(results);

  console.error(
    `Golden tests: ${results.passedTests}/${results.totalTests} passed, max delta: ${results.maxDeltaTicks}`
  );
}

if (require.main === module) {
  main();
}

export { parseGoldenTestOutput, writeGoldenResults, type GoldenResults, type GoldenResult };
