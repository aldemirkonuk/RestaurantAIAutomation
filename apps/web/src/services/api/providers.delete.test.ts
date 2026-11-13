/**
 * `deleteProvider` reads what the removal did (r27). #1337's gateway answers
 * `{ success, standingOrdersPaused, schedulesPaused, openOrders, message }`;
 * an older gateway answers `{ success: true }` alone, and the toast must still
 * say something true rather than nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deleteProvider } from './providers'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  }
})

const del = apiClient.delete as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('deleteProvider', () => {
  it('passes the gateway outcome through, sentence verbatim', async () => {
    del.mockResolvedValue({
      data: { success: true, standingOrdersPaused: 2, schedulesPaused: 0, openOrders: 1, message: 'Said by the gateway.' },
    })
    await expect(deleteProvider('p-1')).resolves.toEqual({
      success: true,
      standingOrdersPaused: 2,
      schedulesPaused: 0,
      openOrders: 1,
      message: 'Said by the gateway.',
    })
    expect(del).toHaveBeenCalledWith('/providers/p-1')
  })

  it('keeps a failed count as unknown (null), never zero', async () => {
    del.mockResolvedValue({
      data: { success: true, standingOrdersPaused: null, schedulesPaused: 0, openOrders: null, message: 'x' },
    })
    const r = await deleteProvider('p-1')
    expect(r.standingOrdersPaused).toBeNull()
    expect(r.openOrders).toBeNull()
  })

  it('an older gateway ({ success: true } alone) still yields a true sentence', async () => {
    del.mockResolvedValue({ data: { success: true } })
    const r = await deleteProvider('p-1')
    expect(r.message).toBe('The vendor was removed. No new order can be placed with them.')
    expect(r.openOrders).toBeNull()
  })
})
