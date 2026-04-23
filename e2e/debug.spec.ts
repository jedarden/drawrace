import { test, expect } from "@playwright/test";

test("screenshot race", async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    localStorage.setItem("drawrace_landing_dismissed", "true");
  });

  await page.goto("/");
  await page.waitForSelector('[role="main"]');

  const canvas = page.getByRole("img", { name: /drawing canvas/i });
  const box = await canvas.boundingBox();
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const radius = Math.min(box.width, box.height) * 0.3;
  const startAngle = Math.PI * 1.5;

  await page.mouse.move(centerX + radius * Math.cos(startAngle), centerY + radius * Math.sin(startAngle));
  await page.mouse.down();
  for (let i = 0; i <= 360; i += 15) {
    const angle = startAngle + (i * Math.PI) / 180;
    await page.mouse.move(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
  }
  await page.mouse.up();

  await expect(page.getByRole("button", { name: /race/i })).toBeEnabled({ timeout: 5000 });
  await page.getByRole("button", { name: /race/i }).click();

  await page.waitForSelector('[aria-label="Countdown"]', { timeout: 10000 });
  // Wait for race to start (countdown = 3 seconds)
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/race-5s-v2.png" });

  // Wait 25 more seconds
  await page.waitForTimeout(25000);
  await page.screenshot({ path: "/tmp/race-30s-v2.png" });
});
