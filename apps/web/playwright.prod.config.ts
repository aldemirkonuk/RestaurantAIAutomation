/**
 * Playwright Production Config — apps/web/playwright.prod.config.ts
 *
 * Targets the live Vercel production deployment. NO local dev server.
 * Set E2E_BASE_URL to the production Vercel URL before running.
 *
 * Usage:
 *   npx playwright test --config playwright.prod.config.ts
 *
 * Required env vars:
 *   E2E_BASE_URL      — production Vercel URL (e.g. https://wineops.vercel.app)
 *   E2E_TEST_EMAIL    — e2e-test@wineops.internal (Supabase Auth service account)
 *   E2E_TEST_PASSWORD — service account password (GitHub Actions secret)
 *
 * NEVER add a local dev server block — prod tests target a live URL, not a local server.
 * See RESEARCH.md Pitfall 4 for why omitting the dev server block is critical.
 */

import { defineConfig, devices } from '@playwright/test'

const prodBaseURL = process.env.E2E_BASE_URL
if (!prodBaseURL) {
  throw new Error(
    '[playwright.prod.config.ts] E2E_BASE_URL is required for production tests.\n' +
      'Set it to the production Vercel URL: export E2E_BASE_URL=https://wineops.vercel.app',
  )
}

// localhost guard: reject localhost/127.0.0.1 in production config (no defaults allowed)
if (prodBaseURL.includes('localhost') || prodBaseURL.includes('127.0.0.1')) { // guard
  throw new Error(
    `[playwright.prod.config.ts] localhost guard: E2E_BASE_URL must be a production URL. Got: ${prodBaseURL}`,
  )
}

export default defineConfig({
  testDir: './e2e',

  // Only run prod-smoke.spec.ts with this config
  testMatch: '**/prod-smoke.spec.ts',

  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  outputDir: 'test-results/wave-f-traces',

  // Reporters: stdout + JUnit XML for CI
  reporter: [
    ['list'],
    ['junit', { outputFile: 'test-results/wave_f.xml' }],
  ],

  use: {
    baseURL: prodBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Headless Chromium — required for CI (D-09)
    headless: true,
  },

  // No local dev server block — production tests target live Vercel URL directly.
  // Omitting it is intentional: see RESEARCH.md Pitfall 4.

  projects: [
    {
      name: 'prod-smoke',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
})
