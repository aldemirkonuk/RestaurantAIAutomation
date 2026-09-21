import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // e2e/nightly/** targets a DEPLOYED app with a real account (ADR 0135) and
  // runs only through playwright.nightly.config.ts — from the scheduled
  // Production E2E workflow or by hand — never against this config's dev
  // server, which has no gateway behind it.
  testIgnore: ['**/nightly/**'],
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
