import { test, expect } from '@playwright/test'

test('renders login page', async ({ page }) => {
  await page.goto('/login')
  // ADR 0149 row 35 / sketch 118 endpaper: brand is the wordmark (img), page title is the leaf h2.
  await expect(page.getByRole('img', { name: 'Mudavym' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByLabel('Email Address')).toBeVisible()
})
