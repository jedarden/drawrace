#!/usr/bin/env node
/**
 * Generate baseline snapshot images for Layer 3 rendering tests.
 *
 * This script should be run in the pinned CI container:
 *   docker run --rm -v $(pwd):/work -w /work ghcr.io/drawrace/ci-snap:2026-04-21 \
 *     sh -c "pnpm install && npx tsx scripts/gen-baselines.ts"
 *
 * Or use: just snap-update
 */

import { chromium } from "@playwright/test";
import { writeFileSync } from "fs";
import { join } from "path";

const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;
const SNAPSHOT_TICKS = [0, 30, 120, 300] as const;
const BASELINE_DIR = join(process.cwd(), "apps", "web", "e2e", "__snapshots__");

async function generateBaselines() {
  console.log("Starting browser...");
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    reducedMotion: "reduce",
  });

  const page = await context.newPage();

  // Start the dev server (we'll use a simple file server approach)
  // For CI, the webServer in playwright.config handles this

  console.log("Navigating to snapshot fixture...");
  await page.goto("http://localhost:5173/snapshot-fixture.html?snapshotMode=1");

  // Wait for the snapshot driver to be available
  await page.waitForFunction(() => typeof window.snapshotDriver !== "undefined", { timeout: 10000 });

  console.log("Generating baselines for ticks:", SNAPSHOT_TICKS);

  for (const tick of SNAPSHOT_TICKS) {
    console.log(`  Generating baseline for tick ${tick}...`);

    // Jump to the specific tick
    await page.evaluate(({ tick }) => {
      window.snapshotDriver.gotoTick(tick);
    }, { tick });

    // Wait for render to complete
    await page.waitForTimeout(50);

    // Get canvas and screenshot
    const canvas = page.locator("#gameCanvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas not found");

    // Screenshot the canvas only
    const screenshot = await page.screenshot({
      clip: box,
      animations: "disabled",
    });

    // Write baseline
    const baselinePath = join(BASELINE_DIR, `tick-${tick}.png`);
    writeFileSync(baselinePath, screenshot);
    console.log(`    Written: ${baselinePath}`);
  }

  await browser.close();
  console.log("Done!");
}

generateBaselines().catch((err) => {
  console.error("Failed to generate baselines:", err);
  process.exit(1);
});
