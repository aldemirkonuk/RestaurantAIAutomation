/**
 * The order-book reader against a fake gateway that pages the way listOrders
 * does (ADR 0269, F-140).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, apiClient: { get: vi.fn() } }
})

import { apiClient } from './client'
import {
  BookShapeError,
  CLOSED_WIRE_STATUSES,
  fetchOrderBook,
  fetchOrderBookPage,
  fetchOrderById,
  ForeignRowError,
  HouseChangedError,
  isOpenOrderStatus,
  markFor,
  OPEN_WIRE_STATUSES,
  RATE_JITTER_MAX_MS,
  RATE_WINDOW_MS,
  RateLimitedError,
} from './order-book'
import type { Order, OrderWireStatus, ShelfReceived } from './types'
import {
  FakeOrderGateway,
  HOUSE_A,
  HOUSE_B,
  makeOrders,
  signInAs,
} from '../../__tests__/utils/fakeOrderGateway'

let gw: FakeOrderGateway

function install(rows: Order[]): FakeOrderGateway {
  gw = new FakeOrderGateway(rows)
  vi.mocked(apiClient.get).mockImplementation(gw.get as never)
  return gw
}

const noWait = {
  sleep: vi.fn(async (_ms: number, _signal: AbortSignal) => {}),
  random: () => 0.5,
}

beforeEach(() => {
  localStorage.clear()
  signInAs(HOUSE_A)
  vi.mocked(apiClient.get).mockReset()
  noWait.sleep.mockClear()
})

afterEach(() => {
  localStorage.clear()
})

const signal = () => new AbortController().signal

describe('fetchOrderBook: paging', () => {
  it('reads 525 orders in 6 requests on /history, pages 1..6 at limit 100', async () => {
    install(makeOrders(HOUSE_A, 525))
    const book = await fetchOrderBook(HOUSE_A, signal())

    const calls = gw.listCalls()
    expect(calls.map((c) => c.url)).toEqual(Array(6).fill('/procurement/orders/history'))
    expect(calls.map((c) => c.params.page)).toEqual([1, 2, 3, 4, 5, 6])
    expect(calls.every((c) => c.params.limit === 100)).toBe(true)
    expect(book.mode).toBe('whole')
    expect(book.total).toBe(525)
    expect(new Set(book.rows.map((r) => r.id)).size).toBe(525)
    expect(book.requests).toBe(6)
    expect(book.openComplete).toBe(true)
  })

  it('reads an empty house in one request as an empty whole book', async () => {
    install([])
    const book = await fetchOrderBook(HOUSE_A, signal())
    expect(gw.listCalls()).toHaveLength(1)
    expect(book).toMatchObject({ mode: 'whole', total: 0, rows: [] })
  })

  it('the fake answers the default 50 and refuses above 100, as the gateway does', async () => {
    install(makeOrders(HOUSE_A, 120))
    const page = (await gw.get('/procurement/orders/history', { params: {} })).data as {
      orders: unknown[]
      limit: number
      hasMore: boolean
    }
    expect(page.orders).toHaveLength(50)
    expect(page.limit).toBe(50)
    expect(page.hasMore).toBe(true)
    await expect(
      gw.get('/procurement/orders/history', { params: { limit: 101 } }),
    ).rejects.toMatchObject({ response: { status: 400 } })
  })
})

describe('fetchOrderBook: the house', () => {
  it('throws ForeignRowError when a row belongs to another house', async () => {
    const rows = makeOrders(HOUSE_A, 150)
    rows[120] = { ...rows[120], restaurantId: HOUSE_B }
    install(rows)
    await expect(fetchOrderBook(HOUSE_A, signal())).rejects.toBeInstanceOf(ForeignRowError)
  })

  it('throws when the token changes to another house during the last page (only the check after a page sees it)', async () => {
    install(makeOrders(HOUSE_A, 250))
    gw.before = (_call, index) => {
      if (index === 2) signInAs(HOUSE_B)
      return undefined
    }
    await expect(fetchOrderBook(HOUSE_A, signal())).rejects.toBeInstanceOf(HouseChangedError)
    expect(gw.listCalls()).toHaveLength(3)
  })

  it('throws before asking when the token changed between pages (checked before a page)', async () => {
    install(makeOrders(HOUSE_A, 250))
    let asked = 0
    const beforeRequest = async () => {
      asked++
      if (asked === 2) signInAs(HOUSE_B)
    }
    await expect(fetchOrderBook(HOUSE_A, signal(), { beforeRequest })).rejects.toBeInstanceOf(
      HouseChangedError,
    )
    expect(gw.listCalls()).toHaveLength(1)
  })
})

describe('fetchOrderBook: a read that does not hold still', () => {
  /** 150 orders; every third is open, and so is #149, the one the shifted page skips. */
  const statusFor = (i: number): OrderWireStatus =>
    i === 149 || i % 3 === 0 ? 'IN_TRANSIT' : 'COMPLETED'
  /** Page 2 shifted by one, as a created_at tie can make it: #99 again, #149 missing. */
  const shifted = (rows: Order[]) => ({
    data: { orders: rows.slice(99, 149), total: 150, page: 2, limit: 100, hasMore: false },
  })

  it('reads again once when a page repeats an order, and keeps the second read when it holds', async () => {
    const rows = makeOrders(HOUSE_A, 150, statusFor)
    install(rows)
    let shiftedOnce = false
    gw.before = (call) => {
      if (call.params.page === 2 && !call.params.status && !shiftedOnce) {
        shiftedOnce = true
        return shifted(rows)
      }
      return undefined
    }
    const book = await fetchOrderBook(HOUSE_A, signal())
    expect(gw.listCalls().map((c) => c.params.page)).toEqual([1, 2, 1, 2])
    expect(book.mode).toBe('whole')
    expect(book.rows).toHaveLength(150)
  })

  it('falls back to the open sweep after the second read also fails; with every status one it can name, it lists every open order', async () => {
    const rows = makeOrders(HOUSE_A, 150, statusFor)
    install(rows)
    gw.before = (call) =>
      call.params.page === 2 && !call.params.status ? shifted(rows) : undefined
    const book = await fetchOrderBook(HOUSE_A, signal())

    const calls = gw.listCalls()
    expect(calls.slice(0, 4).map((c) => [c.params.page, c.params.status])).toEqual([
      [1, undefined],
      [2, undefined],
      [1, undefined],
      [2, undefined],
    ])
    const swept = calls.slice(4).filter((c) => c.params.limit === 100).map((c) => c.params.status)
    expect(swept).toEqual([...OPEN_WIRE_STATUSES])
    const counted = calls.slice(4).filter((c) => c.params.limit === 1).map((c) => c.params.status)
    expect(counted).toEqual([...CLOSED_WIRE_STATUSES])

    expect(book.mode).toBe('partial')
    expect(book.reason).toBe('unstable')
    expect(book.openComplete).toBe(true)
    const openIds = rows.filter((r) => r.status === 'IN_TRANSIT').map((r) => r.id)
    const got = new Set(book.rows.map((r) => r.id))
    expect(openIds.every((id) => got.has(id))).toBe(true)
    expect(got.has('o-00149')).toBe(true)
    expect(book.statusTotals?.IN_TRANSIT).toBe(openIds.length)
    expect(book.statusTotals?.COMPLETED).toBe(150 - openIds.length)
    expect(book.unclassifiedCount).toBe(0)
  })

  it('keeps a row of a status it cannot name, and says the open set may not be complete', async () => {
    const rows = makeOrders(HOUSE_A, 150, (i) =>
      i === 10 ? ('ARCHIVED' as OrderWireStatus) : statusFor(i),
    )
    install(rows)
    gw.before = (call) =>
      call.params.page === 2 && !call.params.status ? shifted(rows) : undefined
    const book = await fetchOrderBook(HOUSE_A, signal())

    expect(book.mode).toBe('partial')
    expect(isOpenOrderStatus('ARCHIVED')).toBe(true)
    expect(book.rows.find((r) => r.id === 'o-00010')?.status).toBe('ARCHIVED')
    expect(book.unclassifiedCount).toBe(1)
    expect(book.openComplete).toBe(false)
  })

  it('does not list a row as open once the sweep no longer finds it open', async () => {
    const rows = makeOrders(HOUSE_A, 150, statusFor)
    install(rows)
    gw.before = (call) => {
      if (call.params.page === 2 && !call.params.status) return shifted(rows)
      // #3 was IN_TRANSIT on page 1, and is completed before the sweep asks.
      if (call.params.status && gw.rows[3].status === 'IN_TRANSIT') {
        gw.rows[3] = { ...gw.rows[3], status: 'COMPLETED' }
      }
      return undefined
    }
    const book = await fetchOrderBook(HOUSE_A, signal())

    expect(book.mode).toBe('partial')
    expect(book.rows.some((r) => r.id === 'o-00003' && r.status === 'IN_TRANSIT')).toBe(false)
    expect(book.rows.filter((r) => r.status === 'IN_TRANSIT')).toHaveLength(
      book.statusTotals?.IN_TRANSIT ?? -1,
    )
  })

  it('says the open set is not complete when an open sweep does not hold still either', async () => {
    const rows = makeOrders(HOUSE_A, 150, () => 'IN_TRANSIT')
    install(rows)
    gw.before = (call) =>
      call.params.page === 2 && (!call.params.status || call.params.status === 'IN_TRANSIT')
        ? shifted(rows)
        : undefined
    const book = await fetchOrderBook(HOUSE_A, signal())

    const transit = gw.listCalls().filter((c) => c.params.status === 'IN_TRANSIT')
    expect(transit.map((c) => c.params.page)).toEqual([1, 2, 1, 2])
    expect(book.mode).toBe('partial')
    expect(book.statusTotals?.IN_TRANSIT).toBe(150)
    expect(book.openComplete).toBe(false)
  })

  it('refuses a swept page that holds a row of another status', async () => {
    const rows = makeOrders(HOUSE_A, 150, statusFor)
    install(rows)
    gw.before = (call) => {
      if (call.params.page === 2 && !call.params.status) return shifted(rows)
      if (call.params.status === 'IN_TRANSIT') {
        return { data: { orders: [rows[1]], total: 1, page: 1, limit: 100, hasMore: false } }
      }
      return undefined
    }
    await expect(fetchOrderBook(HOUSE_A, signal())).rejects.toThrow(
      /asked for IN_TRANSIT, got a COMPLETED row/,
    )
  })
})

describe('fetchOrderBook: 429', () => {
  const limitedAt = (page: number, times: number, retryAfter?: number) => {
    let left = times
    return (call: { params: Record<string, unknown> }) => {
      if (call.params.page === page && left > 0) {
        left--
        return {
          status: 429,
          data: { statusCode: 429, message: 'Too many', ...(retryAfter === undefined ? {} : { retryAfter }) },
        }
      }
      return undefined
    }
  }

  it('waits out a 429 at page 4 and resumes at page 4, not page 1', async () => {
    install(makeOrders(HOUSE_A, 525))
    gw.before = limitedAt(4, 1, 7)
    const onRateLimited = vi.fn()
    const book = await fetchOrderBook(HOUSE_A, signal(), { ...noWait, onRateLimited })

    expect(gw.listCalls().map((c) => c.params.page)).toEqual([1, 2, 3, 4, 4, 5, 6])
    expect(onRateLimited).toHaveBeenCalledWith(7000)
    expect(noWait.sleep).toHaveBeenCalledTimes(1)
    expect(noWait.sleep.mock.calls[0][0]).toBe(7000 + 0.5 * RATE_JITTER_MAX_MS)
    expect(book.mode).toBe('whole')
    expect(book.rows).toHaveLength(525)
    expect(book.requests).toBe(7)
  })

  it('spreads the wait over at most 30 s past retryAfter, and waits a whole window when the body names none', async () => {
    install(makeOrders(HOUSE_A, 10))
    gw.before = limitedAt(1, 1)
    await fetchOrderBook(HOUSE_A, signal(), { sleep: noWait.sleep, random: () => 0.9999 })
    const waited = noWait.sleep.mock.calls[0][0]
    expect(RATE_JITTER_MAX_MS).toBe(30_000)
    expect(waited).toBeGreaterThanOrEqual(RATE_WINDOW_MS)
    expect(waited).toBeLessThan(RATE_WINDOW_MS + 30_000)
  })

  it('waits no longer than one window when the body names a longer retryAfter', async () => {
    install(makeOrders(HOUSE_A, 10))
    // Past ~2.1M s, seconds * 1000 overflows setTimeout and fires at once.
    gw.before = limitedAt(1, 1, 3_000_000)
    const onRateLimited = vi.fn()
    const book = await fetchOrderBook(HOUSE_A, signal(), { ...noWait, onRateLimited })

    expect(onRateLimited).toHaveBeenCalledWith(RATE_WINDOW_MS)
    expect(noWait.sleep.mock.calls[0][0]).toBe(RATE_WINDOW_MS + 0.5 * RATE_JITTER_MAX_MS)
    expect(book.mode).toBe('whole')
  })

  it('gives up with RateLimitedError after the third 429 on one page', async () => {
    install(makeOrders(HOUSE_A, 10))
    gw.before = limitedAt(1, 3, 2)
    await expect(fetchOrderBook(HOUSE_A, signal(), noWait)).rejects.toBeInstanceOf(
      RateLimitedError,
    )
    expect(gw.listCalls()).toHaveLength(3)
  })
})

describe('fetchOrderBook: past the ceiling', () => {
  it('reads 30 pages of 3,001 orders, then sweeps the open statuses and counts the closed ones; with every status one it can name, it lists every open order', async () => {
    // The oldest order (#3000) is open and past page 30.
    const statusFor = (i: number): OrderWireStatus =>
      i === 3000 ? 'PARTIALLY_RECEIVED' : i % 500 === 0 ? 'DELIVERED' : 'COMPLETED'
    const rows = makeOrders(HOUSE_A, 3001, statusFor)
    install(rows)
    const book = await fetchOrderBook(HOUSE_A, signal())

    const plain = gw.listCalls().filter((c) => !c.params.status)
    expect(plain.map((c) => c.params.page)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    expect(book.mode).toBe('capped')
    expect(book.reason).toBe('ceiling')
    expect(book.total).toBe(3001)
    expect(book.nextClosedPage).toBe(31)
    expect(book.openComplete).toBe(true)
    const got = new Set(book.rows.map((r) => r.id))
    expect(got.has('o-03000')).toBe(true)
    const open = rows.filter((r) => isOpenOrderStatus(r.status))
    expect(open.every((r) => got.has(r.id))).toBe(true)
    expect(book.rows).toHaveLength(3000 - (open.length - 1) + open.length)
    expect(book.statusTotals?.COMPLETED).toBe(3001 - open.length)
    expect(book.statusTotals?.PARTIALLY_RECEIVED).toBe(1)
    expect(book.unclassifiedCount).toBe(0)
  })

  it('keeps a row of a status it cannot name from the first pages, and says the open set may not be complete', async () => {
    const rows = makeOrders(HOUSE_A, 3001, (i) =>
      i === 5 ? ('ON_HOLD' as OrderWireStatus) : 'COMPLETED',
    )
    install(rows)
    const book = await fetchOrderBook(HOUSE_A, signal())

    expect(book.mode).toBe('capped')
    expect(book.rows.find((r) => r.id === 'o-00005')?.status).toBe('ON_HOLD')
    expect(book.unclassifiedCount).toBe(1)
    expect(book.openComplete).toBe(false)
    expect(book.requests).toBe(42)
  })

  it('does not call the open set complete when the per-status counts add up to more than the total', async () => {
    // An order moved into COMPLETED between the sweeps and the counts is counted
    // twice; the surplus would cancel out the ON_HOLD row the sweeps cannot ask
    // for, and a floor at 0 would then read "nothing unclassified".
    const rows = makeOrders(HOUSE_A, 3001, (i) =>
      i === 5 ? ('ON_HOLD' as OrderWireStatus) : 'COMPLETED',
    )
    install(rows)
    const completed = rows.find((r) => r.status === 'COMPLETED')!
    gw.before = (call) =>
      call.params.status === 'COMPLETED' && call.params.limit === 1
        ? { data: { orders: [completed], total: 3002, page: 1, limit: 1, hasMore: true } }
        : undefined
    const book = await fetchOrderBook(HOUSE_A, signal())

    expect(book.mode).toBe('capped')
    expect(book.statusTotals?.COMPLETED).toBe(3002)
    expect(book.unclassifiedCount).toBe(0)
    expect(book.openComplete).toBe(false)
  })
})

describe('fetchOrderBookPage', () => {
  it('reads one page past the cap on /history at limit 100', async () => {
    install(makeOrders(HOUSE_A, 3001))
    const page = await fetchOrderBookPage(HOUSE_A, 31, signal())

    expect(gw.listCalls().map((c) => [c.url, c.params.page, c.params.limit])).toEqual([
      ['/procurement/orders/history', 31, 100],
    ])
    expect(page).toMatchObject({ page: 31, limit: 100, total: 3001, hasMore: false })
    expect(page.orders.map((r) => r.id)).toEqual(['o-03000'])
  })

  it('makes the same checks as a page of the book', async () => {
    const rows = makeOrders(HOUSE_A, 3001)
    rows[3000] = { ...rows[3000], restaurantId: HOUSE_B }
    install(rows)
    await expect(fetchOrderBookPage(HOUSE_A, 31, signal())).rejects.toBeInstanceOf(
      ForeignRowError,
    )
  })
})

describe('fetchOrderBook: page shape', () => {
  const page1 = (over: Record<string, unknown>) => (call: { params: Record<string, unknown> }) =>
    call.params.page === 1
      ? {
          data: {
            orders: makeOrders(HOUSE_A, 3),
            total: 3,
            page: 1,
            limit: 100,
            hasMore: false,
            ...over,
          },
        }
      : undefined

  it.each([
    ['a page number that is not the one asked for', { page: 2 }, /asked for page 1, got 2/],
    ['a limit that is not the one asked for', { limit: 50 }, /asked for 100 a page, got 50/],
    ['hasMore that disagrees with total', { hasMore: true }, /hasMore is true with 3 rows of 3/],
    ['hasMore that is not a boolean', { hasMore: 'false' }, /hasMore is not true or false/],
    ['a total that is a string', { total: '3' }, /total is not a count/],
    ['a negative total', { total: -1 }, /total is not a count/],
    ['a body with no orders list', { orders: undefined }, /orders is not a list/],
    [
      'an order twice on one page',
      { orders: [...makeOrders(HOUSE_A, 2), makeOrders(HOUSE_A, 1)[0]] },
      /appears twice on one page/,
    ],
    [
      'more rows than the limit, with a hasMore that agrees with total',
      { orders: makeOrders(HOUSE_A, 101), total: 101 },
      /101 rows on a page of 100/,
    ],
  ])('refuses %s, on the page that has it', async (_name, over, message) => {
    install([])
    gw.before = page1(over)
    const read = fetchOrderBook(HOUSE_A, signal())
    await expect(read).rejects.toBeInstanceOf(BookShapeError)
    await expect(read).rejects.toThrow(message)
    expect(gw.listCalls()).toHaveLength(1)
  })
})

describe('isOpenOrderStatus and markFor', () => {
  const received = (over: Partial<ShelfReceived>): ShelfReceived => ({
    readable: true,
    why: null,
    quantityInStockUom: 6,
    stockUom: 'bottle',
    packUnit: null,
    packSize: null,
    packs: null,
    looseInStockUom: null,
    words: '6 bottles',
    rejectedAtDoorBottles: 0,
    countedNotBookedBottles: 0,
    verifiedAt: '2026-10-02T10:00:00.000Z',
    orderedBottles: 12,
    backorderBottles: 6,
    ...over,
  })
  const pr = (r?: ShelfReceived) => ({ status: 'PARTIALLY_RECEIVED' as const, received: r })

  it('files COMPLETED, CANCELLED, REJECTED, FAILED and verified as closed; DELIVERED, PARTIALLY_RECEIVED and an unknown status as open', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'verified']) {
      expect(isOpenOrderStatus(s)).toBe(false)
    }
    for (const s of ['DELIVERED', 'PARTIALLY_RECEIVED', 'IN_TRANSIT', 'PENDING', 'SOMETHING_NEW']) {
      expect(isOpenOrderStatus(s)).toBe(true)
    }
    expect([...CLOSED_WIRE_STATUSES]).toEqual(['COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED'])
    expect(OPEN_WIRE_STATUSES).toHaveLength(8)
  })

  it('DELIVERED reads "Not counted yet"', () => {
    expect(markFor({ status: 'DELIVERED', received: undefined })).toEqual({
      kind: 'not_counted',
      text: 'Not counted yet',
    })
  })

  it('checked and short reads "Backorder: N bottles still owed"', () => {
    expect(markFor(pr(received({ backorderBottles: 6 })))).toEqual({
      kind: 'backorder',
      text: 'Backorder: 6 bottles still owed',
      bottlesOwed: 6,
    })
    expect(markFor(pr(received({ backorderBottles: 1 })))?.text).toBe(
      'Backorder: 1 bottle still owed',
    )
  })

  it('never checked reads "Counted, not checked yet", even with bottles owed', () => {
    expect(markFor(pr(received({ verifiedAt: null, backorderBottles: 6 })))).toEqual({
      kind: 'counted_not_checked',
      text: 'Counted, not checked yet',
    })
  })

  it('checked in full reads "Waiting on the invoice"', () => {
    expect(markFor(pr(received({ backorderBottles: 0 })))).toEqual({
      kind: 'awaiting_invoice',
      text: 'Waiting on the invoice',
    })
  })

  it('an unreadable, absent or undecidable receipt reads "Receipt could not be read"', () => {
    const unreadable = { kind: 'receipt_unreadable', text: 'Receipt could not be read' }
    expect(markFor(pr(received({ readable: false, why: 'ledger' })))).toEqual(unreadable)
    expect(markFor(pr(undefined))).toEqual(unreadable)
    expect(markFor(pr(received({ verifiedAt: undefined })))).toEqual(unreadable)
    expect(markFor(pr(received({ backorderBottles: null })))).toEqual(unreadable)
  })

  it('marks nothing else', () => {
    for (const s of ['IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'PENDING'] as const) {
      expect(markFor({ status: s, received: undefined })).toBeNull()
    }
  })
})

describe('fetchOrderById', () => {
  it('reads an order of this house', async () => {
    install(makeOrders(HOUSE_A, 3))
    const result = await fetchOrderById(HOUSE_A, 'o-00001', signal())
    expect(result).toMatchObject({ state: 'read', order: { id: 'o-00001' } })
    expect(gw.calls[0].url).toBe('/procurement/orders/o-00001')
  })

  it.each([
    ['a 500 (how the gateway says not found)', () => install([])],
    ['a 404', () => { install(makeOrders(HOUSE_A, 1)); gw.before = () => ({ status: 404 }) }],
    ['a 403', () => { install(makeOrders(HOUSE_A, 1)); gw.before = () => ({ status: 403 }) }],
    ['a 429', () => { install(makeOrders(HOUSE_A, 1)); gw.before = () => ({ status: 429, data: { retryAfter: 5 } }) }],
    [
      'a network failure with no response',
      () => {
        install(makeOrders(HOUSE_A, 1))
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Network Error'))
      },
    ],
    [
      'a row of another house',
      () => install(makeOrders(HOUSE_A, 1).map((r) => ({ ...r, restaurantId: HOUSE_B }))),
    ],
    ['an empty body', () => { install(makeOrders(HOUSE_A, 1)); gw.before = () => ({ data: null }) }],
    [
      'a row whose id is not the one asked for',
      () => {
        install(makeOrders(HOUSE_A, 2))
        gw.before = () => ({ data: makeOrders(HOUSE_A, 2)[1] })
      },
    ],
    [
      'a token for another house',
      () => {
        install(makeOrders(HOUSE_A, 1))
        signInAs(HOUSE_B)
      },
    ],
  ])('reads %s as unreadable, never as missing', async (_name, arrange) => {
    arrange()
    await expect(fetchOrderById(HOUSE_A, 'o-00000', signal())).resolves.toEqual({
      state: 'unreadable',
    })
  })

  it('reads as unreadable when the token changes to another house during the GET (only the check after the GET sees it)', async () => {
    install(makeOrders(HOUSE_A, 1))
    gw.before = () => {
      signInAs(HOUSE_B)
      return undefined
    }
    await expect(fetchOrderById(HOUSE_A, 'o-00000', signal())).resolves.toEqual({
      state: 'unreadable',
    })
    // The GET went out under house A, and the fake answered house A's own row.
    expect(gw.calls).toHaveLength(1)
    expect(gw.calls[0].house).toBe(HOUSE_A)
  })

  it('asks nothing when the token already names another house', async () => {
    install(makeOrders(HOUSE_A, 1))
    signInAs(HOUSE_B)
    await expect(fetchOrderById(HOUSE_A, 'o-00000', signal())).resolves.toEqual({
      state: 'unreadable',
    })
    expect(gw.calls).toHaveLength(0)
  })
})
