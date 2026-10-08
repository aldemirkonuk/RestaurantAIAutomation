/**
 * The order-book runner and hook (ADR 0269, F-140), with a real QueryClient
 * set up as App.tsx sets it up, and a fake gateway.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../services/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api/client')>()
  return { ...actual, apiClient: { get: vi.fn() } }
})

import { useAuth } from '../../contexts/AuthContext'
import { apiClient } from '../../services/api/client'
import { queryKeys } from '../../lib/query-keys'
import {
  BookShapeError,
  ForeignRowError,
  HouseChangedError,
  RateLimitedError,
  type OrderBook,
} from '../../services/api/order-book'
import {
  BOOK_BACKGROUND_GAP_MS,
  BOOK_HOLD_MAX_MS,
  BOOK_INTERVAL_MS,
  holdLocalWrite,
  markBackground,
  noteLocalWrite,
  readOlderPage,
  requestOrderBook,
  resetOrderBookRunnerForTests,
  retryOrderBook,
  useOrderBook,
  useOrderBookFreshness,
} from './useOrderBook'
import { useApproveOrder } from './useOrderQueries'
import { ordersApi } from '../../services/api'
import type { Order, OrderWireStatus } from '../../services/api/types'
import {
  FakeOrderGateway,
  HOUSE_A,
  HOUSE_B,
  makeOrders,
  signInAs,
} from '../../__tests__/utils/fakeOrderGateway'

let gw: FakeOrderGateway
let visibility: DocumentVisibilityState = 'visible'

function authAs(house: string) {
  vi.mocked(useAuth).mockReturnValue({
    activeRestaurantId: house,
    isAuthenticated: true,
  } as unknown as ReturnType<typeof useAuth>)
}

/** The app's QueryClient defaults (App.tsx:150-161). */
function appClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: 1 },
    },
  })
}

function mount(house: string, client = appClient()) {
  signInAs(house)
  authAs(house)
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => ({ book: useOrderBook(), fresh: useOrderBookFreshness(house) }),
    { wrapper },
  )
  return { client, hook }
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

/** Page reads so far (one per page of the book). */
const reads = () => gw.listCalls().length

/** As a browser does: the event bubbles to window, where TanStack's focus manager listens. */
function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

/** Marks the book stale without reading it, so a TanStack focus or reconnect refetch would read. */
const staleWithoutReading = (client: QueryClient) =>
  act(async () => {
    void client.invalidateQueries({
      queryKey: queryKeys.orders.book(HOUSE_A),
      refetchType: 'none',
    })
  })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetOrderBookRunnerForTests()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  gw = new FakeOrderGateway([...makeOrders(HOUSE_A, 150), ...makeOrders(HOUSE_B, 120, undefined, 'b')])
  gw.scopeByToken = true
  vi.mocked(apiClient.get).mockReset()
  vi.mocked(apiClient.get).mockImplementation(gw.get as never)
})

afterEach(() => {
  resetOrderBookRunnerForTests()
  vi.useRealTimers()
  localStorage.clear()
})

describe('useOrderBook: reading', () => {
  it('reads the whole book on mount, after the settle', async () => {
    const { hook } = mount(HOUSE_A)
    await advance(399)
    expect(reads()).toBe(0)
    await advance(10)
    expect(reads()).toBe(2)
    expect(hook.result.current.book.data?.rows).toHaveLength(150)
  })

  it("invalidateQueries(['orders']) reaches the book", async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(2)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(reads()).toBe(4)
  })

  it('two invalidations within 400 ms give one read', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.orders.all })
    })
    await advance(150)
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.orders.all })
    })
    await advance(2_000)
    expect(reads()).toBe(4)
  })

  it('a read nobody waits for any more is not started', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await act(async () => {
      await client.cancelQueries({ queryKey: queryKeys.orders.book(HOUSE_A) })
    })
    await advance(1_000)
    expect(reads()).toBe(2)
  })

  it('a book dated later than the one finishing stays in the cache, and the query gets it', async () => {
    const client = appClient()
    const later: OrderBook = {
      house: HOUSE_A,
      mode: 'whole',
      reason: null,
      rows: [],
      total: 0,
      openComplete: true,
      statusTotals: null,
      unclassifiedCount: null,
      nextClosedPage: null,
      readStartedAt: Date.now() + 3_600_000,
      readFinishedAt: Date.now() + 3_600_000,
      requests: 0,
    }
    client.setQueryData(queryKeys.orders.book(HOUSE_A), later)
    const { hook } = mount(HOUSE_A, client)
    await advance(500)
    expect(reads()).toBe(0)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(reads()).toBe(2)
    expect(client.getQueryData(queryKeys.orders.book(HOUSE_A))).toBe(later)
    expect(hook.result.current.book.data).toBe(later)
    // Freshness dates the book the cache kept, not the read that just finished.
    expect(hook.result.current.fresh.asOf).toBe(later.readStartedAt)
  })

  it('one read at a time: requests during a read wait for ONE trailing read', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    gw.before = (call) => (call.params.page === 1 ? { wait: held } : undefined)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(reads()).toBe(3)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        void client.invalidateQueries({ queryKey: ['orders'] })
      })
      await advance(1_000)
    }
    expect(reads()).toBe(3)
    gw.before = null
    release()
    await advance(1_000)
    expect(reads()).toBe(3 + 1 + 2)
  })

  it('holds this tab to 40 list requests in any 60 s', async () => {
    gw.rows = makeOrders(HOUSE_A, 2_500)
    const { client } = mount(HOUSE_A)
    await advance(1_000)
    expect(reads()).toBe(25)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(1_000)
    expect(reads()).toBe(40)
    await advance(58_000)
    expect(reads()).toBe(40)
    await advance(1_000)
    expect(reads()).toBe(50)
  })
})

describe('useOrderBook: urgent and background', () => {
  it('an urgent read (the default) is not held back by the gap', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(reads()).toBe(4)
  })

  it('an urgent read (the default) is not deferred by a hidden tab: it runs after the settle', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(2)
    setVisibility('hidden')
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(399)
    expect(reads()).toBe(2)
    await advance(10)
    expect(reads()).toBe(4)
  })

  it('a background read waits out the gap after the last read', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await act(async () => {
      markBackground(HOUSE_A)
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(5_000)
    expect(reads()).toBe(2)
    await advance(BOOK_BACKGROUND_GAP_MS)
    expect(reads()).toBe(4)
  })

  it('a background read waits while the tab is hidden, and runs once when it is seen', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    setVisibility('hidden')
    await act(async () => {
      markBackground(HOUSE_A)
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(2 * BOOK_INTERVAL_MS + 1_000)
    expect(reads()).toBe(2)
    await act(async () => {
      setVisibility('visible')
    })
    await advance(1_000)
    expect(reads()).toBe(4)
    await advance(10_000)
    expect(reads()).toBe(4)
  })

  it('a background read already timed does not start if the tab is hidden before it fires', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await act(async () => {
      markBackground(HOUSE_A)
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(5_000)
    setVisibility('hidden')
    await advance(BOOK_BACKGROUND_GAP_MS)
    expect(reads()).toBe(2)
    await act(async () => {
      setVisibility('visible')
    })
    await advance(1_000)
    expect(reads()).toBe(4)
  })

  it('a mark lasts one tick: the next refresh of the house is urgent again', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await act(async () => {
      markBackground(HOUSE_A)
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(1_000)
    expect(reads()).toBe(2)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(1_000)
    expect(reads()).toBe(4)
  })

  it("the runner's own interval is a background read", async () => {
    mount(HOUSE_A)
    await advance(500)
    await advance(BOOK_INTERVAL_MS)
    expect(reads()).toBe(4)
  })

  it('a focus is a background read: it waits out the gap, where a TanStack focus refetch would not', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await staleWithoutReading(client)
    await act(async () => {
      setVisibility('hidden')
      setVisibility('visible')
    })
    await advance(5_000)
    expect(reads()).toBe(2)
    await advance(BOOK_BACKGROUND_GAP_MS)
    expect(reads()).toBe(4)
  })

  it('a reconnect makes no read of its own; the interval reads', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    await staleWithoutReading(client)
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('online'))
    })
    await advance(5_000)
    expect(reads()).toBe(2)
  })
})

describe('useOrderBook: 429', () => {
  it('a read that gave up on 429s is not retried by the query, and the next read waits out retryAfter', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      let limited = 3
      gw.before = (call) => {
        if (call.params.page !== 1 || limited === 0) return undefined
        limited--
        return { status: 429, data: { statusCode: 429, retryAfter: 10 } }
      }
      const { client, hook } = mount(HOUSE_A)
      // 429s at 0.4 s, 10.4 s and 20.4 s; the reader gives up after the third.
      await advance(20_500)
      expect(reads()).toBe(3)
      expect(hook.result.current.book.status).toBe('error')
      expect(hook.result.current.book.error).toBeInstanceOf(RateLimitedError)

      // The third 429 asked for 10 s, so no request goes out before 30.4 s.
      await act(async () => {
        void client.invalidateQueries({ queryKey: ['orders'] })
      })
      await advance(8_000)
      expect(reads()).toBe(3)
      await advance(3_000)
      expect(reads()).toBe(5)
    } finally {
      random.mockRestore()
    }
  })
})

describe('useOrderBook: houses', () => {
  it('a house switch stops the read and never writes A under B', async () => {
    const { client, hook } = mount(HOUSE_A)
    gw.before = (_call, index) => (index === 0 ? { wait: new Promise<void>(() => {}) } : undefined)
    await advance(500)
    expect(gw.calls).toHaveLength(1)
    expect(gw.calls[0].house).toBe(HOUSE_A)

    signInAs(HOUSE_B)
    authAs(HOUSE_B)
    hook.rerender()
    await advance(1_000)

    expect(gw.calls[0].signal?.aborted).toBe(true)
    // The stopped read is not a failed refresh of A.
    expect(hook.result.current.fresh.failing).toBe(false)
    expect(gw.calls.slice(1).every((c) => c.house === HOUSE_B)).toBe(true)
    expect(client.getQueryData(queryKeys.orders.book(HOUSE_A))).toBeUndefined()
    const bookB = client.getQueryData<OrderBook>(queryKeys.orders.book(HOUSE_B))
    expect(bookB?.house).toBe(HOUSE_B)
    expect(bookB?.rows).toHaveLength(120)
    expect(bookB?.rows.every((r) => r.restaurantId === HOUSE_B)).toBe(true)
  })
})

describe('useOrderBook: the fence', () => {
  it('a read that started before a local write is not written; a fresh read replaces it', async () => {
    const { client, hook } = mount(HOUSE_A)
    await advance(500)
    const before = client.getQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A))
    expect(before).toBeDefined()

    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    gw.before = (call) => (call.params.page === 1 ? { wait: held } : undefined)
    let settled = false
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] }).then(() => {
        settled = true
      })
    })
    await advance(500)
    const wroteAt = Date.now()
    noteLocalWrite(HOUSE_A)
    gw.before = null
    release()
    await advance(10)
    expect(client.getQueryData(queryKeys.orders.book(HOUSE_A))).toBe(before)

    await advance(1_000)
    const after = client.getQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A))
    expect(after).not.toBe(before)
    expect(after!.readStartedAt).toBeGreaterThanOrEqual(wroteAt)
    // The query that asked for the fenced read is answered by the read that replaced it.
    expect(settled).toBe(true)
    expect(hook.result.current.book.isFetching).toBe(false)
    expect(hook.result.current.book.data).toBe(after)
  })
})

describe('useOrderBookFreshness', () => {
  it('is fresh after a read, and flips to failing when a refresh fails', async () => {
    const { client, hook } = mount(HOUSE_A)
    await advance(500)
    expect(hook.result.current.fresh).toMatchObject({ failing: false, stale: false })
    expect(hook.result.current.fresh.asOf).not.toBeNull()

    gw.before = () => ({ status: 500 })
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(hook.result.current.fresh).toMatchObject({ failing: true, stale: true })
  })

  it('a row of another house on a page is a failed refresh', async () => {
    const { client, hook } = mount(HOUSE_A)
    await advance(500)
    gw.before = (call) =>
      call.params.page === 1
        ? {
            data: {
              orders: makeOrders(HOUSE_B, 1, undefined, 'b'),
              total: 1,
              page: 1,
              limit: 100,
              hasMore: false,
            },
          }
        : undefined
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(hook.result.current.book.error).toBeInstanceOf(ForeignRowError)
    expect(hook.result.current.fresh).toMatchObject({ failing: true, stale: true })
  })

  it('a token that names another house mid-read is not a failed refresh of this house', async () => {
    const { client, hook } = mount(HOUSE_A)
    await advance(500)
    gw.before = (call) => {
      if (call.params.page === 2) signInAs(HOUSE_B)
      return undefined
    }
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
    })
    await advance(500)
    expect(hook.result.current.book.error).toBeInstanceOf(HouseChangedError)
    expect(hook.result.current.fresh).toMatchObject({ failing: false, stale: false })
  })

  it('goes stale past twice the interval with no read', async () => {
    const { hook } = mount(HOUSE_A)
    await advance(500)
    setVisibility('hidden')
    await advance(2 * BOOK_INTERVAL_MS - 1_000)
    expect(hook.result.current.fresh.stale).toBe(false)
    await advance(2_000)
    expect(hook.result.current.fresh).toMatchObject({ failing: false, stale: true })
  })
})

describe('retryOrderBook', () => {
  it('does not retry a 429, a house change, a row of another house or a bad page; retries anything else once', () => {
    expect(retryOrderBook(0, new RateLimitedError(1_000))).toBe(false)
    expect(retryOrderBook(0, new HouseChangedError())).toBe(false)
    expect(retryOrderBook(0, new ForeignRowError())).toBe(false)
    expect(retryOrderBook(0, new BookShapeError('x'))).toBe(false)
    expect(retryOrderBook(0, new Error('500'))).toBe(true)
    expect(retryOrderBook(1, new Error('500'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ADR 0269 PR-B: older pages, holds, and the approve that takes one
// ---------------------------------------------------------------------------

/** Book reads begun so far: every read asks for page 1 first. */
const bookReads = () => gw.listCalls().filter((c) => c.params.page === 1).length

const X = 'o-00000'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The fake commits `id` → `status`, as the gateway does when the write lands. */
function commit(id: string, status: OrderWireStatus): Order {
  gw.rows = gw.rows.map((r) => (r.id === id ? ({ ...r, status } as Order) : r))
  return gw.rows.find((r) => r.id === id)!
}

const bookOf = (client: QueryClient) => client.getQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A))
const statusOf = (client: QueryClient, id: string) => bookOf(client)?.rows.find((r) => r.id === id)?.status

function mountApprove(house: string, client = appClient()) {
  signInAs(house)
  authAs(house)
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => ({ book: useOrderBook(), fresh: useOrderBookFreshness(house), approve: useApproveOrder() }),
    { wrapper },
  )
  return { client, hook }
}

const invalidateOrders = (client: QueryClient) =>
  act(async () => {
    void client.invalidateQueries({ queryKey: ['orders'] })
  })

describe('older pages share the 429 gate (E1, E2)', () => {
  it('E1: after the book gives up on 429s, an older page waits out retryAfter', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      let limited = 3
      gw.before = (call) => {
        if (call.params.page !== 1 || limited === 0) return undefined
        limited--
        return { status: 429, data: { statusCode: 429, retryAfter: 10 } }
      }
      const { hook } = mount(HOUSE_A)
      await advance(20_500)
      expect(hook.result.current.book.error).toBeInstanceOf(RateLimitedError)
      const pageTwo = () => gw.listCalls().filter((c) => c.params.page === 2).length

      const controller = new AbortController()
      let read: unknown = null
      await act(async () => {
        void readOlderPage(HOUSE_A, 2, controller.signal).then((page) => (read = page))
      })
      // The third 429 came at 20.4 s and asked for 10 s.
      await advance(9_500)
      expect(pageTwo()).toBe(0)
      await advance(1_000)
      expect(pageTwo()).toBe(1)
      expect(read).not.toBeNull()
    } finally {
      random.mockRestore()
    }
  })

  it('E2: a 429 on an older page holds the book read back for retryAfter', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const { client } = mount(HOUSE_A)
      await advance(500)
      expect(bookReads()).toBe(1)
      let limited = 1
      gw.before = (call) => {
        if (call.params.page !== 2 || limited === 0) return undefined
        limited--
        return { status: 429, data: { statusCode: 429, retryAfter: 10 } }
      }
      const controller = new AbortController()
      await act(async () => {
        void readOlderPage(HOUSE_A, 2, controller.signal)
      })
      await invalidateOrders(client)
      await advance(9_500)
      expect(bookReads()).toBe(1)
      await advance(1_000)
      expect(bookReads()).toBe(2)
    } finally {
      random.mockRestore()
    }
  })
})

describe('holdLocalWrite (H1-H4)', () => {
  it('H1: a read under way is stopped, its caller waits without an error, and the release reads for it', async () => {
    const { client, hook } = mount(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(2)
    const before = bookOf(client)

    gw.before = (call) => (call.params.page === 2 ? { wait: new Promise<void>(() => {}) } : undefined)
    let outcome: { book?: OrderBook; error?: unknown } | null = null
    await act(async () => {
      requestOrderBook(HOUSE_A, client).then(
        (book) => (outcome = { book }),
        (error) => (outcome = { error }),
      )
    })
    await advance(500)
    expect(reads()).toBe(4)
    const held = gw.listCalls().at(-1)!
    expect(held.params.page).toBe(2)

    let release!: () => void
    await act(async () => {
      release = holdLocalWrite(HOUSE_A)
    })
    await advance(10)
    expect(held.signal?.aborted).toBe(true)
    expect(String(held.signal?.reason)).toBe('Symbol(held for a local write)')
    expect(outcome).toBeNull()
    expect(hook.result.current.book.isError).toBe(false)
    expect(hook.result.current.fresh.failing).toBe(false)

    gw.before = null
    await invalidateOrders(client)
    await advance(5_000)
    expect(reads()).toBe(4)

    await act(async () => release())
    await advance(1_000)
    expect(reads()).toBe(6)
    expect(outcome).not.toBeNull()
    expect(outcome!.error).toBeUndefined()
    // The read after the release, as the cache holds it (structural sharing may copy it).
    expect(outcome!.book).toEqual(bookOf(client))
    expect(outcome!.book!.readStartedAt).toBeGreaterThan(before!.readStartedAt)
    expect(hook.result.current.book.isError).toBe(false)
  })

  it('H2: a hold never released stops reads for BOOK_HOLD_MAX_MS, then lets them run', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(2)
    await act(async () => {
      holdLocalWrite(HOUSE_A)
    })
    await invalidateOrders(client)
    await advance(BOOK_HOLD_MAX_MS - 1)
    expect(reads()).toBe(2)
    await advance(10)
    expect(reads()).toBe(4)
  })

  it('H3: two holds: one released (twice) still holds; both released reads', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    let first!: () => void
    let second!: () => void
    await act(async () => {
      first = holdLocalWrite(HOUSE_A)
      second = holdLocalWrite(HOUSE_A)
    })
    await invalidateOrders(client)
    await advance(1_000)
    expect(reads()).toBe(2)
    await act(async () => first())
    await advance(1_000)
    expect(reads()).toBe(2)
    await act(async () => first())
    await advance(1_000)
    expect(reads()).toBe(2)
    await act(async () => second())
    await advance(1_000)
    expect(reads()).toBe(4)
  })

  it('H3b: a hold the timer already let go does not let go a second time when released', async () => {
    const { client } = mount(HOUSE_A)
    await advance(500)
    let first!: () => void
    let second!: () => void
    await act(async () => {
      first = holdLocalWrite(HOUSE_A)
    })
    await advance(10_000)
    await act(async () => {
      second = holdLocalWrite(HOUSE_A)
    })
    // The first hold's timer lets go; the second still holds.
    await advance(BOOK_HOLD_MAX_MS - 10_000 + 1_000)
    const held = reads()
    await act(async () => first())
    await invalidateOrders(client)
    await advance(1_000)
    expect(reads()).toBe(held)
    await act(async () => second())
    await advance(1_000)
    expect(reads()).toBeGreaterThan(held)
  })

  it('H4: a reset drops every hold; the next mount reads, and the old hold reads nothing later', async () => {
    const first = mount(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(2)
    await invalidateOrders(first.client)
    await act(async () => {
      holdLocalWrite(HOUSE_A)
    })
    first.hook.unmount()
    resetOrderBookRunnerForTests()

    mount(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(4)
    await advance(BOOK_HOLD_MAX_MS + 1_000)
    expect(reads()).toBe(4)
  })
})

describe('useApproveOrder holds the book until the approve settles (P1-P6, H5, H6)', () => {
  let approveSpy: MockInstance<typeof ordersApi.approveOrder>

  beforeEach(() => {
    gw.rows = [
      ...makeOrders(HOUSE_A, 150, (i) => (i < 3 ? 'PENDING' : 'COMPLETED')),
      ...makeOrders(HOUSE_B, 120, undefined, 'b'),
    ]
    approveSpy = vi.spyOn(ordersApi, 'approveOrder')
  })

  afterEach(() => {
    approveSpy.mockRestore()
    onlineManager.setOnline(true)
  })

  it('P1: the book row reads approved at once, the list row too, and the read itself is untouched', async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    const before = bookOf(client)!
    const asOf = hook.result.current.fresh.asOf
    client.setQueryData(queryKeys.orders.list(HOUSE_A), [gw.rows.find((r) => r.id === X)])
    approveSpy.mockReturnValue(deferred<Order>().promise)

    await act(async () => {
      hook.result.current.approve.mutate(X)
    })
    await advance(10)
    expect(statusOf(client, X)).toBe('approved')
    expect(client.getQueryData<Order[]>(queryKeys.orders.list(HOUSE_A))![0].status).toBe('approved')
    const after = bookOf(client)!
    expect(after.readStartedAt).toBe(before.readStartedAt)
    expect(after.total).toBe(before.total)
    expect(hook.result.current.fresh.asOf).toBe(asOf)
    expect(after.rows.filter((r) => r.id !== X)).toEqual(before.rows.filter((r) => r.id !== X))
  })

  it('P2: no read while the approve is on its way; the settle reads the committed status', async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    const answer = deferred<Order>()
    approveSpy.mockReturnValue(answer.promise)
    await act(async () => {
      hook.result.current.approve.mutate(X)
    })
    await advance(10)
    const listed = reads()
    await invalidateOrders(client)
    await advance(5_000)
    expect(reads()).toBe(listed)
    expect(statusOf(client, X)).toBe('approved')

    await act(async () => answer.resolve(commit(X, 'APPROVED')))
    await advance(1_000)
    expect(reads()).toBe(listed + 2)
    expect(statusOf(client, X)).toBe('APPROVED')
  })

  it('P3: a read under way when the approve begins never writes the old status back', async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    let releaseRead!: () => void
    const heldRead = new Promise<void>((r) => (releaseRead = r))
    gw.before = (call) => (call.params.page === 1 ? { wait: heldRead } : undefined)
    await invalidateOrders(client)
    await advance(500)
    expect(gw.listCalls().at(-1)!.params.page).toBe(1)

    approveSpy.mockReturnValue(deferred<Order>().promise)
    await act(async () => {
      hook.result.current.approve.mutate(X)
    })
    await advance(10)
    gw.before = null
    releaseRead()
    await advance(1_000)
    expect(statusOf(client, X)).toBe('approved')
  })

  it("P4: a failed approve puts back only its own row's status, and a read follows", async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    const Y = 'o-00001'
    const Z = 'o-00002'

    // (a) Y changed by another write mid-approve keeps its change.
    const first = deferred<Order>()
    approveSpy.mockReturnValueOnce(first.promise)
    await act(async () => {
      hook.result.current.approve.mutate(X)
    })
    await advance(10)
    await act(async () => {
      client.setQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A), (b) =>
        b ? { ...b, rows: b.rows.map((r) => (r.id === Y ? { ...r, status: 'IN_TRANSIT' } : r)) } : b,
      )
    })
    const listed = reads()
    await act(async () => first.reject(new Error('refused')))
    await advance(10)
    expect(statusOf(client, X)).toBe('PENDING')
    expect(statusOf(client, Y)).toBe('IN_TRANSIT')
    await advance(1_000)
    expect(reads()).toBe(listed + 2)

    // (b) A row a read already moved on is not reverted.
    const second = deferred<Order>()
    approveSpy.mockReturnValueOnce(second.promise)
    await act(async () => {
      hook.result.current.approve.mutate(Z)
    })
    await advance(10)
    expect(statusOf(client, Z)).toBe('approved')
    await act(async () => {
      client.setQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A), (b) =>
        b ? { ...b, rows: b.rows.map((r) => (r.id === Z ? { ...r, status: 'APPROVED' } : r)) } : b,
      )
    })
    await act(async () => second.reject(new Error('refused')))
    await advance(10)
    expect(statusOf(client, Z)).toBe('APPROVED')
  })

  it('H5: offline, the paused approve still holds; past the hold a read keeps the row as written', async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    // A read is under way when the approve begins; the hold stops it.
    gw.before = (call) => (call.params.page === 2 ? { wait: new Promise<void>(() => {}) } : undefined)
    await invalidateOrders(client)
    await advance(500)
    const begun = bookReads()

    const answer = deferred<Order>()
    approveSpy.mockReturnValue(answer.promise)
    await act(async () => {
      onlineManager.setOnline(false)
      hook.result.current.approve.mutate(X)
    })
    await advance(10)
    gw.before = null
    expect(hook.result.current.approve.isPaused).toBe(true)
    expect(approveSpy).not.toHaveBeenCalled()
    expect(statusOf(client, X)).toBe('approved')

    await advance(36_000)
    expect(bookReads()).toBe(begun + 1)
    expect(statusOf(client, X)).toBe('approved')

    await act(async () => onlineManager.setOnline(true))
    await advance(10)
    expect(approveSpy).toHaveBeenCalledTimes(1)
    const settled = bookReads()
    await act(async () => answer.resolve(commit(X, 'APPROVED')))
    await advance(1_000)
    expect(bookReads()).toBe(settled + 1)
    expect(statusOf(client, X)).toBe('APPROVED')
  })

  it('H6: an approve answered after the hold: the release fences the read that started before it', async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    const answer = deferred<Order>()
    approveSpy.mockReturnValue(answer.promise)
    await act(async () => {
      hook.result.current.approve.mutate(X)
    })
    await invalidateOrders(client)
    await advance(34_000)
    expect(bookReads()).toBe(1)
    await advance(1_100)
    // Past BOOK_HOLD_MAX_MS: a read runs, and the row stays as written.
    expect(bookReads()).toBe(2)
    expect(statusOf(client, X)).toBe('approved')

    // The next read reads X still PENDING on page 1, then waits on page 2.
    let releaseRead!: () => void
    const heldRead = new Promise<void>((r) => (releaseRead = r))
    gw.before = (call) => (call.params.page === 2 ? { wait: heldRead } : undefined)
    await invalidateOrders(client)
    await advance(500)
    expect(bookReads()).toBe(3)

    // The gateway answers at 36 s.
    await advance(400)
    await act(async () => answer.resolve(commit(X, 'APPROVED')))
    await advance(10)
    gw.before = null
    releaseRead()
    await advance(10)
    // The read that began before the release is not written.
    expect(statusOf(client, X)).toBe('approved')
    await advance(1_000)
    expect(bookReads()).toBe(4)
    expect(statusOf(client, X)).toBe('APPROVED')
  })

  it('P5: a read stopped by the approve sends no more pages, and shows no error', async () => {
    gw.rows = makeOrders(HOUSE_A, 550, (i) => (i < 3 ? 'PENDING' : 'COMPLETED'))
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    expect(reads()).toBe(6)

    let releaseRead!: () => void
    const heldRead = new Promise<void>((r) => (releaseRead = r))
    gw.before = (call) => (call.params.page === 3 ? { wait: heldRead } : undefined)
    await invalidateOrders(client)
    await advance(500)
    expect(reads()).toBe(9)

    const answer = deferred<Order>()
    approveSpy.mockReturnValue(answer.promise)
    await act(async () => {
      hook.result.current.approve.mutate(X)
    })
    await advance(100)
    gw.before = null
    releaseRead()
    await advance(5_000)
    expect(reads()).toBe(9)

    await act(async () => answer.resolve(commit(X, 'APPROVED')))
    await advance(2_000)
    // 3 sent before the approve, then one whole read of 6: never 12.
    expect(reads() - 6).toBe(9)
    expect(statusOf(client, X)).toBe('APPROVED')
    expect(hook.result.current.book.isError).toBe(false)
    expect(hook.result.current.fresh.failing).toBe(false)
  })

  it('P6: a bulk approve, one after another, reads once, after the last', async () => {
    const { client, hook } = mountApprove(HOUSE_A)
    await advance(500)
    const ids = ['o-00000', 'o-00001', 'o-00002']
    const answers = ids.map(() => deferred<Order>())
    let n = 0
    approveSpy.mockImplementation(() => answers[n++].promise)
    let done = false
    await act(async () => {
      void (async () => {
        for (const id of ids) await hook.result.current.approve.mutateAsync(id)
        done = true
      })()
    })
    const listed = reads()
    for (let i = 0; i < ids.length; i++) {
      await advance(100)
      expect(reads()).toBe(listed)
      await act(async () => answers[i].resolve(commit(ids[i], 'APPROVED')))
    }
    await advance(10)
    expect(done).toBe(true)
    expect(reads()).toBe(listed)
    await advance(1_000)
    expect(reads()).toBe(listed + 2)
    await advance(5_000)
    expect(reads()).toBe(listed + 2)
    for (const id of ids) expect(statusOf(client, id)).toBe('APPROVED')
  })
})
