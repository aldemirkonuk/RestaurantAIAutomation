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

async function mockGateway(page: Page, papers = 3) {
  let queue = [doc('d1', 'INV-88'), doc('d2', 'INV-89'), doc('d3', 'INV-90')].slice(0, papers)
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
    // The notes under the money (held cost, price moves) exist once the held-read stack is merged:
    // the page reads their shapes, so an empty list is not an answer.
    if (path.endsWith('/held-costs')) return json({ taxBasisKnown: true, held: [] })
    if (path.endsWith('/price-moves')) return json({ thresholdPct: 10, paperCurrency: 'EUR', houseCurrency: 'EUR', lines: [] })
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

/*
 * r110 F5: sealing the LAST paper by keyboard must not leave focus on BODY, and
 * the pane must not collapse under the reader (0.32 shift at 375 before). Focus
 * stays in the "Document detail" pane, which stays mounted; the pane keeps the
 * height the paper had. Layout shift is counted from the key press.
 */
for (const reduced of [false, true]) {
  for (const width of [375, 1440, 1600]) {
    test(`sealing the last paper keeps focus and holds the pane: ${reduced ? 'reduced' : 'motion'} ${width}`, async ({ page }) => {
      test.setTimeout(60000)
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
      await mockAuthState(page, ['developer'])
      await mockGateway(page, 1)
      await page.goto('/receipts')
      await page.getByRole('button', { name: 'Not now' }).click({ timeout: 8000 }).catch(() => {})
      await page.locator('button[data-rc-id]', { hasText: 'INV-88' }).click()
      const swipe = page.getByRole('button', { name: /Swipe up to confirm/ })
      await expect(swipe).toBeEnabled({ timeout: 15000 })
      await swipe.focus()
      await page.evaluate(() => {
        const w = window as unknown as { __cls: number; __src: string[] }
        w.__cls = 0
        w.__src = []
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources: { node: Element | null; previousRect: DOMRect; currentRect: DOMRect }[] }[]) {
            if (e.hadRecentInput) continue
            w.__cls += e.value
            for (const s of e.sources) {
              const n = s.node as HTMLElement | null
              w.__src.push(`${e.value.toFixed(4)} ${n?.tagName}.${(n?.className || '').toString().slice(0, 30)}[${n?.getAttribute?.('aria-label') ?? ''}] ${Math.round(s.previousRect.y)}+${Math.round(s.previousRect.height)} -> ${Math.round(s.currentRect.y)}+${Math.round(s.currentRect.height)}`)
            }
          }
        }).observe({ type: 'layout-shift', buffered: false })
      })
      const paneBefore = await page.getByRole('region', { name: 'Document detail' }).boundingBox()
      await page.keyboard.down('Space')
      const pane = page.getByRole('region', { name: 'Document detail' })
      // Below 2xl "All receipts" takes focus; at 2xl it is hidden and the pane does.
      await expect(width < 1536 ? page.getByRole('button', { name: /^← All receipts$/ }) : pane).toBeFocused({ timeout: 10000 })
      await page.keyboard.up('Space')
      await page.waitForTimeout(600)
      const active = await page.evaluate(() => document.activeElement?.tagName)
      expect(active).not.toBe('BODY')
      const paneAfter = await pane.boundingBox()
      expect(paneAfter!.height).toBeGreaterThanOrEqual(paneBefore!.height - 1)
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
      console.log((await page.evaluate(() => (window as unknown as { __src: string[] }).__src)).join('\n'))
      console.log(`CLS last paper ${reduced ? 'reduced' : 'motion'} ${width}: ${cls.toFixed(4)}`)
      expect(cls).toBeLessThan(0.05)
    })
  }
}
