import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke against deployed URLs (override with env in CI).
 * - PLAYWRIGHT_BASE_URL: frontend (must proxy /api/v1/* to backend, or login UI-only still hits API from browser)
 * - PLAYWRIGHT_API_URL: backend REST prefix, e.g. https://xxx.onrender.com/api/v1
 */
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL?.trim() || "https://inventory-brown-beta.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
