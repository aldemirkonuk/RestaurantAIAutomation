/**
 * F-1368: /orders read a 5,000-order house in 50 serial requests, every
 * minute and on every focus, to count its stages and sum its month, then drew
 * every row. The ledger now reads the newest 100 and older pages only when
 * asked; the spine and the month are the gateway's figures over the whole
 * book; a link to an older order reads that order on its own.
 *
 * Driven through the real hooks with a mocked gateway.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/services/api/client', () => ({
  apiClient: { get },
  getActiveRestaurantId: () => 'r1',
  getErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', isAuthenticated: true, user: { restaurantId: 'r1' } }),
}))
vi.mock('@/contexts/RealtimeContext', () => ({
  useOrdersSubscription: () => {},
}))
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [] }),
}))

import { useOrdersNextData } from './useOrdersNextData'

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'EUR'
const LETTER_ORDER_CURRENCY = 'USD'

const order = (id: string, status = 'PENDING') => ({
  id,
  orderNumber: `ORD-${id}`,
  restaurantId: 'r1',
  inventoryId: 'i1',
  providerId: 'p1',
  quantity: 6,
  status,
  requestedAt: '2026-10-02T12:00:00Z',
  currency: FIXTURE_CURRENCY,
  recurrenceFrequency: null,
})

const SUMMARY = {
  total: 5000,
  counts: { pending: 1200, approved: 300, ordered: 400, delivered: 3000 },
  recurring: 40,
  cancelled: 60,
  refused: 4,
  zone: 'Europe/Istanbul',
  thisMonth: { month: '2026-10', byCurrency: [{ currency: FIXTURE_CURRENCY, amount: 12480 }], unpriced: 2 },
  lastMonth: { month: '2026-09', byCurrency: [{ currency: null, amount: 900 }], unpriced: 0 },
}

let pageGets: number[] = []
let letters: Array<{ id: string; orderId: string }> = []

beforeEach(() => {
  pageGets = []
  letters = []
  get.mockReset()
  get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === '/procurement/conversations/active') return { data: letters }
    if (url === '/procurement/orders' && typeof config?.params?.ids === 'string') {
      const ids = (config.params.ids as string).split(',')
      return { data: { orders: ids.map((id) => ({ ...order(id, 'CONFIRMED'), currency: LETTER_ORDER_CURRENCY })) } }
    }
    if (url === '/procurement/orders') {
      const page = Number(config?.params?.page ?? 1)
      pageGets.push(page)
      const ids = page === 1 ? ['n1', 'n2'] : ['o1']
      return {
        data: {
          orders: ids.map((id) => order(id)),
          total: 5000,
          page,
          limit: 100,
          hasMore: true,
          ...(config?.params?.summary === 'true' ? { summary: SUMMARY } : {}),
        },
      }
    }
    if (url === '/procurement/orders/old-7') return { data: order('old-7', 'DELIVERED') }
    if (url === '/procurement/order-approval-gate') {
      return { data: { readable: false, reason: 'n/a', orders: [] } }
    }
    if (url.startsWith('/settings')) return { data: { readable: true, code: FIXTURE_CURRENCY } }
    return Promise.reject(new Error(`unexpected ${url}`))
  })
})

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useOrdersNextData — the newest orders, the whole book’s figures (F-1368)', () => {
  it('takes the spine and the month from the gateway’s summary, not from the rows it holds', async () => {
    const { result } = renderHook(() => useOrdersNextData(), { wrapper })
    await waitFor(() => expect(result.current.counts.pending).not.toBeNull())
    await waitFor(() => expect(result.current.hasData).toBe(true))

    expect(result.current.rows).toHaveLength(2)
    expect(result.current.counts).toEqual({ pending: 1200, approved: 300, ordered: 400, delivered: 3000 })
    expect(result.current.recurringCount).toBe(40)
    expect(result.current.cancelledCount).toBe(60)
    // Refused trucks are counted apart, never as cancelled (F-669).
    expect(result.current.refusedCount).toBe(4)
    expect(result.current.month.thisMonth).toBe(12480)
    expect(result.current.month.unpricedThisMonth).toBe(2)
    expect(result.current.month.label).toBe('October')
    expect(result.current.totalInBook).toBe(5000)
    // One page of 100, not the whole book page after page.
    expect(pageGets).toEqual([1])
    // The figures ride on the newest page; older pages do not ask for them.
    const listCall = get.mock.calls.find((c) => c[0] === '/procurement/orders')!
    expect(listCall[1].params).toMatchObject({ page: 1, limit: 100, summary: 'true' })
  })

  it('reads older orders only when asked', async () => {
    const { result } = renderHook(() => useOrdersNextData(), { wrapper })
    await waitFor(() => expect(result.current.loadOlder).toBeTypeOf('function'))
    expect(pageGets).toEqual([1])
    act(() => result.current.loadOlder!())
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    expect(pageGets).toEqual([1, 2])
    const older = get.mock.calls.find((c) => c[0] === '/procurement/orders' && c[1]?.params?.page === 2)!
    expect(older[1].params).not.toHaveProperty('summary')
    // The figures do not move with what is loaded.
    expect(result.current.counts.pending).toBe(1200)
  })

  it('opens a linked order that is older than the loaded rows by reading it on its own', async () => {
    const { result } = renderHook(() => useOrdersNextData('old-7'), { wrapper })
    await waitFor(() => expect(result.current.rows.some((r) => r.id === 'old-7')).toBe(true))
    expect(result.current.targetPending).toBe(false)
    expect(get.mock.calls.some((c) => c[0] === '/procurement/orders/old-7')).toBe(true)
    expect(pageGets).toEqual([1])
  })

  it('does not read the order on its own when it is already loaded', async () => {
    const { result } = renderHook(() => useOrdersNextData('n2'), { wrapper })
    await waitFor(() => expect(result.current.hasData).toBe(true))
    expect(result.current.targetPending).toBe(false)
    expect(get.mock.calls.some((c) => String(c[0]).startsWith('/procurement/orders/n2'))).toBe(false)
  })

  it('counts only the loaded window in "the newest N", not a linked order read on its own (F-1432)', async () => {
    const { result } = renderHook(() => useOrdersNextData('old-7'), { wrapper })
    await waitFor(() => expect(result.current.rows.some((r) => r.id === 'old-7')).toBe(true))
    expect(result.current.rows).toHaveLength(3)
    expect(result.current.windowCount).toBe(2)
  })

  it('reads by id an order a drafted letter names outside the window, never into the ledger (F-1439)', async () => {
    letters = [
      { id: 'c-1', orderId: 'n1' },
      { id: 'c-2', orderId: 'old-9' },
    ]
    const { result } = renderHook(() => useOrdersNextData(), { wrapper })
    await waitFor(() => expect(result.current.draftRows?.map((r) => r.id)).toEqual(['old-9']))
    expect(result.current.draftRows![0].currency).toBe(LETTER_ORDER_CURRENCY)
    expect(result.current.rows.some((r) => r.id === 'old-9')).toBe(false)
    const byId = get.mock.calls.find((c) => c[0] === '/procurement/orders' && c[1]?.params?.ids)!
    expect(byId[1].params.ids).toBe('old-9')
  })
})
