#!/usr/bin/env node
/**
 * CI Metrics Collector for DrawRace
 *
 * Collects metrics from various test outputs and pushes them to Prometheus pushgateway.
 * Metrics are defined in plan.md §Testing 14.
 *
 * Usage:
 *   node scripts/push-metrics.ts [--job=drawrace-ci] [--instance=<instance>]
 *
 * Environment variables:
 *   PUSHGATEWAY_URL - URL of Prometheus pushgateway (default: http://pushgateway:9091)
 *   CI_RUN_ID - Unique identifier for this CI run
 *   CI_BRANCH - Git branch being tested
 *   CI_MODE - CI mode: pr | nightly | release
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

interface Metric {
  name: string;
  value: number;
  labels: Record<string, string>;
  help?: string;
  type?: "gauge" | "counter";
}

class MetricsCollector {
  private metrics: Metric[] = [];
  private job: string;
  private instance: string;
  private pushgatewayUrl: string;

  constructor(job: string = "drawrace-ci", instance: string = "") {
    this.job = job;
    this.instance = instance || process.env.CI_RUN_ID || "unknown";
    this.pushgatewayUrl = process.env.PUSHGATEWAY_URL || "http://pushgateway:9091";
  }

  addGauge(name: string, value: number, labels: Record<string, string>, help?: string): void {
    this.metrics.push({ name, value, labels, help, type: "gauge" });
  }

  addCounter(name: string, value: number, labels: Record<string, string>, help?: string): void {
    this.metrics.push({ name, value, labels, help, type: "counter" });
  }

  private formatMetric(m: Metric): string {
    const labels = Object.entries(m.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    const labelStr = labels ? `{${labels}}` : "";

    const lines: string[] = [];

    if (m.help) {
      lines.push(`# HELP ${m.name} ${m.help}`);
    }
    if (m.type) {
      lines.push(`# TYPE ${m.name} ${m.type}`);
    }

    lines.push(`${m.name}${labelStr} ${m.value}`);

    return lines.join("\n");
  }

  getMetricsBody(): string {
    const baseLabels = {
      job: this.job,
      instance: this.instance,
      branch: process.env.CI_BRANCH || "unknown",
      mode: process.env.CI_MODE || "pr",
    };

    // Merge base labels into each metric
    return this.metrics
      .map((m) => ({
        ...m,
        labels: { ...baseLabels, ...m.labels },
      }))
      .map(this.formatMetric)
      .join("\n") + "\n";
  }

  async push(): Promise<void> {
    const body = this.getMetricsBody();
    const url = `${this.pushgatewayUrl}/metrics/job/${this.job}/instance/${this.instance}`;

    console.error(`Pushing metrics to ${url}...`);
    console.error(body);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`Push failed: ${response.status} ${response.statusText}`);
      }

      console.error(`Metrics pushed successfully`);
    } catch (error) {
      console.error(`Failed to push metrics: ${error}`);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Metric collection functions
// ---------------------------------------------------------------------------

/**
 * Collect code coverage from Vitest output.
 *
 * Vitest with --coverage produces a coverage-summary.json in the coverage directory.
 */
function collectCoverage(collector: MetricsCollector): void {
  const coveragePath = join(process.cwd(), "coverage", "coverage-summary.json");

  if (!existsSync(coveragePath)) {
    console.error("Coverage file not found, skipping coverage metrics");
    return;
  }

  try {
    const coverage = JSON.parse(readFileSync(coveragePath, "utf-8"));
    const total = coverage.total;

    collector.addGauge(
      "drawrace_coverage_lines",
      total.lines.pct,
      {},
      "Code coverage percentage for lines"
    );

    collector.addGauge(
      "drawrace_coverage_branches",
      total.branches.pct,
      {},
      "Code coverage percentage for branches"
    );

    collector.addGauge(
      "drawrace_coverage_functions",
      total.functions.pct,
      {},
      "Code coverage percentage for functions"
    );

    collector.addGauge(
      "drawrace_coverage_statements",
      total.statements.pct,
      {},
      "Code coverage percentage for statements"
    );

    console.error(`Collected coverage: ${total.lines.pct.toFixed(2)}% lines`);
  } catch (error) {
    console.error(`Failed to parse coverage: ${error}`);
  }
}

/**
 * Collect physics golden test results.
 *
 * The golden tests report max delta ticks and pass/fail status.
 */
function collectPhysicsGolden(collector: MetricsCollector): void {
  // The golden tests write a results JSON file if run with METRICS_OUTPUT
  const goldenResultsPath = join(process.cwd(), "golden-results.json");

  if (!existsSync(goldenResultsPath)) {
    console.error("Golden results file not found, skipping golden metrics");
    return;
  }

  try {
    const results = JSON.parse(readFileSync(goldenResultsPath, "utf-8"));

    collector.addGauge(
      "drawrace_physics_golden_max_delta_ticks",
      results.maxDeltaTicks || 0,
      {},
      "Maximum tick delta from golden file tests (must be 0 for bit-exact determinism)"
    );

    collector.addGauge(
      "drawrace_physics_golden_pass_rate",
      results.passRate || 0,
      {},
      "Pass rate for physics golden tests"
    );

    console.error(`Collected golden metrics: max delta ${results.maxDeltaTicks}, pass rate ${results.passRate}`);
  } catch (error) {
    console.error(`Failed to parse golden results: ${error}`);
  }
}

/**
 * Collect bundle size metrics from size-limit.
 */
function collectBundleSize(collector: MetricsCollector): void {
  // Run size-limit and parse output
  try {
    const output = execSync("npx size-limit --json", {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    const results = JSON.parse(output);

    for (const result of results) {
      const name = result.name.replace(/[^a-z0-9]/gi, "_");
      const sizeBytes = result.size || 0;

      collector.addGauge(
        `drawrace_bundle_size_bytes`,
        sizeBytes,
        { bundle: name },
        `Bundle size in bytes for ${name}`
      );

      if (result.gzip) {
        collector.addGauge(
          `drawrace_bundle_size_gzip_bytes`,
          result.gzip,
          { bundle: name },
          `Bundle size gzipped in bytes for ${name}`
        );
      }

      // Track against budget
      const limitBytes = result.limit || result.lengthLimit;
      if (limitBytes) {
        const overBudget = sizeBytes > limitBytes ? 1 : 0;
        collector.addGauge(
          `drawrace_bundle_over_budget`,
          overBudget,
          { bundle: name },
          `1 if bundle exceeds size limit, 0 otherwise`
        );
      }

      console.error(`Collected bundle size for ${name}: ${sizeBytes} bytes`);
    }
  } catch (error) {
    console.error(`Failed to collect bundle size: ${error}`);
  }
}

/**
 * Collect performance test results from Playwright annotations.
 *
 * The perf test writes results to perf-results.json.
 */
function collectPerfResults(collector: MetricsCollector): void {
  const perfResultsPath = join(process.cwd(), "perf-results.json");

  if (!existsSync(perfResultsPath)) {
    console.error("Perf results file not found, skipping perf metrics");
    return;
  }

  try {
    const results = JSON.parse(readFileSync(perfResultsPath, "utf-8"));

    collector.addGauge(
      "drawrace_perf_frame_median_ms",
      results.medianMs || 0,
      {},
      "Median frame time in milliseconds from performance test"
    );

    collector.addGauge(
      "drawrace_perf_frame_p95_ms",
      results.p95Ms || 0,
      {},
      "P95 frame time in milliseconds from performance test"
    );

    collector.addGauge(
      "drawrace_perf_frame_avg_ms",
      results.avgMs || 0,
      {},
      "Average frame time in milliseconds from performance test"
    );

    collector.addGauge(
      "drawrace_perf_total_frames",
      results.totalFrames || 0,
      {},
      "Total frames simulated in performance test"
    );

    console.error(`Collected perf metrics: p95 ${results.p95Ms}ms, median ${results.medianMs}ms`);
  } catch (error) {
    console.error(`Failed to parse perf results: ${error}`);
  }
}

/**
 * Collect CI stage duration from Argo workflow annotations.
 *
 * This is called from within the Argo workflow with stage timing info.
 */
function collectCIDuration(collector: MetricsCollector, stage: string, durationSeconds: number): void {
  collector.addGauge(
    "drawrace_ci_duration_seconds",
    durationSeconds,
    { stage },
    `CI stage duration in seconds for ${stage}`
  );
}

/**
 * Collect test flake rate metrics.
 *
 * Parse test results to detect retries and calculate flake rate.
 */
function collectFlakeRate(collector: MetricsCollector): void {
  const testResultsPath = join(process.cwd(), "test-results.json");

  if (!existsSync(testResultsPath)) {
    console.error("Test results file not found, skipping flake metrics");
    return;
  }

  try {
    const results = JSON.parse(readFileSync(testResultsPath, "utf-8"));

    let totalTests = 0;
    let flakyTests = 0;
    let failedTests = 0;

    for (const test of results.tests || []) {
      totalTests++;
      if (test.retries && test.retries > 0) {
        flakyTests++;
      }
      if (test.status === "failed") {
        failedTests++;
      }
    }

    const flakeRate = totalTests > 0 ? (flakyTests / totalTests) * 100 : 0;

    collector.addGauge(
      "drawrace_flake_rate",
      flakeRate,
      {},
      "Percentage of tests that required retries (flaky)"
    );

    collector.addGauge(
      "drawrace_test_fail_rate",
      totalTests > 0 ? (failedTests / totalTests) * 100 : 0,
      {},
      "Percentage of tests that failed"
    );

    console.error(`Collected flake metrics: ${flakeRate.toFixed(2)}% flaky, ${failedTests} failed`);
  } catch (error) {
    console.error(`Failed to parse test results: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let job = "drawrace-ci";
  let instance = "";
  let stage: string | undefined;
  let stageDuration: number | undefined;

  for (const arg of args) {
    if (arg.startsWith("--job=")) {
      job = arg.split("=")[1];
    } else if (arg.startsWith("--instance=")) {
      instance = arg.split("=")[1];
    } else if (arg.startsWith("--stage=")) {
      stage = arg.split("=")[1];
    } else if (arg.startsWith("--stage-duration=")) {
      stageDuration = parseFloat(arg.split("=")[1]);
    }
  }

  const collector = new MetricsCollector(job, instance);

  // Collect all available metrics
  collectCoverage(collector);
  collectPhysicsGolden(collector);
  collectBundleSize(collector);
  collectPerfResults(collector);
  collectFlakeRate(collector);

  // If stage timing is provided, add it
  if (stage && stageDuration !== undefined) {
    collectCIDuration(collector, stage, stageDuration);
  }

  // Push metrics to pushgateway
  await collector.push();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { MetricsCollector, collectCoverage, collectPhysicsGolden, collectBundleSize, collectPerfResults, collectFlakeRate, collectCIDuration };
