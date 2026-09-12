import { test, expect } from "@playwright/test";

// Agentation UI-feedback toolbar mount verification.
//
// Loads every UI entry point in a real browser and asserts the #agentation-root
// mount node is present AND that the mounted React component actually rendered
// — a script-tag grep cannot see either, and a static div alone would pass
// while the mount script crashed before render.
//
// Where the rendered UI lives: React commits into #agentation-root, but the
// Agentation component portals its toolbar to document.body (a
// [data-agentation-root] wrapper holding the [data-feedback-toolbar] toolbar),
// so the light-DOM host legitimately stays empty. Asserting host children here
// would hang forever on a perfectly healthy mount — assert the portal.
//
// Runs against the Vite dev server (playwright.config webServer), which is the
// only place Agentation is active: every entry point gates it behind
// import.meta.env.DEV so the production bundle tree-shakes it off the 400KB
// budget and the production CSP (script-src 'self') stays untouched.

const ENTRY_POINTS = [
  { path: "/", label: "index.html" },
  { path: "/perf-test.html", label: "perf-test.html" },
  { path: "/snapshot-test.html", label: "snapshot-test.html" },
];

for (const { path, label } of ENTRY_POINTS) {
  test(`agentation mounts on ${label}`, async ({ page }) => {
    await page.goto(path);

    const root = page.locator("#agentation-root");
    await expect(root).toBeAttached();

    // First load may trigger Vite dependency pre-bundling, so allow a generous
    // window for the module graph to settle and the toolbar to render.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const portal = document.querySelector("[data-agentation-root]");
            const toolbar = document.querySelector("[data-feedback-toolbar]");
            return portal && toolbar ? toolbar.textContent.length : 0;
          }),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });
}
