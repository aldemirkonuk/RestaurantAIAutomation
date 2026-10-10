/**
 * F-905 (re-hit of F-140): /vendors counted "open orders" over `getOrders()`,
 * which is the gateway's first page — the newest 50. The count is now the
 * gateway's, over the whole book, in one call: `getOpenOrderCountsByProvider`
 * asks for it and never turns a failed or shapeless answer into zeros.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getOpenOrderCountsByProvider } from './orders'
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

describe('getOpenOrderCountsByProvider', () => {
  beforeEach(() => http.get.mockReset())

  it("asks the gateway once for the house's counts and returns them", async () => {
    http.get.mockResolvedValueOnce({ data: { counts: { a: 3, b: 1 } } })
    await expect(getOpenOrderCountsByProvider('rest-1')).resolves.toEqual({ a: 3, b: 1 })
    expect(http.get).toHaveBeenCalledTimes(1)
    expect(http.get.mock.calls[0][0]).toBe('/procurement/orders/open/by-provider')
  })

  it('keeps an empty answer as a real "nothing open"', async () => {
    http.get.mockResolvedValueOnce({ data: { counts: {} } })
    await expect(getOpenOrderCountsByProvider('rest-1')).resolves.toEqual({})
  })

  it('rejects a failed read rather than answer zeros', async () => {
    http.get.mockRejectedValueOnce(new Error('503'))
    await expect(getOpenOrderCountsByProvider('rest-1')).rejects.toThrow()
  })

  it('rejects an answer without counts rather than answer zeros', async () => {
    http.get.mockResolvedValueOnce({ data: {} })
    await expect(getOpenOrderCountsByProvider('rest-1')).rejects.toThrow()
  })
})
