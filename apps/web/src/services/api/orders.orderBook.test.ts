/**
 * F-1132 (rehit of F-117): /orders counted its stages and summed "<Month> so
 * far" over `getOrders()`, which is the gateway's first page — the newest 50.
 * `useOrders` now reads `getOrderBook`, which asks page after page until the
 * gateway says there is no more, so the figures are the whole book's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOrderBook } from './orders'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    getActiveRestaurantId: () => 'rest-1',
  }
})

const http = vi.mocked(apiClient) as unknown as { get: ReturnType<typeof vi.fn> }

const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `o-${from + i}`, status: 'pending' }))

describe('getOrderBook — the whole book, not the newest page', () => {
  beforeEach(() => http.get.mockReset())

  it('reads every page the gateway has, at its page ceiling', async () => {
    http.get
      .mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 230, hasMore: true } })
      .mockResolvedValueOnce({ data: { orders: rows(100, 100), total: 230, hasMore: true } })
      .mockResolvedValueOnce({ data: { orders: rows(200, 30), total: 230, hasMore: false } })
    const book = await getOrderBook(undefined, 'rest-1')
    expect(book).toHaveLength(230)
    expect(http.get).toHaveBeenCalledTimes(3)
    expect(http.get.mock.calls.map((c) => c[1].params)).toEqual([
      { page: 1, limit: 100 },
      { page: 2, limit: 100 },
      { page: 3, limit: 100 },
    ])
  })

  it('stops at the total the first answer stated, even if the gateway keeps saying there is more', async () => {
    http.get.mockResolvedValue({ data: { orders: rows(0, 100), total: 150, hasMore: true } })
    await getOrderBook(undefined, 'rest-1')
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('counts an order that slid onto the next page while it was read once', async () => {
    http.get
      .mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 101, hasMore: true } })
      .mockResolvedValueOnce({ data: { orders: rows(99, 2), total: 101, hasMore: false } })
    await expect(getOrderBook(undefined, 'rest-1')).resolves.toHaveLength(101)
  })

  it('keeps the staff marker on every row of every page (F-441)', async () => {
    http.get
      .mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 101, hasMore: true, amountsWithheld: true } })
      .mockResolvedValueOnce({ data: { orders: rows(100, 1), total: 101, hasMore: false, amountsWithheld: true } })
    const book = await getOrderBook(undefined, 'rest-1')
    expect(book.every((o) => o.amountsWithheld === true)).toBe(true)
  })

  it('fails the whole read when a later page fails, rather than answer part of the book', async () => {
    http.get
      .mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 150, hasMore: true } })
      .mockRejectedValueOnce(new Error('503'))
    await expect(getOrderBook(undefined, 'rest-1')).rejects.toThrow()
  })
})
