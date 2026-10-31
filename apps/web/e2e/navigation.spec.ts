import { test, expect } from '@playwright/test'
import { mockAuthState } from './auth.setup'

test.describe('Navigation Guards', () => {
  test('all protected routes redirect unauthenticated users to /login', async ({ page }) => {
    test.setTimeout(60000)
    // `/` is not here: a stranger there gets the landing page (ADR 0320/0344).
    const protectedRoutes = ['/inventory', '/orders', '/wines', '/reports', '/settings']

    for (const route of protectedRoutes) {
      await page.goto(route)
      await page.waitForURL('**/login', { timeout: 10000 })
      expect(page.url()).toContain('/login')
    }
  })

  test('public routes accessible without auth', async ({ page }) => {
    // /login — should render without redirect (endpaper door, ADR 0149 row 35)
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
    expect(page.url()).toContain('/login')

    // /register — should render without redirect
    await page.goto('/register')
    await expect(page).toHaveURL(/\/register/, { timeout: 10000 })

    // / — a stranger gets the landing page, not /login (ADR 0320/0344)
    await page.goto('/')
    await expect(page.locator('.mdv-landing')).toBeVisible({ timeout: 10000 })
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('unknown route redirects unauthenticated user to /login', async ({ page }) => {
    // App.tsx catch-all (`*` → ShellCatchAll) sits inside the ProtectedRoute
    // layout, which sends an unauthenticated reader to /login
    await page.goto('/this-route-does-not-exist')
    await page.waitForURL('**/login', { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('studio nav tabs are present when authenticated as developer', async ({ page }) => {
    await mockAuthState(page, ['developer'])
    await page.goto('/studio')

    // StudioLayout renders a header with nav links for developer role
    await expect(page.getByText('Mudavym Studio')).toBeVisible({ timeout: 10000 })

    // Developer role gets Queue and Certify nav links in StudioLayout
    await expect(page.getByRole('link', { name: 'Queue' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Certify' })).toBeVisible()
  })

  test('register page exposes account form fields', async ({ page }) => {
    // A bare /register is the landing page (ADR 0344); the landing's "Start
    // free" opens the create flow at `?type=new`, straight to step 1.
    await page.goto('/register?type=new')
    // Create flow step 1 ("Your Account") inputs are reachable through their
    // associated labels (htmlFor/id) — this test guards that association.
    await expect(page.getByLabel('Full Name')).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel('Email')).toBeVisible()
    // Anchored regex: a bare 'Password' substring would also match "Confirm Password *"
    await expect(page.getByLabel(/^Password \*$/)).toBeVisible()
    await expect(page.getByLabel('Confirm Password')).toBeVisible()
  })
})
