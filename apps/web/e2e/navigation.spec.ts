import { test, expect } from '@playwright/test'
import { mockAuthState } from './auth.setup'

test.describe('Navigation Guards', () => {
  test('all protected routes redirect unauthenticated users to /login', async ({ page }) => {
    test.setTimeout(60000)
    const protectedRoutes = ['/', '/inventory', '/orders', '/wines', '/reports', '/settings']

    for (const route of protectedRoutes) {
      await page.goto(route)
      await page.waitForURL('**/login', { timeout: 10000 })
      expect(page.url()).toContain('/login')
    }
  })

  test('public routes accessible without auth', async ({ page }) => {
    // /login — should render without redirect
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'WineOps AI' })).toBeVisible()
    expect(page.url()).toContain('/login')

    // /register — should render without redirect
    await page.goto('/register')
    await expect(page).toHaveURL(/\/register/, { timeout: 10000 })
  })

  test('unknown route redirects unauthenticated user to /login', async ({ page }) => {
    // App.tsx catch-all: /* → <Navigate to="/" replace />
    // / is protected → ProtectedRoute redirects to /login for unauthenticated users
    await page.goto('/this-route-does-not-exist')
    await page.waitForURL('**/login', { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('studio nav tabs are present when authenticated as developer', async ({ page }) => {
    await mockAuthState(page, ['developer'])
    await page.goto('/studio')

    // StudioLayout renders a header with nav links for developer role
    await expect(page.getByText('WineOps Studio')).toBeVisible({ timeout: 10000 })

    // Developer role gets Queue and Certify nav links in StudioLayout
    await expect(page.getByRole('link', { name: 'Queue' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Certify' })).toBeVisible()
  })

  test('register page exposes account form fields', async ({ page }) => {
    await page.goto('/register')
    // Register opens on a path selector ("Join Your Team" / "Open a Restaurant");
    // the email/password inputs render only after choosing a flow. The
    // "Open a Restaurant" (create) flow shows the account form (email + password)
    // directly in step 1.
    await expect(page.getByText('Open a Restaurant').first()).toBeVisible({
      timeout: 10000,
    })
    await page.getByText('Open a Restaurant').first().click()
    // Create flow step 1 ("Your Account") exposes email + password inputs
    // (type-based; the inputs carry no ids or associated labels).
    await expect(page.locator('input[type="email"]').first()).toBeVisible({
      timeout: 10000,
    })
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
  })
})
