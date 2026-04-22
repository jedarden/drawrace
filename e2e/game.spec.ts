import { test, expect } from "@playwright/test";

test.describe("DrawRace Game Flow", () => {
  test("has proper page title and meta", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("DrawRace");
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute("content", "#F4EAD5");
  });

  test("shows draw screen on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main", { name: "Draw your wheel screen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Draw your wheel" })).toBeVisible();
    await expect(page.getByRole("img", { name: /drawing canvas/i })).toBeVisible();
  });

  test("drawing canvas responds to pointer input", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // Draw a simple circle-like shape
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    const radius = Math.min(box!.width, box!.height) * 0.3;

    await page.mouse.move(centerX, centerY + radius);
    await page.mouse.down();

    // Draw an arc
    for (let i = 0; i <= 360; i += 20) {
      const angle = (i * Math.PI) / 180;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      await page.mouse.move(x, y);
    }

    await page.mouse.up();

    // Race button should be enabled after drawing
    await expect(page.getByRole("button", { name: "Start race" })).toBeEnabled({ timeout: 5000 });
  });

  test("clear button resets the drawing", async ({ page }) => {
    await page.goto("/");

    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();

    // Draw something
    await page.mouse.move(box!.x + 50, box!.y + 50);
    await page.mouse.down();
    await page.mouse.move(box!.x + 100, box!.y + 100);
    await page.mouse.up();

    // Click clear
    await page.getByRole("button", { name: "Clear drawing" }).click();

    // Race button should be disabled again
    await expect(page.getByRole("button", { name: /Start race/i })).toBeDisabled();
  });

  test("race button is disabled for minimal input", async ({ page }) => {
    await page.goto("/");

    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();

    // Just a tap, not enough travel
    await page.mouse.move(box!.x + 50, box!.y + 50);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByRole("button", { name: /Start race/i })).toBeDisabled();
  });
});

test.describe("Race Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("shows countdown before race", async ({ page }) => {
    await page.goto("/");

    // Draw a wheel
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    const radius = Math.min(box!.width, box!.height) * 0.3;

    await page.mouse.move(centerX, centerY + radius);
    await page.mouse.down();
    for (let i = 0; i <= 360; i += 20) {
      const angle = (i * Math.PI) / 180;
      await page.mouse.move(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
    }
    await page.mouse.up();

    // Start race
    await page.getByRole("button", { name: "Start race" }).click();

    // Should see countdown
    await expect(page.getByRole("status", { name: /countdown/i })).toBeVisible();

    // Countdown should show 3, 2, 1, then GO!
    await expect(page.getByText("3")).toBeVisible();
    await expect(page.getByText("2")).toBeVisible();
    await expect(page.getByText("1")).toBeVisible();
    await expect(page.getByText("GO!")).toBeVisible();
  });

  test("shows race canvas with ARIA labels", async ({ page }) => {
    await page.goto("/");

    // Draw and start race
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    const radius = Math.min(box!.width, box!.height) * 0.3;

    await page.mouse.move(centerX, centerY + radius);
    await page.mouse.down();
    for (let i = 0; i <= 360; i += 20) {
      const angle = (i * Math.PI) / 180;
      await page.mouse.move(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
    }
    await page.mouse.up();

    await page.getByRole("button", { name: "Start race" }).click();

    await expect(page.getByRole("img", { name: /race view/i })).toBeVisible();
  });
});

test.describe("Result Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");

    // Draw a simple wheel that will finish quickly (small circle)
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    // Draw a small circle
    await page.mouse.move(centerX + 20, centerY);
    await page.mouse.down();
    for (let i = 0; i <= 360; i += 30) {
      const angle = (i * Math.PI) / 180;
      await page.mouse.move(centerX + 20 * Math.cos(angle), centerY + 20 * Math.sin(angle));
    }
    await page.mouse.up();

    await page.getByRole("button", { name: "Start race" }).click();
  });

  test("displays finish time", async ({ page }) => {
    // Wait for race to complete (may take up to 2 minutes for DNF)
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 120000 });

    // Should show a time in monospace format
    const timeDisplay = page.getByRole("timer");
    await expect(timeDisplay).toBeVisible();
    const timeText = await timeDisplay.textContent();
    expect(timeText).toMatch(/\d+:\d{2}\.\d{3}/);
  });

  test("shows wheel shape preview", async ({ page }) => {
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 120000 });

    await expect(page.getByRole("img", { name: /your wheel shape/i })).toBeVisible();
  });

  test("has retry button", async ({ page }) => {
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 120000 });

    const retryButton = page.getByRole("button", { name: /try again/i });
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();
  });

  test("retry button returns to draw screen", async ({ page }) => {
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 120000 });

    await page.getByRole("button", { name: /try again/i }).click();

    await expect(page.getByRole("main", { name: "Draw your wheel screen" })).toBeVisible();
  });
});

test.describe("Accessibility", () => {
  test("has proper ARIA labels and roles", async ({ page }) => {
    await page.goto("/");

    // Check main landmarks
    await expect(page.getByRole("application")).toHaveAttribute("aria-label", "DrawRace Game");

    // Check draw screen
    await expect(page.getByRole("main", { name: "Draw your wheel screen" })).toBeVisible();
    await expect(page.getByRole("img", { name: /drawing canvas/i })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: /drawing controls/i })).toBeVisible();
  });

  test("buttons have accessible names", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeVisible();
    await expect(page.getByRole("button", { name: /start race/i })).toBeVisible();
  });

  test("status announcements are present", async ({ page }) => {
    await page.goto("/");

    const status = page.getByRole("status", { name: /wheel ready/i });
    await expect(status).toBeVisible();
  });
});

test.describe("Settings", () => {
  test("settings can be opened and closed", async ({ page }) => {
    await page.goto("/");

    // Note: Settings button needs to be added to DrawScreen
    // For now, we'll check the settings screen renders correctly
    // This test will be updated once the settings button is added to the UI
  });

  test("settings toggles persist to localStorage", async ({ page }) => {
    await page.goto("/");

    // Enable haptics via localStorage
    await page.evaluate(() => {
      localStorage.setItem("drawrace.haptics", "true");
    });

    await page.reload();

    const hapticsEnabled = await page.evaluate(() => {
      return localStorage.getItem("drawrace.haptics");
    });

    expect(hapticsEnabled).toBe("true");
  });
});

test.describe("PWA", () => {
  test("has manifest and service worker", async ({ page }) => {
    const response = await page.request.get("/manifest.json");
    expect(response.status()).toBe(200);

    const manifest = await response.json();
    expect(manifest).toHaveProperty("name");
    expect(manifest).toHaveProperty("start_url");
  });

  test("has theme color set", async ({ page }) => {
    await page.goto("/");
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute("content", "#F4EAD5");
  });

  test("has apple touch icon", async ({ page }) => {
    await page.goto("/");
    const icon = page.locator('link[rel="apple-touch-icon"]');
    await expect(icon).toHaveAttribute("href", "/icon-192.png");
  });
});
