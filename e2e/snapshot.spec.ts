import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SNAPSHOTS_DIR = join(__dirname, "snapshots");
const TOLERANCE = 0.04;
const MAX_DIFF_AREA = 300;
const CANVAS_WIDTH = 390;
const CANVAS_HEIGHT = 720;

const UPDATE = !!process.env.SNAPSHOT_UPDATE;

test.describe("Layer 3: Rendering Snapshot Tests", () => {
  test.beforeEach(async ({ page }) => {
    // Enforce reduced motion for deterministic output (disables confetti, parallax, etc.)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto("/snapshot-test.html");
    await page.waitForFunction(() => (window as any).__drawraceReady === true, { timeout: 15000 });

    const err = await page.evaluate(() => (window as any).__drawraceError);
    if (err) {
      throw new Error(`Snapshot fixture failed to initialize: ${err}`);
    }
  });

  for (const checkpoint of ["0", "30", "120", "300", "finish"]) {
    test(`matches baseline at tick ${checkpoint}`, async ({ page }) => {
      const rendered = await page.evaluate((cp) => {
        return (window as any).__drawrace.renderCheckpoint(cp === "finish" ? "finish" : Number(cp));
      }, checkpoint);
      expect(rendered).toBe(true);

      await page.waitForTimeout(50);

      const canvas = page.locator("#test-canvas");
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();

      const screenshot = await page.screenshot({
        clip: { x: box!.x, y: box!.y, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
        animations: "disabled",
      });

      const baselinePath = join(SNAPSHOTS_DIR, `tick-${checkpoint}.png`);

      if (UPDATE || !existsSync(baselinePath)) {
        mkdirSync(SNAPSHOTS_DIR, { recursive: true });
        writeFileSync(baselinePath, screenshot);
        test.info().annotations.push({ type: "snapshot", description: "baseline written" });
        return;
      }

      const baseline = PNG.sync.read(readFileSync(baselinePath));
      const actual = PNG.sync.read(screenshot);

      expect(actual.width).toBe(baseline.width);
      expect(actual.height).toBe(baseline.height);

      const diff = new PNG({ width: baseline.width, height: baseline.height });
      const mismatchedPixels = pixelmatch(
        baseline.data,
        actual.data,
        diff.data,
        baseline.width,
        baseline.height,
        { threshold: TOLERANCE }
      );

      if (mismatchedPixels > MAX_DIFF_AREA) {
        const diffPath = join(SNAPSHOTS_DIR, `tick-${checkpoint}.diff.png`);
        writeFileSync(diffPath, PNG.sync.write(diff));
        test.info().attachments.push({
          name: `diff-${checkpoint}`,
          contentType: "image/png",
          path: diffPath,
        });
      }

      expect(mismatchedPixels, `tick ${checkpoint}: ${mismatchedPixels} pixels differ (max ${MAX_DIFF_AREA})`).toBeLessThanOrEqual(MAX_DIFF_AREA);
    });
  }
});
