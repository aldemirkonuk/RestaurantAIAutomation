import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // prod-smoke.spec.ts targets the LIVE Vercel deployment and requires
  // E2E_BASE_URL + E2E_TEST_EMAIL/PASSWORD. It is run only via
  // playwright.prod.config.ts (and the scheduled Production E2E workflow),
  // never against the local dev server in this default config.
  testIgnore: '**/prod-smoke.spec.ts',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'smoke', testMatch: 'smoke.spec.ts' },
    { name: 'e2e', testMatch: /^(?!smoke).*\.spec\.ts$/ },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
