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

  test('register page has form fields', async ({ page }) => {
    await page.goto('/register')
    // Register page should show email and password inputs — validates the route is functional
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#password')).toBeVisible()
  })
})
