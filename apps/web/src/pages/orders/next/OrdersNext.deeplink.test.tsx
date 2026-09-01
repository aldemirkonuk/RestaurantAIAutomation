/**
 * OrdersNext deep links — the Mudavym half of `/orders`.
 *
 * The dashboard redesign links here from two places with `?highlight=<id>`
 * (DayDetail.tsx:199, WaitingOnYou.tsx:124) and the gateway's own alert
 * payload uses the same shape (dashboard.service.ts:744). OrdersNext read no
 * parameters, so all three opened the ordinary ledger with nothing selected.
 *
 * Three contracts:
 *   - the named row is EXPANDED, and any station filter that would hide it is
 *     cleared first (a delivered order must not stay behind the pending tab);
 *   - a dead id is said in words;
 *   - a `draft=new` payload this page cannot honour is REFUSED out loud,
 *     rather than dropped (ADR 0020) — OrdersNext has no create-order flow.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OrderRowVM } from './useOrdersNextData'

const data = vi.hoisted(() => ({
  rows: [] as OrderRowVM[],
  hasData: true,
  isError: false,
}))

vi.mock('./useOrdersNextData', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useOrdersNextData')>()
  return {
    ...mod,
    useOrdersNextData: () => ({
      rows: data.rows,
      counts: {
        pending: data.rows.filter((r) => r.stage === 'pending').length,
        approved: 0,
        ordered: 0,
        delivered: data.rows.filter((r) => r.stage === 'delivered').length,
      },
      recurringCount: 0,
      cancelledCount: 0,
      month: { thisMonth: 0, lastMonth: 0, unpricedThisMonth: 0 },
      hasData: data.hasData,
      isLoading: false,
      isError: data.isError,
      errorMessage: null,
      refetch: vi.fn(),
    }),
  }
})

// The draft rail fetches on mount and is irrelevant to link handling.
vi.mock('./DraftRail', () => ({ DraftRail: () => <div data-testid="draft-rail" /> }))
vi.mock('./BulkApproveBar', () => ({ BulkApproveBar: () => null }))
vi.mock('./LedgerRow', () => ({
  LedgerRow: ({ row, expanded }: { row: OrderRowVM; expanded: boolean }) => (
    <div data-testid={`row-${row.id}`} data-expanded={expanded ? 'yes' : 'no'}>
      {row.wineName}
    </div>
  ),
}))

import OrdersNext from './OrdersNext'

function row(over: Partial<OrderRowVM> & { id: string }): OrderRowVM {
  return {
    orderNumber: 'PO-1',
    wineName: 'Chablis Premier Cru',
    producer: null,
    providerName: null,
    quantity: 6,
    unitPrice: 40,
    computedTotal: 240,
    listedTotal: 240,
    total: 240,
    stage: 'pending',
    status: 'pending',
    recurring: false,
    recurrenceLabel: null,
    requestedAt: '2026-08-30T10:00:00Z',
    approvedAt: null,
    deliveredAt: null,
    notes: null,
    ...over,
  } as OrderRowVM
}

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <OrdersNext />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  data.rows = [row({ id: 'ord-1' }), row({ id: 'ord-2', stage: 'delivered', status: 'delivered' })]
  data.hasData = true
  data.isError = false
})

describe('?highlight=', () => {
  it('expands the named row', () => {
    at('/orders?highlight=ord-1')
    expect(screen.getByTestId('row-ord-1')).toHaveAttribute('data-expanded', 'yes')
    expect(screen.getByTestId('row-ord-2')).toHaveAttribute('data-expanded', 'no')
    expect(screen.queryByTestId('deep-link-notice')).toBeNull()
  })

  it('reaches a row that is not at the pending station', () => {
    at('/orders?highlight=ord-2')
    expect(screen.getByTestId('row-ord-2')).toHaveAttribute('data-expanded', 'yes')
  })

  it('accepts the ?orderId= spelling too', () => {
    at('/orders?orderId=ord-1')
    expect(screen.getByTestId('row-ord-1')).toHaveAttribute('data-expanded', 'yes')
  })

  it('says so when the id names a deleted order', () => {
    at('/orders?highlight=ord-gone')
    const notice = screen.getByTestId('deep-link-notice')
    expect(notice).toHaveTextContent('ord-gone')
    expect(notice).toHaveTextContent('Nothing below has been filtered or hidden')
    // …and the ledger is still fully there, not blanked.
    expect(screen.getByTestId('row-ord-1')).toBeInTheDocument()
  })

  it('leaves the page untouched with no parameters', () => {
    at('/orders')
    expect(screen.queryByTestId('deep-link-notice')).toBeNull()
    expect(screen.getByTestId('row-ord-1')).toHaveAttribute('data-expanded', 'no')
  })
})

describe('?draft=new on a page with no create-order flow', () => {
  it('refuses out loud instead of silently dropping the payload', () => {
    at('/orders?draft=new&inventoryId=inv-1&qty=6')
    const notice = screen.getByTestId('deep-link-notice')
    expect(notice).toHaveTextContent('no create-order flow')
    expect(notice).toHaveTextContent('Nothing has been drafted')
  })
})
