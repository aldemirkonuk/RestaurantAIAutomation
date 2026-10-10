/**
 * F-905 (re-hit of F-140): /vendors counted "open orders" over `getOrders()`,
 * which is the gateway's first page — the newest 50. `getEveryOrder` reads the
 * book to its end so a per-vendor count covers every order, and refuses to
 * hand back a part when the book is past its ceiling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEveryOrder } from './orders'
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
  Array.from({ length: n }, (_, i) => ({ id: `o${from + i}`, providerId: 'a', status: 'pending' }))

describe('getEveryOrder', () => {
  beforeEach(() => http.get.mockReset())

  it('reads past the first page to the end of the book', async () => {
    http.get
      .mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 230 } })
      .mockResolvedValueOnce({ data: { orders: rows(100, 100), total: 230 } })
      .mockResolvedValueOnce({ data: { orders: rows(200, 30), total: 230 } })
    const all = await getEveryOrder('rest-1')
    expect(all).toHaveLength(230)
    expect(http.get).toHaveBeenCalledTimes(3)
    expect(http.get.mock.calls[2][1]).toEqual({ params: { page: 3, limit: 100 } })
  })

  it('keeps an order once when a new one shifts the pages mid-read', async () => {
    http.get
      .mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 150 } })
      .mockResolvedValueOnce({ data: { orders: rows(99, 51), total: 150 } })
    const all = await getEveryOrder('rest-1')
    expect(all).toHaveLength(150)
  })

  it('stops on a total that falls exactly on a page edge', async () => {
    http.get.mockResolvedValueOnce({ data: { orders: rows(0, 100), total: 100 } })
    const all = await getEveryOrder('rest-1')
    expect(all).toHaveLength(100)
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  it('carries the staff money marker onto every row', async () => {
    http.get.mockResolvedValueOnce({ data: { orders: rows(0, 2), total: 2, amountsWithheld: true } })
    const all = await getEveryOrder('rest-1')
    expect(all.every((o) => o.amountsWithheld === true)).toBe(true)
  })

  it('refuses rather than hand back part of a book past its ceiling', async () => {
    let n = 0
    http.get.mockImplementation(async () => {
      const page = rows(n, 100)
      n += 100
      return { data: { orders: page } }
    })
    await expect(getEveryOrder('rest-1')).rejects.toThrow(/too long/)
  })
})
