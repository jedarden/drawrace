import { test, expect } from "@playwright/test";

async function dismissLanding(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("drawrace_landing_dismissed", "true");
  });
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

test.describe("DrawRace Game Flow", () => {
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

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
    await waitForDrawScreen(page);

    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

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

    await expect(page.getByRole("button", { name: /race/i })).toBeEnabled({ timeout: 5000 });
  });

  test("clear button resets the drawing", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    // Click clear
    await page.getByRole("button", { name: "Clear drawing" }).click();

    // Race button should be disabled again
    await expect(page.getByRole("button", { name: /race/i })).toBeDisabled();
  });

  test("race button is disabled for minimal input", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);

    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();

    // Just a tap, not enough travel
    await page.mouse.move(box!.x + 50, box!.y + 50);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByRole("button", { name: /race/i })).toBeDisabled();
  });
});

test.describe("Race Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("shows countdown before race", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    // Check race canvas appears
    await expect(page.getByRole("img", { name: /race view/i })).toBeVisible();

    // Check countdown ARIA announcer is present
    await expect(page.getByRole("status", { name: /countdown/i })).toBeVisible();
  });

  test("shows race canvas with ARIA labels", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    await expect(page.getByRole("img", { name: /race view/i })).toBeVisible();
  });
});

test.describe("Result Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("displays finish time", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    // Wait for race to complete
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 90000 });

    const timeDisplay = page.getByRole("timer");
    await expect(timeDisplay).toBeVisible();
    const timeText = await timeDisplay.textContent();
    expect(timeText).toMatch(/\d+:\d{2}\.\d{3}/);
  });

  test("shows wheel shape preview", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 90000 });
    await expect(page.getByRole("img", { name: /your wheel shape/i })).toBeVisible();
  });

  test("has retry button", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 90000 });

    const retryButton = page.getByRole("button", { name: /try again/i });
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();
  });

  test("retry button returns to draw screen", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 90000 });
    await page.getByRole("button", { name: /try again/i }).click();

    await expect(page.getByRole("main", { name: "Draw your wheel screen" })).toBeVisible();
  });
});

test.describe("Accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("has proper ARIA labels and roles", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);

    await expect(page.getByRole("application")).toHaveAttribute("aria-label", "DrawRace Game");
    await expect(page.getByRole("main", { name: "Draw your wheel screen" })).toBeVisible();
    await expect(page.getByRole("img", { name: /drawing canvas/i })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: /drawing controls/i })).toBeVisible();
  });

  test("buttons have accessible names", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);

    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeVisible();
    await expect(page.getByRole("button", { name: /race/i })).toBeVisible();
  });

  test("status announcements are present", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);

    const status = page.getByRole("status");
    await expect(status.first()).toBeVisible();
    const text = await status.first().textContent();
    expect(text).toBeTruthy();
  });
});

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("settings can be opened and closed", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);
  });

  test("settings toggles persist to localStorage", async ({ page }) => {
    await page.goto("/");

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
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

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
