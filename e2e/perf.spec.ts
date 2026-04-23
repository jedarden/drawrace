import { test, expect } from "@playwright/test";

const CPU_THROTTLE_RATE = 6;
const P95_BUDGET_MS = 20;
const MEDIAN_BUDGET_MS = 10;
const MIN_FRAMES = 300;

test.describe("Layer 7: Performance Budget Tests", () => {
  test("race frame times within budget at 6x CPU throttle", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });

    await page.goto("/perf-test.html");
    await page.waitForFunction(() => (window as any).__perfReady === true, { timeout: 60000 });

    const err = await page.evaluate(() => (window as any).__perfError);
    if (err) {
      throw new Error(`Perf test fixture failed: ${err}`);
    }

    const results = await page.evaluate(() => (window as any).__perfResults);

    expect(results.totalFrames, "should simulate at least 300 frames").toBeGreaterThanOrEqual(MIN_FRAMES);

    test.info().annotations.push(
      { type: "frames", description: String(results.totalFrames) },
      { type: "median_ms", description: String(results.medianMs.toFixed(2)) },
      { type: "p95_ms", description: String(results.p95Ms.toFixed(2)) },
      { type: "avg_ms", description: String(results.avgMs.toFixed(2)) },
    );

    expect(
      results.p95Ms,
      `p95 frame time ${results.p95Ms.toFixed(2)}ms exceeds ${P95_BUDGET_MS}ms budget at ${CPU_THROTTLE_RATE}x throttle`
    ).toBeLessThan(P95_BUDGET_MS);

    expect(
      results.medianMs,
      `median frame time ${results.medianMs.toFixed(2)}ms exceeds ${MEDIAN_BUDGET_MS}ms budget at ${CPU_THROTTLE_RATE}x throttle`
    ).toBeLessThan(MEDIAN_BUDGET_MS);
  });
});
