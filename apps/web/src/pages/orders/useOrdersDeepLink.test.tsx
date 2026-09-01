/**
 * `/orders?…` receiving side.
 *
 * Before this hook existed, `/orders` called `useSearchParams` nowhere, so
 * every one of the six emitters below navigated to an unfiltered ledger and
 * the click looked as though it had worked. These tests fix the contract for
 * each payload, including the three ways the NEW-038/039 reorder link can be
 * malformed — each of which must refuse OUT LOUD rather than opening an empty
 * draft (ADR 0020).
 */

import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useOrdersDeepLink, parseDraftPayload, draftLinesMissingMessage } from './useOrdersDeepLink'

interface Row {
  order_id: string
}
const ORDERS: Row[] = [{ order_id: 'ord-1' }, { order_id: 'ord-2' }]
const idOf = (row: Row) => row.order_id

function at(url: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  )
}

function render(url: string, opts?: { orders?: Row[] | undefined; ready?: boolean }) {
  return renderHook(
    () =>
      useOrdersDeepLink<Row>({
        orders: opts && 'orders' in opts ? opts.orders : ORDERS,
        ready: opts?.ready ?? true,
        idOf,
      }),
    { wrapper: at(url) },
  )
}

describe('order identity parameters', () => {
  it('resolves ?orderId= (Dashboard.tsx:917 / OneTapActionCenter.tsx:189)', () => {
    const { result } = render('/orders?orderId=ord-2')
    expect(result.current.order).toEqual({
      status: 'found',
      value: 'ord-2',
      target: { order_id: 'ord-2' },
    })
    expect(result.current.missingMessage).toBeNull()
  })

  it('resolves ?highlight= (DayDetail.tsx:199 / WaitingOnYou.tsx:124)', () => {
    const { result } = render('/orders?highlight=ord-1')
    expect(result.current.order.status).toBe('found')
  })

  it('resolves ?order= (ReceivingHome.tsx:268 / RcManagerQueue.tsx:331)', () => {
    const { result } = render('/orders?order=ord-1')
    expect(result.current.order.status).toBe('found')
  })

  it('says so when the order id no longer exists', () => {
    const { result } = render('/orders?orderId=ord-deleted')
    expect(result.current.order.status).toBe('missing')
    expect(result.current.missingMessage).toContain('ord-deleted')
    expect(result.current.missingMessage).toContain('Nothing below has been filtered')
  })

  it('does NOT claim missing while the orders query is still loading', () => {
    const { result } = render('/orders?orderId=ord-deleted', { orders: [], ready: false })
    expect(result.current.order.status).toBe('pending')
    expect(result.current.missingMessage).toBeNull()
  })

  it('opens the comms thread only for an order that actually resolved', () => {
    expect(render('/orders?orderId=ord-1&action=thread').result.current.openThread).toBe(true)
    expect(render('/orders?orderId=ord-gone&action=thread').result.current.openThread).toBe(false)
  })

  it('is inert with no parameters at all', () => {
    const { result } = render('/orders')
    expect(result.current.order).toEqual({ status: 'idle' })
    expect(result.current.draft).toBeNull()
    expect(result.current.missingMessage).toBeNull()
  })
})

describe('the NEW-038/039 reorder payload', () => {
  it('parses the single-item form (Dashboard.tsx:982, RowExpansion.tsx:215)', () => {
    const { result } = render('/orders?draft=new&inventoryId=inv-9&qty=12&from=dashboard')
    expect(result.current.draft).toEqual([{ inventoryId: 'inv-9', qty: 12 }])
    expect(result.current.missingMessage).toBeNull()
  })

  it('parses the multi-item form (Dashboard.tsx:180)', () => {
    const { result } = render('/orders?draft=new&inventoryIds=a,b,c&qtys=6,12,3')
    expect(result.current.draft).toEqual([
      { inventoryId: 'a', qty: 6 },
      { inventoryId: 'b', qty: 12 },
      { inventoryId: 'c', qty: 3 },
    ])
  })

  it('leaves other pages’ `draft` values alone', () => {
    // Notifications.tsx:1241 sends a conversation id; Recommendations.tsx:113
    // sends `draft=1`. Neither means "start a new order".
    expect(render('/orders?draft=conv-77').result.current.draft).toBeNull()
    expect(render('/orders?draft=1').result.current.draft).toBeNull()
    expect(render('/orders?draft=conv-77').result.current.missingMessage).toBeNull()
  })
})

describe('parseDraftPayload refusals', () => {
  const base = {
    wantsDraft: true,
    singleInventoryId: null,
    singleQty: null,
    multiInventoryIds: null,
    multiQtys: null,
  }

  it('refuses a draft link that named no items', () => {
    const out = parseDraftPayload(base)
    expect(out.lines).toBeNull()
    expect(out.problem).toContain('named no items')
    expect(out.problem).toContain('nothing has been added')
  })

  it('refuses mismatched ids and quantities rather than guessing', () => {
    const out = parseDraftPayload({ ...base, multiInventoryIds: 'a,b', multiQtys: '6' })
    expect(out.lines).toBeNull()
    expect(out.problem).toContain('2 item(s)')
    expect(out.problem).toContain('1 quantity')
  })

  it('refuses a quantity that is not a number of bottles', () => {
    for (const bad of ['NaN', '0', '-3', '2.5', 'six']) {
      const out = parseDraftPayload({ ...base, singleInventoryId: 'a', singleQty: bad })
      expect(out.lines, `qty=${bad}`).toBeNull()
      expect(out.problem, `qty=${bad}`).toContain('not')
    }
  })

  it('is silent when the link is not a draft link', () => {
    expect(parseDraftPayload({ ...base, wantsDraft: false })).toEqual({
      lines: null,
      problem: null,
    })
  })
})

describe('draftLinesMissingMessage', () => {
  it('names one dead inventory id', () => {
    expect(draftLinesMissingMessage(['inv-9'])).toContain('inv-9')
  })

  it('names several, with the count', () => {
    const message = draftLinesMissingMessage(['a', 'b'])
    expect(message).toContain('2 inventory items')
    expect(message).toContain('a, b')
    expect(message).toContain('left out of the draft')
  })
})
