import { test, expect, type Page } from '@playwright/test'
import { mockAuthState, MOCK_USER } from './auth.setup'

/**
 * Opening a paper does not move the seal and the money when its lines arrive
 * (r108 walk finding 2: the Lines card grew 67 -> 165 px at 375). The reserve is
 * three lines at the real row height, so a three-line paper must not shift at
 * all; the other lengths are reported, not asserted.
 */
const doc = (id: string, n: string) => ({
  id, doc_type: 'invoice', source_channel: 'email', doc_number: n, doc_date: '2026-08-28',
  status: 'needs_review', currency: 'EUR', total: 220.8, freight: null, fuel_surcharge: null,
  split_case_fee: null, delivery_fee: null, tax: null, other_charges: null, ties_out: null,
  tie_out_delta: null, extraction_confidence: null, notes: null,
  created_at: '2026-08-28T10:00:00Z', order_id: null,
})
const line = (i: number) => ({
  id: 'l' + i, line_no: i, vendor_sku: null, description: 'Albarino 2022 number ' + i, vintage: 2022,
  qty: 12, uom: 'cs', pack_size: 12, qty_bottles: 12, free_goods_qty: 0, unit_price: 18.4,
  line_total: 220.8, order_line_id: null, allowance: null,
})

async function mock(page: Page, nLines: number, role: string) {
  const queue = [doc('d1', 'INV-88'), doc('d2', 'INV-89')]
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/api\/v1/, '')
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/auth/me')) return json({ user: { ...MOCK_USER, role } })
    if (path === '/procurement/documents') {
      return json({ items: url.searchParams.get('status') === 'needs_review' ? queue : [] })
    }
    const one = path.match(/^\/procurement\/documents\/([^/]+)$/)
    if (one) {
      // The lines arrive after the card has painted: that is the shift under test.
      await new Promise((r) => setTimeout(r, 1200))
      return json({ document: queue.find((q) => q.id === one[1]), lines: Array.from({ length: nLines }, (_, i) => line(i + 1)), links: [] })
    }
    // The formatted sheet is not under test and a refusal paints a note that moves the card:
    // leave its read pending, so the sheet holds its reading state for the whole test.
    if (path.endsWith('/canonical')) return new Promise<void>(() => {})
    return json(req.method() === 'GET' ? { items: [] } : {})
  })
}

for (const role of ['owner', 'manager']) {
  for (const reduced of [false, true]) {
    for (const width of [375, 1440]) {
      for (const n of [1, 3, 5]) {
        test(`${role} ${reduced ? 'reduced' : 'motion'} ${width} px, ${n} line(s)`, async ({ page }) => {
          test.setTimeout(60000)
          // Tall on purpose: layout shift only counts what is on screen, and the seal sits below the lines.
          await page.setViewportSize({ width, height: 2400 })
          await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
          await mockAuthState(page, ['developer'])
          await mock(page, n, role)
          await page.goto('/receipts')
          await page.getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => {})
          const row = page.locator('button[data-rc-id]', { hasText: 'INV-88' })
          await row.waitFor()
          // Count shifts from the opening of the paper only.
          await page.evaluate(() => {
            const w = window as unknown as { __cls: number }
            w.__cls = 0
            new PerformanceObserver((list) => {
              for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
                if (!e.hadRecentInput) w.__cls += e.value
              }
            }).observe({ type: 'layout-shift', buffered: false })
          })
          const clsNow = () => page.evaluate(() => (window as unknown as { __cls: number }).__cls)
          await row.click()
          await page.getByText('Reading the lines').waitFor({ timeout: 10000 })
          await page.waitForTimeout(400)
          const opening = await clsNow()
          await page.getByLabel('Quantity, line 1').waitFor({ timeout: 10000 })
          await page.waitForTimeout(500)
          const arrival = (await clsNow()) - opening
          console.log(`CLS ${role} ${reduced ? 'reduced' : 'motion'} ${width} x${n}: opening ${opening.toFixed(4)} lines-arrive ${arrival.toFixed(4)}`)
          if (n === 3) expect(arrival).toBeLessThan(0.002)
        })
      }
    }
  }
}
