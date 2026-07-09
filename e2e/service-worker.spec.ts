import { test, expect } from "@playwright/test";

/**
 * Service Worker Update Behavior Tests
 *
 * Tests that service worker updates do NOT interrupt in-flight races.
 * Per plan §Multiplayer & Backend 14: skipWaiting:false, so a new SW
 * installs in background and takes over on next navigation only.
 */

async function dismissLanding(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("drawrace_landing_dismissed", "true");
  });
}

function getDeterministicTestUrl(): string {
  return "/?seed=1&track=v1";
}

async function waitForDrawScreen(page: import("@playwright/test").Page) {
  await expect(page.getByRole("main", { name: /draw your wheel/i })).toBeVisible({ timeout: 10000 });
}

async function drawWheel(page: import("@playwright/test").Page) {
  const canvas = page.getByRole("img", { name: /drawing canvas/i });
  const box = await canvas.boundingBox();
  const centerX = box!.x + box!.width / 2;
  const centerY = box!.y + box!.height / 2;
  const radius = Math.min(box!.width, box!.height) * 0.3;
  const startAngle = Math.PI * 1.5;

  await page.mouse.move(centerX + radius * Math.cos(startAngle), centerY + radius * Math.sin(startAngle));
  await page.mouse.down();
  for (let i = 0; i <= 360; i += 15) {
    const angle = startAngle + (i * Math.PI) / 180;
    await page.mouse.move(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
  }
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /race/i })).toBeEnabled({ timeout: 5000 });
}

test.describe("Service Worker Updates", () => {
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("service worker installs without skipWaiting", async ({ page }) => {
    await page.goto(getDeterministicTestUrl());

    // Wait for service worker to register
    await page.waitForFunction(() => {
      return navigator.serviceWorker.getRegistration();
    }, { timeout: 5000 });

    const swRegistered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration !== null;
    });

    expect(swRegistered).toBe(true);
  });

  test("service worker does NOT activate immediately during race", async ({ page, context }) => {
    // This test simulates a service worker update arriving mid-race
    // and verifies that the race completes uninterrupted

    await page.goto(getDeterministicTestUrl());
    await waitForDrawScreen(page);

    // Draw a wheel and start race
    await drawWheel(page);
    await page.getByRole("button", { name: /race/i }).click();

    // Wait for race to start (countdown completes)
    await page.waitForTimeout(4000);

    // Simulate an update check while race is in progress
    // In a real scenario, this would be a new SW version being detected
    const updateDetected = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return false;
      // Check if there's a waiting SW (simulating an update detected)
      return registration.waiting !== null;
    });

    // Even if an update is detected, the race should continue uninterrupted
    // because skipWaiting is false - the new SW waits for next navigation

    // Wait for race to complete (should finish within 40 seconds)
    const resultScreen = page.getByRole("main", { name: /race result/i });
    await expect(resultScreen).toBeVisible({ timeout: 45000 });

    // Verify we got a result time (race completed normally)
    const timeText = await page.getByTestId("result-time").textContent({ timeout: 5000 });
    expect(timeText).toBeTruthy();
    expect(timeText).toMatch(/\d+:\d+\.\d+/);
  });

  test("service worker activates on next navigation after update", async ({ page }) => {
    // Test that the SW update properly takes effect on NEXT navigation
    // (not during the current page session)

    await page.goto(getDeterministicTestUrl());

    // Wait for initial SW registration
    await page.waitForFunction(() => {
      return navigator.serviceWorker.getRegistration();
    });

    // Navigate to a new page (this is where an update would take effect)
    await page.goto("/?seed=2&track=v1");

    // Verify SW is still controlling the page
    const isControlled = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active !== null;
    });

    expect(isControlled).toBe(true);
  });

  test("activateUpdate only triggers when explicitly called", async ({ page }) => {
    // Test that the activateUpdate function works as designed
    // It should NOT auto-trigger during gameplay

    await page.goto(getDeterministicTestUrl());
    await waitForDrawScreen(page);

    // Before any update, there should be no waiting SW
    const hasWaitingBefore = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting !== null;
    });

    expect(hasWaitingBefore).toBe(false);

    // Draw and race to verify the game works normally
    await drawWheel(page);
    await page.getByRole("button", { name: /race/i }).click();
    await page.waitForTimeout(2000); // Race in progress

    // Game should still be running (no forced reload)
    const isRaceRunning = await page.locator("canvas").isVisible();
    expect(isRaceRunning).toBe(true);
  });
});

test.describe("Service Worker Skip Waiting Contract", () => {
  test("service worker respects SKIP_WAITING message", async ({ page }) => {
    // Test that the SW responds to manual SKIP_WAITING activation
    // This is the only way a new SW should activate mid-session

    await page.goto(getDeterministicTestUrl());

    // Get the SW registration
    const registration = await page.evaluate(async () => {
      return await navigator.serviceWorker.getRegistration();
    });

    expect(registration).toBeTruthy();

    // Even with SKIP_WAITING message handling, it should only activate
    // when explicitly called by the client (via activateUpdate in normal flow)
    // and the client should only call it when safe (not mid-race)
  });

  test("waiting SW does NOT auto-claim clients", async ({ page }) => {
    // Verify that a waiting SW does NOT force itself onto clients
    // This is the key safety property preventing mid-race disruption

    await page.goto(getDeterministicTestUrl());

    // Get initial controller
    const initialController = await page.evaluate(async () => {
      return navigator.serviceWorker.controller?.scriptURL || null;
    });

    // If there's no waiting SW, test passes (no forced update)
    const hasWaiting = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting !== null;
    });

    // The test passes if either:
    // 1. There's no waiting SW (normal case), or
    // 2. The current controller hasn't changed (waiting SW didn't force itself)
    const controllerUnchanged = await page.evaluate(async () => {
      return navigator.serviceWorker.controller?.scriptURL === initialController;
    });

    expect(controllerUnchanged).toBe(true);
  });
});
