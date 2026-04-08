import { test, expect } from '@playwright/test'
import { mockAuthState } from './auth.setup'

test.describe('Studio Flow', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'WineOps AI' })).toBeVisible()
    await expect(page.getByLabel('Email Address')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
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
