import { test, expect, type Page } from '@playwright/test'
import { mockAuthState } from './auth.setup'

/**
 * Seal a paper, and the next one opens: nothing the reader is looking at moves
 * (r110 F1). jsdom has no layout, so this is the only place the shift is seen.
 * The next paper has a different number of lines from the sealed one on
 * purpose: that is what moved the swipe block in the r109 walk (654 -> 418 px).
 * Counted from the key press until the next paper's lines have landed and the
 * card has settled. Reduced motion asks for no animation at all (ADR 0112); the
 * motion cells hold the same ceiling.
 */
const doc = (id: string, n: string, lineCount: number) => ({
  id, doc_type: 'invoice', source_channel: 'email', doc_number: n, doc_date: '2026-08-28',
  status: 'needs_review', currency: 'EUR', total: 220.8, freight: null, fuel_surcharge: null,
  split_case_fee: null, delivery_fee: null, tax: null, other_charges: null, ties_out: null,
  tie_out_delta: null, extraction_confidence: null, notes: null,
  created_at: '2026-08-28T10:00:00Z', order_id: null, line_count: lineCount,
})
const line = (i: number) => ({
  id: 'l' + i, line_no: i, vendor_sku: null, description: 'Albarino 2022 no ' + i, vintage: 2022,
  qty: 12, uom: 'cs', pack_size: 12, qty_bottles: 12, free_goods_qty: 0, unit_price: 18.4,
  line_total: 220.8, order_line_id: null, allowance: null,
})

/**
 * A real /canonical body (not a promise that never settles: that kept the sheet
 * on "Reading the document…" for BOTH papers, so the collapse the walk measured
 * could never happen). Both papers carry the same number of sheet lines, so the
 * only height change under test is the one the swap itself causes.
 */
const env = (value: unknown) => ({ value, source: 'extracted', confidence: null, revision: 1 })
const party = () => ({ name: env('SYNTHETIC Vendor'), vatIdentifier: env('0000000000'), identifier: env(null), address: env(null), electronicAddress: env(null) })
const canonicalFor = (id: string, number: string) => ({
  canonical: {
    documentId: id, restaurantId: 'rest-syn', docType: 'invoice', direction: 'issued_by_vendor', jurisdiction: 'US', revision: 1,
    layer1: {
      documentNumber: env(number), issueDate: env('2026-08-28'), typeCode: env('380'), currency: env('EUR'),
      paymentDueDate: env(null), paymentTerms: env(null), seller: party(), buyer: party(),
      purchaseOrderReference: env(null), despatchAdviceReference: env(null), precedingInvoiceReference: env(null),
      actualDeliveryDate: env(null), deliveryLocation: env(null),
      lines: Array.from({ length: 3 }, (_, i) => ({
        lineId: env(null), description: env('Albarino 2022 no ' + (i + 1)), sellerItemId: env(null), quantity: env(12), unit: env('case'),
        netPrice: env(18.4), priceBaseQuantity: env(12), priceBaseUnit: env('bottle'), netAmount: env(220.8),
        allowancesCharges: [], vatCategory: env(null), vatRate: env(null), vintage: env(2022), lot: env(null), formatMl: env(750), freeGoodsQty: env(0),
      })),
      allowancesCharges: [],
      totals: { linesNetTotal: env(220.8), allowancesTotal: env(0), chargesTotal: env(0), taxExclusiveAmount: env(220.8), taxAmount: env(null), taxInclusiveAmount: env(220.8), paidAmount: env(null), roundingAmount: env(null), amountDue: env(220.8) },
      vatBreakdown: [],
    },
    layer2: { providerId: null, vendorResolution: null, lines: [] },
    layer3: { lines: [], tiesOut: true, tieOutDeltaCents: 0, verdicts: [] },
  },
  deliveries: [], siblings: [], corrections: [],
  original: { imageUrl: null, reason: 'no original was stored for this document', contentType: null, filename: null, pages: null },
  intake: { status: 'needs_review', verdict: null, reason: null, sourceChannel: 'upload', extractionModel: null, sha256: 'abc', createdAt: '2026-08-28T10:00:00Z' },
})

async function mock(page: Page, counts: number[]) {
  let queue = counts.map((c, i) => doc('d' + (i + 1), 'INV-' + (88 + i), c))
  await page.route('**/api/v1/**', async (route) => {
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
      await new Promise((r) => setTimeout(r, 1200))
      const d = queue.find((q) => q.id === one[1])
      if (!d) return json({ message: 'gone' }, 404)
      return json({ document: d, lines: Array.from({ length: d.line_count }, (_, i) => line(i + 1)), links: [] })
    }
    if (path.endsWith('/held-costs')) return json({ taxBasisKnown: true, held: [] })
    if (path.endsWith('/price-moves')) return json({ thresholdPct: 10, paperCurrency: 'EUR', houseCurrency: 'EUR', lines: [] })
    // The first paper's sheet answers at once; the next one's answers late, as
    // the real gateway did in the walk. The held height must cover that gap.
    const sheet = path.match(/^\/procurement\/documents\/([^/]+)\/canonical$/)
    if (sheet) {
      const d = queue.find((q) => q.id === sheet[1]) ?? doc(sheet[1], 'INV-?', 1)
      if (sheet[1] !== 'd1') await new Promise((r) => setTimeout(r, 800))
      return json(canonicalFor(d.id, d.doc_number))
    }
    if (path.endsWith('/verify-seal-challenge')) return json({ challenge: 'seal-token' })
    const verify = path.match(/^\/procurement\/documents\/([^/]+)\/verify$/)
    if (verify && req.method() === 'POST') {
      queue = queue.filter((q) => q.id !== verify[1])
      return json({ ok: true })
    }
    return json(req.method() === 'GET' ? { items: [] } : {})
  })
}

for (const reduced of [false, true]) {
  for (const width of [375, 1440]) {
    for (const counts of [[3, 1, 5], [1, 5, 3]]) {
      test(`seal then next paper, CLS under 0.05: ${reduced ? 'reduced' : 'motion'} ${width} px, ${counts[0]} -> ${counts[1]} lines`, async ({ page }) => {
        test.setTimeout(90000)
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
        await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
        await mockAuthState(page, ['developer'])
        await mock(page, counts)
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
                w.__src.push(`${e.value.toFixed(4)} ${n?.tagName}.${(n?.className || '').toString().slice(0, 24)} ${Math.round(s.previousRect.y)}+${Math.round(s.previousRect.height)} -> ${Math.round(s.currentRect.y)}+${Math.round(s.currentRect.height)}`)
              }
            }
          }).observe({ type: 'layout-shift', buffered: false })
        })
        await page.keyboard.down('Space')
        await expect(page.locator('button[data-rc-id][aria-pressed="true"]')).toContainText('INV-89', { timeout: 15000 })
        await page.keyboard.up('Space')
        await page.getByTestId('lines-wait-row').first().waitFor()
        const swipeTop = () => swipe.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
        const topBefore = await swipeTop()
        await page.getByLabel('Quantity, line 1', { exact: true }).waitFor({ timeout: 10000 })
        await page.waitForTimeout(1200)
        const topAfter = await swipeTop()
        console.log(`SWIPE top ${topBefore} -> ${topAfter}`)
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
        console.log((await page.evaluate(() => (window as unknown as { __src: string[] }).__src)).join('\n'))
        console.log(`CLS seal->next ${reduced ? 'reduced' : 'motion'} ${width} ${counts.join('>')}: ${cls.toFixed(4)}`)
        expect(cls).toBeLessThan(0.05)
        // The handle the reader is about to use stays where it was while the lines land.
        expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(2)
      })
    }
  }
}
