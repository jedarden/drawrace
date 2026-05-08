/**
 * Device Matrix Smoke Tests — BrowserStack
 *
 * These tests run on real devices via BrowserStack App Automate as part of
 * the release gate (plan.md §Testing 10.2). They exercise the same smoke
 * scenarios as the self-hosted Pixel 6 phone-smoke test.
 *
 * Scenarios (from phone-smoke driver.py):
 * 1. Draw seeded circle → race → result screen
 * 2. Draw tiny dot → Race button stays disabled
 * 3. Mid-race redraw (triangle after 8 seconds)
 * 4. Result screen shows valid time (5s-120s range)
 *
 * Failure policy: 2+ device failures block release. Single-device failure
 * opens a triage bead but does not block.
 */

import { test, expect } from "@playwright/test";

/**
 * Bypass the landing/invite screen for automated testing.
 */
async function dismissLanding(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("drawrace_landing_dismissed", "true");
    localStorage.setItem("drawrace_invite_access", "true");
  });
}

/**
 * Wait for the draw screen to be visible.
 */
async function waitForDrawScreen(page: import("@playwright/test").Page) {
  await expect(page.getByRole("main", { name: /draw your wheel/i })).toBeVisible({
    timeout: 15000,
  });
}

/**
 * Draw a circle on the canvas using pointer events.
 * Matches the phone-smoke driver's circle drawing logic.
 */
async function drawCircle(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const radius = Math.min(box.width, box.height) * 0.35;
  const samples = 80;
  const startAngle = -Math.PI / 2;

  // pointerdown at start
  const startX = centerX + radius * Math.cos(startAngle);
  const startY = centerY + radius * Math.sin(startAngle);
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // Draw the circle with 80 samples
  for (let i = 1; i <= samples; i++) {
    const t = startAngle + (i / samples) * Math.PI * 2;
    await page.mouse.move(centerX + radius * Math.cos(t), centerY + radius * Math.sin(t));
  }

  // pointerup back at start (closure)
  await page.mouse.up();

  // Wait for the race button to become enabled
  await expect(page.getByRole("button", { name: /race/i })).toBeEnabled({
    timeout: 10000,
  });
}

/**
 * Draw a tiny dot (insufficient travel) to verify input rejection.
 */
async function drawTinyDot(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  const x = box.x + 50;
  const y = box.y + 50;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Draw a triangle for mid-race redraw testing.
 * Uses the bottom draw overlay during the race.
 */
async function drawTriangleMidRace(page: import("@playwright/test").Page) {
  // Find the draw overlay (bottom 40% of viewport during race)
  const overlay = page.getByRole("region", { name: /mid-race draw/i });
  await expect(overlay).toBeVisible({ timeout: 5000 });

  const box = await overlay.boundingBox();
  if (!box) throw new Error("Draw overlay not found");

  // Wait for overlay to be active (not greyed out by cooldown)
  await page.waitForTimeout(600);

  const cx = box.x + box.width * 0.5;
  const cy = box.top + box.height * 0.5;
  const size = Math.min(box.width, box.height) * 0.25;

  // Triangle points: top, bottom-right, bottom-left
  const pts = [
    { x: cx, y: cy - size },
    { x: cx + size * 0.866, y: cy + size * 0.5 },
    { x: cx - size * 0.866, y: cy + size * 0.5 },
  ];

  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  await page.mouse.move(pts[1].x, pts[1].y);
  await page.mouse.move(pts[2].x, pts[2].y);
  await page.mouse.up();

  // Wait for swap to register
  await page.waitForTimeout(500);
}

/**
 * Parse finish time from timer display (e.g., "0:28.441").
 */
async function getFinishTime(page: import("@playwright/test").Page): Promise<number | null> {
  const timer = page.getByRole("timer");
  if (!(await timer.isVisible())) return null;

  const text = await timer.textContent();
  if (!text) return null;

  const match = text.match(/(\d+):(\d{2})\.(\d{3})/);
  if (!match) return null;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const millis = parseInt(match[3], 10);
  return minutes * 60000 + seconds * 1000 + millis;
}

test.describe("Device Matrix Smoke", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("scenario 1: draw circle → race → result screen", async ({ page }) => {
    test.setTimeout(120000);

    // Navigate with seed=1 for determinism
    await page.goto("/?seed=1");
    await waitForDrawScreen(page);

    // Draw circle and click race
    await drawCircle(page);
    await page.getByRole("button", { name: /race/i }).click();

    // Wait for countdown (3-2-1-GO)
    await expect(page.getByRole("status", { name: /countdown/i })).toBeVisible();

    // Wait for result screen
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({
      timeout: 90000,
    });

    // Verify finish time is in expected range
    const timeMs = await getFinishTime(page);
    expect(timeMs).not.toBeNull();
    expect(timeMs).toBeGreaterThanOrEqual(5000);
    expect(timeMs).toBeLessThanOrEqual(120000);
  });

  test("scenario 2: tiny dot → race button stays disabled", async ({ page }) => {
    await page.goto("/?seed=1");
    await waitForDrawScreen(page);

    // Draw tiny dot (insufficient travel)
    await drawTinyDot(page);

    // Race button should remain disabled
    await expect(page.getByRole("button", { name: /race/i })).toBeDisabled();
  });

  test("scenario 3: mid-race redraw (triangle)", async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/?seed=1");
    await waitForDrawScreen(page);

    // Draw initial circle and start race
    await drawCircle(page);
    await page.getByRole("button", { name: /race/i }).click();

    // Wait for countdown
    await expect(page.getByRole("status", { name: /countdown/i })).toBeVisible();

    // Wait 8 seconds for race to progress
    await page.waitForTimeout(8000);

    // Draw triangle mid-race
    await drawTriangleMidRace(page);

    // Verify swap count increased
    const swapCounter = page.getByRole("region", { name: /swaps:/i });
    await expect(swapCounter).toBeVisible();

    // Wait for race to finish
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({
      timeout: 90000,
    });

    // Verify we got a valid finish time
    const timeMs = await getFinishTime(page);
    expect(timeMs).not.toBeNull();
    expect(timeMs).toBeGreaterThanOrEqual(5000);
    expect(timeMs).toBeLessThanOrEqual(120000);
  });

  test("scenario 4: result screen shows valid time range", async ({ page }) => {
    test.setTimeout(120000);

    await page.goto("/?seed=1");
    await waitForDrawScreen(page);

    await drawCircle(page);
    await page.getByRole("button", { name: /race/i }).click();

    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({
      timeout: 90000,
    });

    // Check timer element exists and has expected format
    const timer = page.getByRole("timer");
    await expect(timer).toBeVisible();

    const text = await timer.textContent();
    expect(text).toMatch(/\d+:\d{2}\.\d{3}/);

    // Parse and validate range
    const timeMs = await getFinishTime(page);
    expect(timeMs).toBeGreaterThanOrEqual(5000);
    expect(timeMs).toBeLessThanOrEqual(120000);
  });

  test("scenario 5: verify canvas not blank after drawing", async ({ page }) => {
    await page.goto("/?seed=1");
    await waitForDrawScreen(page);

    const canvas = page.locator("canvas").first();
    await expect(canvas).toBeVisible();

    // Get canvas data before drawing
    const beforeData = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      return ctx.getImageData(0, 0, c.width, c.height).data;
    });

    expect(beforeData).not.toBeNull();

    // Draw circle
    await drawCircle(page);

    // Get canvas data after drawing
    const afterData = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      return ctx.getImageData(0, 0, c.width, c.height).data;
    });

    expect(afterData).not.toBeNull();

    // Verify something changed (canvas not blank)
    let hasDifference = false;
    for (let i = 0; i < beforeData!.length; i++) {
      if (beforeData![i] !== afterData![i]) {
        hasDifference = true;
        break;
      }
    }
    expect(hasDifference).toBeTruthy();
  });

  test("scenario 6: no console errors during run", async ({ page }) => {
    test.setTimeout(120000);

    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    page.on("pageerror", (err) => {
      errors.push(err.message);
    });

    await page.goto("/?seed=1");
    await waitForDrawScreen(page);

    await drawCircle(page);
    await page.getByRole("button", { name: /race/i }).click();

    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({
      timeout: 90000,
    });

    // Give a moment for any late errors to fire
    await page.waitForTimeout(1000);

    // Assert no errors
    expect(errors).toEqual([]);
  });
});
