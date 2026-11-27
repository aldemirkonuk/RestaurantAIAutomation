import { test, expect, type Page } from '@playwright/test'
import { mockAuthState } from './auth.setup'

/**
 * A keyboard seal hands focus to the next paper's row IN A REAL BROWSER.
 * jsdom cannot see this: completing the hold disables the handle, and Chrome
 * then drops focus to BODY before onConfirm runs (r108 walk, finding 1).
 * The gateway is mocked here; the focus behaviour is not.
 */
const doc = (id: string, n: string) => ({
  id, doc_type: 'invoice', source_channel: 'email', doc_number: n, doc_date: '2026-08-28',
  status: 'needs_review', currency: 'EUR', total: 220.8, freight: null, fuel_surcharge: null,
  split_case_fee: null, delivery_fee: null, tax: null, other_charges: null, ties_out: null,
  tie_out_delta: null, extraction_confidence: null, notes: null,
  created_at: '2026-08-28T10:00:00Z', order_id: null,
})
const LINE = {
  id: 'l1', line_no: 1, vendor_sku: null, description: 'Albarino 2022', vintage: 2022, qty: 12,
  uom: 'cs', pack_size: 12, qty_bottles: 12, free_goods_qty: 0, unit_price: 18.4,
  line_total: 220.8, order_line_id: null, allowance: null,
}

async function mockGateway(page: Page) {
  let queue = [doc('d1', 'INV-88'), doc('d2', 'INV-89'), doc('d3', 'INV-90')]
  await page.route('**/api/v1/**', (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^.*\/api\/v1/, '')
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/auth/me')) return route.fallback()
    if (path === '/procurement/documents' && req.method() === 'GET') {
      return json({ items: url.searchParams.get('status') === 'needs_review' ? queue : [] })
    }
    const one = path.match(/^\/procurement\/documents\/([^/]+)$/)
    if (one && req.method() === 'GET') {
      const d = queue.find((q) => q.id === one[1])
      return d ? json({ document: d, lines: [LINE], links: [] }) : json({ message: 'gone' }, 404)
    }
    // The formatted sheet is not under test: a spoken refusal, which the page tolerates.
    if (path.endsWith('/canonical')) return json({ message: 'The formatted paper is not available.' }, 404)
    if (path.endsWith('/verify-seal-challenge')) return json({ challenge: 'seal-token' })
    const verify = path.match(/^\/procurement\/documents\/([^/]+)\/verify$/)
    if (verify && req.method() === 'POST') {
      queue = queue.filter((q) => q.id !== verify[1])
      return json({ ok: true })
    }
    // Everything else the page reads is optional here: an empty answer.
    return json(req.method() === 'GET' ? { items: [] } : {})
  })
}

/*
 * Below 2xl an open paper hides the list, so the next paper's pane takes focus;
 * from 2xl up the list is beside it and the next ROW takes focus. Either way j
 * keeps walking with no Tab back, and a pointer seal never moves focus.
 */
for (const [name, width, landing] of [
  ['1280 (list hidden)', 1280, 'detail'],
  ['1600 (list beside)', 1600, 'row'],
] as const) {
  test(`a keyboard seal hands focus on, and j moves the selection: ${name}`, async ({ page }) => {
    test.setTimeout(60000)
    await page.setViewportSize({ width, height: 900 })
    await mockAuthState(page, ['developer'])
    await mockGateway(page)
    await page.goto('/receipts')
    // First-run theme ask: closing it is not an answer and writes nothing.
    await page.getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => {})

    const row = (n: string) => page.locator('button[data-rc-id]', { hasText: n })
    const pane = page.getByRole('region', { name: 'Document detail' })
    const open = () => page.locator('button[data-rc-id][aria-pressed="true"]')
    await row('INV-88').click()
    const swipe = page.getByRole('button', { name: /Swipe up to confirm/ })
    await expect(swipe).toBeEnabled({ timeout: 15000 })
    await swipe.focus()
    await page.keyboard.down('Space')
    // The hold is a countdown: the seal completes while the key is still down.
    if (landing === 'row') await expect(row('INV-89')).toBeFocused({ timeout: 10000 })
    else await expect(pane).toBeFocused({ timeout: 10000 })
    await page.keyboard.up('Space')

    await expect(open()).toContainText('INV-89')
    await page.keyboard.press('j')
    if (landing === 'row') {
      // With the list beside, j moves the roving focus and Enter opens.
      await expect(row('INV-90')).toBeFocused()
      await expect(open()).toContainText('INV-89')
    } else {
      // From the pane there is no row to move: j opens the next paper.
      await expect(open()).toContainText('INV-90')
      await expect(pane).toBeFocused()
    }
  })
}
