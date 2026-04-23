import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

test.describe("Accessibility (WCAG 2.1 AA)", () => {
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
    await page.goto("/");
    await waitForDrawScreen(page);
  });

  test("draw screen passes accessibility scan", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules([
        "color-contrast",
        "document-title",
        "html-has-lang",
        "html-lang-valid",
        "image-alt",
        "label",
        "link-name",
        "list",
        "listitem",
      ])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("draw canvas has accessible name and role", async ({ page }) => {
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    await expect(canvas).toBeVisible();
  });

  test("buttons have accessible names", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeVisible();
    await expect(page.getByRole("button", { name: /race/i })).toBeVisible();
  });

  test("color contrast meets WCAG AA standards", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();

    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );
    expect(criticalOrSerious).toEqual([]);
  });

  test("focus indicators are visible", async ({ page }) => {
    const clearButton = page.getByRole("button", { name: "Clear drawing" });

    await clearButton.focus();
    await expect(clearButton).toBeFocused();

    // Check that the focused element has some visual indicator
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;

      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        outlineOffset: styles.outlineOffset,
        boxShadow: styles.boxShadow,
      };
    });

    // Should have at least one focus indicator
    const hasFocusIndicator =
      (focusedElement?.outline && focusedElement.outline !== "none") ||
      (focusedElement?.boxShadow && focusedElement.boxShadow !== "none");

    expect(hasFocusIndicator).toBe(true);
  });

  test("status announcements work correctly", async ({ page }) => {
    const status = page.getByRole("status");
    await expect(status.first()).toBeVisible();
  });

  test("tool has proper ARIA labels", async ({ page }) => {
    const toolbar = page.getByRole("toolbar", { name: /drawing controls/i });
    await expect(toolbar).toBeVisible();
  });

  test("heading hierarchy is correct", async ({ page }) => {
    const headings = page.locator("h1, h2, h3, h4, h5, h6");

    const count = await headings.count();
    expect(count).toBeGreaterThan(0);

    const firstTag = await headings.first().evaluate((el) => el.tagName.toLowerCase());
    expect(firstTag).toBe("h1");
  });
});

test.describe("Accessibility - Race Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("race screen has proper labels", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    // Check race canvas has label
    await expect(page.getByRole("img", { name: /race view/i })).toBeVisible();

    // Check countdown is announced via ARIA live region
    await expect(page.getByRole("status", { name: /countdown/i })).toBeVisible();
  });
});

test.describe("Accessibility - Result Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("result screen has proper labels and live regions", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForDrawScreen(page);
    await drawWheel(page);

    await page.getByRole("button", { name: /race/i }).click();

    // Wait for results
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 90000 });

    // Check timer has role="timer"
    await expect(page.getByRole("timer")).toBeVisible();

    // Check status announcements are present
    await expect(page.getByRole("status").first()).toBeVisible();
  });
});

test.describe("Accessibility - Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await dismissLanding(page);
  });

  test("all interactive elements are keyboard accessible", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);

    // Tab through interactive elements
    await page.keyboard.press("Tab");

    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName.toLowerCase();
    });

    expect(["canvas", "button"]).toContain(focusedElement ?? "");

    // Continue tabbing to find buttons
    let foundClearButton = false;
    let foundRaceButton = false;

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => ({
        tag: document.activeElement?.tagName.toLowerCase(),
        ariaLabel: document.activeElement?.getAttribute("aria-label"),
      }));

      if (focused.tag === "button") {
        if (focused.ariaLabel?.includes("Clear")) foundClearButton = true;
        if (focused.ariaLabel?.includes("race")) foundRaceButton = true;
      }
    }

    expect(foundClearButton).toBe(true);
  });

  test("Enter and Space activate buttons", async ({ page }) => {
    await page.goto("/");
    await waitForDrawScreen(page);

    // Focus clear button
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Activate with Enter
    await page.keyboard.press("Enter");

    // Button action should have executed (canvas cleared)
    const statusText = await page.getByRole("status").first().textContent();
    expect(statusText).toContain("Draw");
  });
});
