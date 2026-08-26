import { test, expect } from '@playwright/test'
import { mockAuthState } from './auth.setup'

test.describe('Studio Flow', () => {
  // Identity-first sign-in (ADR 0024) made this two steps: the page asks who
  // you are, then shows the methods that identity actually has. Password is
  // rendered only at step 2, after POST /auth/sign-in-methods answers — so
  // asserting it on first paint, as this test used to, now fails correctly.
  //
  // E2E runs with no gateway behind the vite proxy, so step 2 is not reachable
  // here. Asserting step 1 honestly beats mocking a backend to keep a stale
  // assertion alive.
  test('login page renders step one: identify yourself', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'WineOps AI' })).toBeVisible()
    await expect(page.getByLabel('Email Address')).toBeVisible()
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible()

    // The password field must NOT be present yet. This is the assertion that
    // would catch a regression back to the one-step form, where a domain
    // heuristic decided your provider for you.
    await expect(page.getByLabel('Password')).toHaveCount(0)
  })

  test('unauthenticated user redirected from /studio to /login', async ({ page }) => {
    await page.goto('/studio')
    await page.waitForURL('**/login', { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('/studio page renders with auth state (developer role)', async ({ page }) => {
    await mockAuthState(page, ['developer'])
    await page.goto('/studio')

    // ProtectedRoute passes through when authenticated with correct role.
    // Studio renders StudioLayout with "WineOps Studio" header — assert this is visible.
    // If the Studio component itself errors (backend down), the header still renders.
    await expect(page.getByText('WineOps Studio')).toBeVisible({ timeout: 10000 })

    // Confirm the page did NOT redirect to /login
    expect(page.url()).not.toContain('/login')
  })

  test('/studio/queue blocked for certified_contributor role', async ({ page }) => {
    // certified_contributor can access /studio but NOT /studio/queue (requires developer/review_admin)
    await mockAuthState(page, ['certified_contributor'])
    await page.goto('/studio/queue')

    // ProtectedRoute shows "Studio Access Required" UI — user is authenticated but lacks the role
    await expect(page.getByText('Studio Access Required')).toBeVisible({ timeout: 10000 })
    expect(page.url()).not.toContain('/login')
  })
})
