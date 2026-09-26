/**
 * The paper trail — ADR 0160 §112, fork 6 as answered 2026-09-18 ("Always on
 * the record, loaded fresh"). Every sighting listed, newest first, with the
 * paper it can open and the paper it cannot named, never hidden (ADR 0020).
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { VendorObservationRow } from '../../../services/api/vendorIntel'
import { PaperTrail, trailOrder } from './PaperTrail'

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'USD'

function obs(over: Partial<VendorObservationRow> = {}): VendorObservationRow {
  return {
    id: 'obs-1',
    vendorName: 'Empire',
    providerId: null,
    sourceType: 'quote',
    sourceUrl: null,
    sourceRef: null,
    comparisonClass: 'quoted',
    rawPrice: 30,
    currency: FIXTURE_CURRENCY,
    trustTier: 2,
    packSize: 1,
    unitVolumeMl: 750,
    observedAt: '2026-09-20T10:00:00.000Z',
    parseConfidence: null,
    isOutlier: false,
    outlierReason: null,
    note: null,
    identityId: null,
    identityLabel: null,
    normalizedUnitPrice: 30,
    provenance: { document: null, documentLine: null, message: null, person: null, sentences: [] },
    ...over,
  }
}

describe('trailOrder', () => {
  it('puts the newest sighting first and keeps gateway order on a tie', () => {
    const rows = [
      obs({ id: 'old', observedAt: '2026-09-01T00:00:00.000Z' }),
      obs({ id: 'new', observedAt: '2026-09-22T00:00:00.000Z' }),
      obs({ id: 'tie-a', observedAt: '2026-09-10T00:00:00.000Z' }),
      obs({ id: 'tie-b', observedAt: '2026-09-10T00:00:00.000Z' }),
    ]
    expect(trailOrder(rows).map((r) => r.id)).toEqual(['new', 'tie-a', 'tie-b', 'old'])
  })

  it('sinks an unparseable date to the bottom rather than throwing it away', () => {
    const rows = [obs({ id: 'bad', observedAt: 'not a date' }), obs({ id: 'ok' })]
    expect(trailOrder(rows).map((r) => r.id)).toEqual(['ok', 'bad'])
  })
})

describe('PaperTrail', () => {
  it('lists every sighting across classes, a struck one included and marked', () => {
    render(
      <PaperTrail
        rows={[
          obs({ id: 'q', vendorName: 'Empire' }),
          obs({ id: 'p', vendorName: 'Wine.com', comparisonClass: 'public_site', sourceType: 'website_scrape', sourceUrl: 'https://example.test/w' }),
          obs({ id: 'x', vendorName: 'Suspicious Co', isOutlier: true, outlierReason: '30x the trailing median' }),
        ]}
        windowDays={365}
        complete
        onOpen={vi.fn()}
      />,
    )
    const lines = screen.getAllByTestId('vp-trail-line')
    expect(lines).toHaveLength(3)
    const struck = lines.find((l) => within(l).queryByText(/Suspicious Co/))
    expect(struck).toBeDefined()
    expect(within(struck as HTMLElement).getByText('set aside')).toBeInTheDocument()
  })

  it("links the house's own paper to its order and says the literal fact behind the badge", () => {
    render(
      <PaperTrail
        rows={[obs({ id: 'r', sourceType: 'invoice', sourceRef: 'receipt_verified:ord-42' })]}
        windowDays={365}
        complete
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByRole('link', { name: 'Open the order and its receipt' })).toHaveAttribute('href', '/receiving/ord-42/door')
    expect(screen.getByText(/receipt verified by this house/)).toBeInTheDocument()
  })

  it('names what a line cannot open instead of leaving a blank', () => {
    render(
      <PaperTrail
        rows={[obs({ id: 'h', sourceType: 'manual' }), obs({ id: 'c', sourceType: 'chat', vendorName: 'Rep Ali' })]}
        windowDays={365}
        complete
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getAllByText('No paper attached. This row has nothing to open.').length).toBeGreaterThan(0)
    expect(screen.getByText('No message or person was named when this price was recorded.')).toBeInTheDocument()
  })

  it('draws the paper, its line, the message and the person on the line, without a click (fork 6a)', () => {
    render(
      <PaperTrail
        rows={[
          obs({
            id: 'full',
            sourceType: 'invoice',
            sourceRef: 'receipt_verified:ord-7',
            provenance: {
              document: { id: 'doc-9', docType: 'invoice', docNumber: 'F-2201', docDate: '2026-09-19', sourceChannel: 'upload', status: 'verified' },
              documentLine: { id: 'l-3', lineNo: 3, description: 'Barolo Riserva', unitPrice: 30, qty: 12, uom: 'bottle' },
              message: { id: 'm-1', channel: 'email', direction: 'inbound', at: '2026-09-18T08:00:00Z', subject: 'Re: Barolo', excerpt: '30 a bottle this week', textDeletedAt: null, orderId: 'ord-7' },
              person: { name: 'Ayşe Demir', address: 'ayse@vendor.test', role: 'Sales rep', basis: 'message_sender' },
              sentences: ['Read from invoice F-2201, line 3, the line paired with this order\'s line.'],
            },
          }),
        ]}
        windowDays={365}
        complete
        onOpen={vi.fn()}
      />,
    )
    const list = screen.getByTestId('vp-provenance')
    expect(within(list).getByText(/Invoice F-2201, dated 19 Sept? 2026/)).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'Open the paper' })).toHaveAttribute('href', '/documents/doc-9')
    expect(within(list).getByText('Line 3 — Barolo Riserva — 12 bottle at 30.00 on the paper')).toBeInTheDocument()
    expect(within(list).getByText(/Email received .* — “Re: Barolo”/)).toBeInTheDocument()
    expect(within(list).getByText('30 a bottle this week')).toBeInTheDocument()
    expect(within(list).getByText('From Ayşe Demir <ayse@vendor.test>, Sales rep')).toBeInTheDocument()
    expect(within(list).getByText(/the line paired with this order's line/)).toBeInTheDocument()
  })

  it("prints the gateway's own sentence for a failed read, never 'no paper'", () => {
    render(
      <PaperTrail
        rows={[
          obs({
            id: 'failed',
            provenance: {
              document: null,
              documentLine: null,
              message: null,
              person: null,
              sentences: ['The paper could not be read just now (timeout). This is a failed read, not a missing paper.'],
            },
          }),
        ]}
        windowDays={365}
        complete
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText(/This is a failed read, not a missing paper\./)).toBeInTheDocument()
  })

  it('says it was not told, when an older server sends no provenance at all', () => {
    render(<PaperTrail rows={[obs({ id: 'old', provenance: undefined })]} windowDays={365} complete onOpen={vi.fn()} />)
    expect(screen.getByText(/was not sent by the server\. Unknown, not absent\./)).toBeInTheDocument()
  })

  it('says an empty trail is empty, not unread', () => {
    render(<PaperTrail rows={[]} windowDays={90} complete onOpen={vi.fn()} />)
    expect(screen.getByText(/No paper on this bottle in the last 90 days/)).toBeInTheDocument()
    expect(screen.getByText(/an empty trail, not an unread one/)).toBeInTheDocument()
  })

  it("says so when the gateway's cap cut the read short", () => {
    render(<PaperTrail rows={[obs()]} windowDays={365} complete={false} onOpen={vi.fn()} />)
    expect(screen.getByText(/stopped at the gateway’s cap/)).toBeInTheDocument()
  })

  it('opens the full sighting from a line', () => {
    const onOpen = vi.fn()
    const row = obs({ id: 'open-me', vendorName: 'Empire' })
    render(<PaperTrail rows={[row]} windowDays={365} complete onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Open the sighting from Empire/ }))
    expect(onOpen).toHaveBeenCalledWith(row)
  })
})
