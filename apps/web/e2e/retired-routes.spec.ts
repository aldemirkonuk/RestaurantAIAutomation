import { test, expect } from '@playwright/test'
import { mockAuthState } from './auth.setup'

/**
 * ADR 0019 §B retired four page routes. This spec is the guard that they stay
 * retired AND stay reachable — the two failure modes pull in opposite directions:
 *
 *   - a resurrected legacy component would make the retirement silently untrue;
 *   - a bookmark that 404s (or lands on the Dashboard via the `*` catch-all)
 *     is a regression for anyone who saved the old URL.
 *
 * `/inventory-legacy` and `/calendar-classic` therefore redirect to their
 * replacements. Every capability they had was ported first, so the redirect
 * lands somewhere that can still do the job — see .planning/06-pages/RETIRED.md.
 *
 * `/wine-agent` and `/wineagent` get no redirect: they were placeholders with no
 * behaviour, nothing in the app ever linked to them, and every in-app "Wine
 * Agent" entry point already navigates to /sommelier.
 */
test.describe('Retired routes (ADR 0019 §B)', () => {
  test('/inventory-legacy redirects to /inventory, which renders', async ({ page }) => {
    await mockAuthState(page)
    await page.goto('/inventory-legacy')
    await page.waitForURL('**/inventory', { timeout: 15000 })
    expect(new URL(page.url()).pathname).toBe('/inventory')
    // The replacement actually mounts — a redirect onto a blank page is not parity.
    await expect(page.getByPlaceholder(/search/i).first()).toBeVisible({ timeout: 15000 })
  })

  test('/calendar-classic redirects to /calendar, which renders', async ({ page }) => {
    await mockAuthState(page)
    await page.goto('/calendar-classic')
    await page.waitForURL('**/calendar', { timeout: 15000 })
    expect(new URL(page.url()).pathname).toBe('/calendar')
  })

  // [2026-09-25: the house shell is live in code for every house (ADR 0149
  // row 36's bracket; `shell` in LIVE_PAGES), so `<Route path="*">` is
  // ShellCatchAll's in-app 404, rendered at the unmatched URL, instead of the
  // legacy layout's silent redirect to `/`. The two tests below used to prove
  // "falls through" by landing on `/`; they now prove it by that 404's own
  // headline. The retirement they guard is unchanged.]
  const notFound = (page: import('@playwright/test').Page, path: string) =>
    page.getByRole('heading', { name: `There is no page at ${path}.` })

  test('the retired paths do not fall through to the catch-all', async ({ page }) => {
    // An unmatched path lands on the catch-all. If either retired path ever
    // loses its redirect it would land there too, which reads to the user as
    // "the app is broken" rather than "the page moved".
    await mockAuthState(page)
    await page.goto('/this-route-does-not-exist')
    await expect(notFound(page, '/this-route-does-not-exist')).toBeVisible({ timeout: 15000 })

    await page.goto('/inventory-legacy')
    await page.waitForURL((url) => new URL(url).pathname !== '/inventory-legacy', {
      timeout: 15000,
    })
    expect(new URL(page.url()).pathname).toBe('/inventory')
    await expect(page.getByRole('heading', { name: /^There is no page at/ })).toHaveCount(0)
  })

  test('/wine-agent and /wineagent no longer render a page of their own', async ({ page }) => {
    await mockAuthState(page)
    for (const retired of ['/wine-agent', '/wineagent']) {
      await page.goto(retired)
      // No redirect (ADR 0019 §B): the catch-all answers, in words.
      await expect(notFound(page, retired)).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(/under construction/i)).toHaveCount(0)
    }
  })
})
