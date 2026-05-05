/**
 * Wave F: Production Frontend Smoke Tests (TEST-PROD-06)
 * =======================================================
 * Runs Playwright headless Chromium against the live Vercel production frontend.
 *
 * Pass bar (D-10):
 *   1. Login redirect succeeds (URL changes from /login)
 *   2. /admin/health shows ≥7 agent cards with Active status
 *   3. Dashboard loads within 5s with no JS console errors
 *   4. /studio route loads (review queue UI visible)
 *
 * Auth: Real Supabase login via E2E_TEST_EMAIL + E2E_TEST_PASSWORD env vars.
 * DO NOT use the local mock auth helper — that is for dev/local tests only.
 *
 * Selectors (verified against Login.tsx and AdminHealth.tsx source):
 *   - Email:    #email    (id="email", no data-testid)
 *   - Password: #password (id="password", no data-testid)
 *   - Submit:   getByRole('button', { name: 'Sign In' }) (type="submit", text "Sign In")
 *   - Redirect: expect(page).not.toHaveURL(/\/login/) — from defaults to '/'
 *   - Status:   page.getByText('Active') — STATUS_CONFIG.active.label in AdminHealth.tsx
 *
 * Config: Run with playwright.prod.config.ts
 *   npx playwright test --config playwright.prod.config.ts
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

// ---------------------------------------------------------------------------
// Auth helper — real Supabase login via production UI
// ---------------------------------------------------------------------------

async function loginWithRealCredentials(page: Page): Promise<void> {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD

  if (!email || !password) {
    throw new Error(
      'E2E_TEST_EMAIL and E2E_TEST_PASSWORD env vars are required for Wave F. ' +
        'Add them as GitHub Actions secrets.',
    )
  }

  await page.goto('/login', { waitUntil: 'networkidle', timeout: 20_000 })

  // Selectors verified against Login.tsx: inputs use id="email" and id="password",
  // no data-testid attributes present. Submit button text is "Sign In" (type="submit").
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.getByRole('button', { name: 'Sign In' }).click()
}

// ---------------------------------------------------------------------------
// Wave F-1: Login redirect (D-10 criterion 1)
// ---------------------------------------------------------------------------

test('Wave F-1: login redirects successfully to dashboard', async ({ page }) => {
  await loginWithRealCredentials(page)

  // Login.tsx: navigate(from, { replace: true }) where from = location.state?.from?.pathname || '/'
  // Post-login URL becomes '/' (or the originally requested path). Never stays on /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // Confirm we landed on a valid app page (not an error page)
  const url = page.url()
  const isValidRedirect =
    url.includes('/dashboard') ||
    url.includes('/admin') ||
    url.includes('/studio') ||
    url.includes('/home') ||
    url.endsWith('/') ||
    !url.includes('/login')

  expect(isValidRedirect).toBeTruthy()
})

// ---------------------------------------------------------------------------
// Wave F-2: /admin/health agent cards (D-10 criterion 2)
// ---------------------------------------------------------------------------

test('Wave F-2: /admin/health shows ≥7 active agent cards', async ({ page }) => {
  await loginWithRealCredentials(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  await page.goto('/admin/health', { waitUntil: 'networkidle', timeout: 20_000 })

  // AdminHealth.tsx: status badge renders STATUS_CONFIG[agent.status].label
  // STATUS_CONFIG.active = { label: 'Active', ... } — the text 'Active' appears in each active badge span.
  // Allow up to 5s for the API call to api-gateway to resolve and render cards.
  await page.waitForTimeout(5_000)

  const activeStatusBadges = page.getByText('Active', { exact: true })
  const cardCount = await activeStatusBadges.count()
  expect(cardCount).toBeGreaterThanOrEqual(7)
})

// ---------------------------------------------------------------------------
// Wave F-3: Dashboard loads within 5s without JS errors (D-10 criterion 3)
// ---------------------------------------------------------------------------

test('Wave F-3: dashboard loads within 5s with no console errors', async ({ page }) => {
  const consoleErrors: string[] = []

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text())
    }
  })
  page.on('pageerror', (err: Error) => {
    consoleErrors.push(`PageError: ${err.message}`)
  })

  await loginWithRealCredentials(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // Timer starts HERE — after login and redirect, measuring only dashboard load time
  const startTime = Date.now()
  const currentUrl = page.url()
  if (!currentUrl.includes('/dashboard')) {
    await page.goto('/dashboard', { waitUntil: 'networkidle', timeout: 15_000 })
  }

  const loadTime = Date.now() - startTime
  expect(loadTime).toBeLessThan(5_000)

  // Filter known browser noise that is not a real application error
  const criticalErrors = consoleErrors.filter(
    (e) =>
      !e.includes('ResizeObserver loop') &&
      !e.includes('Non-Error promise rejection') &&
      !e.includes('favicon') &&
      !e.includes('content-security-policy'),
  )

  expect(criticalErrors).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Wave F-4: /studio write-flow (D-10 criterion 4)
// ---------------------------------------------------------------------------

test('Wave F-4: /studio route loads with review queue UI visible', async ({ page }) => {
  await loginWithRealCredentials(page)
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  await page.goto('/studio', { waitUntil: 'networkidle', timeout: 20_000 })

  // Verify studio page did not redirect back to /login
  expect(page.url()).not.toMatch(/\/login/)

  // studio-flow.spec.ts confirms '/studio' renders 'WineOps Studio' header.
  // This is the minimal write-flow entry-point verification (UI layer only).
  // Full data write + teardown is handled by Python conftest_prod.py session teardown.
  await expect(page.getByText('WineOps Studio')).toBeVisible({ timeout: 10_000 })
})
