/**
 * Playwright configuration for BrowserStack device matrix testing.
 *
 * This config runs only on release candidates (mode=release in drawrace-ci DAG)
 * and targets iOS Safari + low-end Android devices not covered by the
 * self-hosted Pixel 6 phone-smoke test.
 *
 * Device targets (from plan.md §Testing 10.2):
 * - iPhone 12 iOS 17 Safari
 * - iPhone 15 Pro iOS 18 Safari
 * - Pixel 6 Android 14 Chrome (cross-check vs self-hosted)
 * - Redmi 9 Android 12 Chrome (low-end SD665 30fps floor)
 * - Galaxy S23 Android 14 Samsung Internet
 *
 * Usage:
 *   BROWSERSTACK_USERNAME=xxx BROWSERSTACK_ACCESS_KEY=xxx \
 *     playwright test --config=playwright.browserstack.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

const browserstackUsername = process.env.BROWSERSTACK_USERNAME;
const browserstackAccessKey = process.env.BROWSERSTACK_ACCESS_KEY;

if (!browserstackUsername || !browserstackAccessKey) {
  throw new Error(
    "BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY must be set. " +
      "In CI, these are injected from the drawrace-browserstack sealed-secret."
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // No retries for device-matrix; a failure is a signal
  workers: 5, // Run all 5 devices in parallel
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.DRAWRACE_TEST_URL || "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "iphone-12-ios17-safari",
      use: {
        ...devices["iPhone 12"],
        channel: "browserstack",
        browserstackOptions: {
          username: browserstackUsername,
          accessKey: browserstackAccessKey,
          os: "iOS",
          osVersion: "17",
          browserName: "Safari",
          deviceName: "iPhone 12",
        },
      },
    },
    {
      name: "iphone-15-pro-ios18-safari",
      use: {
        ...devices["iPhone 15 Pro"],
        channel: "browserstack",
        browserstackOptions: {
          username: browserstackUsername,
          accessKey: browserstackAccessKey,
          os: "iOS",
          osVersion: "18",
          browserName: "Safari",
          deviceName: "iPhone 15 Pro",
        },
      },
    },
    {
      name: "pixel-6-android14-chrome",
      use: {
        ...devices["Pixel 6"],
        channel: "browserstack",
        browserstackOptions: {
          username: browserstackUsername,
          accessKey: browserstackAccessKey,
          os: "Android",
          osVersion: "14.0",
          browserName: "Chrome",
          deviceName: "Google Pixel 6",
        },
      },
    },
    {
      name: "redmi-9-android12-chrome",
      use: {
        // Using generic mobile device config
        viewport: { width: 393, height: 851 },
        userAgent:
          "Mozilla/5.0 (Linux; Android 12; Redmi 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36",
        deviceScaleFactor: 2,
        channel: "browserstack",
        browserstackOptions: {
          username: browserstackUsername,
          accessKey: browserstackAccessKey,
          os: "Android",
          osVersion: "12.0",
          browserName: "Chrome",
          deviceName: "Redmi 9",
        },
      },
    },
    {
      name: "galaxy-s23-android14-samsung-internet",
      use: {
        viewport: { width: 360, height: 800 },
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/22.0 Chrome/111.0.0.0 Mobile Safari/537.36",
        deviceScaleFactor: 3,
        channel: "browserstack",
        browserstackOptions: {
          username: browserstackUsername,
          accessKey: browserstackAccessKey,
          os: "Android",
          osVersion: "14.0",
          browserName: "samsung",
          deviceName: "Samsung Galaxy S23",
        },
      },
    },
  ],
  // Don't start a webServer; BrowserStack tests hit the provided URL
  webServer: undefined,
});
