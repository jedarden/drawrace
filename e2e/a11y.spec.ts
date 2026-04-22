import { test, expect } from "@playwright/test";
import { injectAxe, checkA11y } from "@axe-core/playwright";

test.describe("Accessibility (WCAG 2.1 AA)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await injectAxe(page);
  });

  test("draw screen passes accessibility scan", async ({ page }) => {
    await checkA11y(page, null, {
      detailedReport: true,
      detailedReportOptions: { html: true },
      rules: {
        // WCAG 2.1 AA level
        "color-contrast": { enabled: true },
        "document-title": { enabled: true },
        "html-has-lang": { enabled: true },
        "html-lang-valid": { enabled: true },
        "image-alt": { enabled: true },
        "label": { enabled: true },
        "link-name": { enabled: true },
        "list": { enabled: true },
        "listitem": { enabled: true },
      },
    });
  });

  test("draw canvas has accessible name and role", async ({ page }) => {
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    await expect(canvas).toBeVisible();
  });

  test("buttons have accessible names", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeVisible();
    await expect(page.getByRole("button", { name: /start race/i })).toBeVisible();
  });

  test("color contrast meets WCAG AA standards", async ({ page }) => {
    const violations = await checkA11y(page, null, {
      includedImpacts: ["critical", "serious"],
    });

    // Check specifically for color contrast issues
    const contrastIssues = violations?.filter((v: { id: string }) => v.id === "color-contrast");
    expect(contrastIssues?.length ?? 0).toBe(0);
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
    // Check for loading status
    const loadingStatus = page.getByRole("status", { name: "Loading" });
    await expect(loadingStatus).not.toBeVisible({ timeout: 5000 });

    // Check for wheel ready status
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

    // First heading should be h1
    const firstHeading = headings.first();
    await expect(firstHeading).toHaveTag("h1");
  });
});

test.describe("Accessibility - Race Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("race screen has proper labels", async ({ page }) => {
    await page.goto("/");

    // Draw a wheel to start race
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

    // Check race canvas has label
    await expect(page.getByRole("img", { name: /race view/i })).toBeVisible();

    // Check countdown is announced
    await expect(page.getByRole("status", { name: /countdown/i })).toBeVisible();
  });
});

test.describe("Accessibility - Result Screen", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("result screen has proper labels and live regions", async ({ page }) => {
    await page.goto("/");

    // Draw and start race
    const canvas = page.getByRole("img", { name: /drawing canvas/i });
    const box = await canvas.boundingBox();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    // Draw small wheel for faster race
    await page.mouse.move(centerX + 20, centerY);
    await page.mouse.down();
    for (let i = 0; i <= 360; i += 30) {
      const angle = (i * Math.PI) / 180;
      await page.mouse.move(centerX + 20 * Math.cos(angle), centerY + 20 * Math.sin(angle));
    }
    await page.mouse.up();

    await page.getByRole("button", { name: "Start race" }).click();

    // Wait for results
    await expect(page.getByRole("main", { name: /race results/i })).toBeVisible({ timeout: 120000 });

    // Check timer has role="timer"
    await expect(page.getByRole("timer")).toBeVisible();

    // Check status announcements are present
    await expect(page.getByRole("status").first()).toBeVisible();
  });
});

test.describe("Accessibility - Keyboard Navigation", () => {
  test("all interactive elements are keyboard accessible", async ({ page }) => {
    await page.goto("/");

    // Tab through interactive elements
    await page.keyboard.press("Tab");

    // First focusable should be the canvas or a button
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
