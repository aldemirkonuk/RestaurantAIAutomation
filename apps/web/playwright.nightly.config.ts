/**
 * Playwright config for the nightly production E2E (ADR 0135).
 *
 *   npx playwright test --config playwright.nightly.config.ts
 *
 * Env (all read by e2e/nightly/lib.ts; the workflow maps them from secrets):
 *   E2E_BASE_URL        the web app (production: https://mudavym.com)
 *   E2E_API_URL         the gateway (production: API_GATEWAY_URL secret)
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD   the e2e account
 *   E2E_EXPECT_FLAGS    report | on | off   (default report)
 *   E2E_LEGACY_RESTAURANT_ID   optional second house for the legacy pass
 *   E2E_ALLOW_LOCAL=1   lets a CI run target localhost (never set in the nightly)
 *
 * No `webServer` block: the nightly targets a deployed app. Locally, start the
 * dev server yourself (apps/web/.env.local → VITE_API_GATEWAY_URL) and point
 * E2E_BASE_URL at it. workers=1 and no parallelism are deliberate — the auth
 * routes are limited to 10 requests per 60 s per IP+route.
 */

import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL
if (!baseURL) {
  throw new Error('[playwright.nightly.config.ts] E2E_BASE_URL is required (CANNOT CHECK without a target).')
}
if (process.env.CI && !process.env.E2E_ALLOW_LOCAL && /localhost|127\.0\.0\.1/.test(baseURL)) {
  throw new Error(`[playwright.nightly.config.ts] CI run pointed at a local URL (${baseURL}); set E2E_ALLOW_LOCAL=1 only on purpose.`)
}

export default defineConfig({
  testDir: './e2e/nightly',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/nightly-traces',
  reporter: [
    ['list'],
    // wave_f.xml keeps the cascading report's Wave F slot (the browser wave).
    ['junit', { outputFile: 'test-results/wave_f.xml' }],
    ['./e2e/nightly/honest-reporter.ts'],
  ],
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    // OFF, deliberately (audit of PR #349, finding 1.1, critical). A Playwright
    // trace is a full network capture, headers and bodies, so a failed run's
    // trace carried E2E_TEST_PASSWORD and live session JWTs -- proven with a
    // sentinel password -- into a 30-day artifact on a public repository. This
    // nightly has failed 127 of 130 historical runs, so a trace would be made
    // almost every night. Screenshots stay: they carry no headers or bodies.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'nightly', use: { ...devices['Desktop Chrome'] } }],
})
