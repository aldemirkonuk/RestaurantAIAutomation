import { test, expect } from '@playwright/test'

test('renders login page', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'WineOps AI' })).toBeVisible()
  await expect(page.getByLabel('Email Address')).toBeVisible()
})
