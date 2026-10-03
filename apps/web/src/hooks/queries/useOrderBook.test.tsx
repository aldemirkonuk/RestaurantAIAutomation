/**
 * The order-book runner and hook (ADR 0269, F-140), with a real QueryClient
 * set up as App.tsx sets it up, and a fake gateway.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

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
  HouseChangedError,
  RateLimitedError,
  type OrderBook,
} from '../../services/api/order-book'
import {
  BOOK_BACKGROUND_GAP_MS,
  BOOK_INTERVAL_MS,
  markBackground,
  noteLocalWrite,
  resetOrderBookRunnerForTests,
  retryOrderBook,
  useOrderBook,
  useOrderBookFreshness,
} from './useOrderBook'
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

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

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

  it("the runner's own interval is a background read", async () => {
    mount(HOUSE_A)
    await advance(500)
    await advance(BOOK_INTERVAL_MS)
    expect(reads()).toBe(4)
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
    const { client } = mount(HOUSE_A)
    await advance(500)
    const before = client.getQueryData<OrderBook>(queryKeys.orders.book(HOUSE_A))
    expect(before).toBeDefined()

    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    gw.before = (call) => (call.params.page === 1 ? { wait: held } : undefined)
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['orders'] })
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
  it('does not retry a 429, a house change or a bad page; retries anything else once', () => {
    expect(retryOrderBook(0, new RateLimitedError(1_000))).toBe(false)
    expect(retryOrderBook(0, new HouseChangedError())).toBe(false)
    expect(retryOrderBook(0, new BookShapeError('x'))).toBe(false)
    expect(retryOrderBook(0, new Error('500'))).toBe(true)
    expect(retryOrderBook(1, new Error('500'))).toBe(false)
  })
})
