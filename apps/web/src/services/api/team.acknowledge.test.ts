/**
 * "I have seen it" resolves only when the receipt was stored (QA round 4, B3).
 *
 * The gateway answered 200 `{ acknowledged: false }` for a caller with no
 * roster row, and the page's `onSuccess` took any 200 as done: the person
 * believed they had confirmed and the manager's "seen" count never moved. The
 * gateway now refuses that case outright; this keeps the page honest against
 * a gateway that still answers the old way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { acknowledgeSchedule } from './team'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    getActiveRestaurantId: () => 'r-alpha',
  }
})

const http = vi.mocked(apiClient) as unknown as { post: ReturnType<typeof vi.fn> }

describe('acknowledgeSchedule', () => {
  beforeEach(() => http.post.mockReset())

  it('rejects a 200 that says the receipt was not stored', async () => {
    http.post.mockResolvedValue({ data: { acknowledged: false } })
    await expect(acknowledgeSchedule('s1')).rejects.toThrow(/not recorded/)
  })

  it('rejects an answer that does not say acknowledged at all', async () => {
    http.post.mockResolvedValue({ data: {} })
    await expect(acknowledgeSchedule('s1')).rejects.toThrow(/not recorded/)
  })

  it('resolves when the gateway stored the receipt', async () => {
    http.post.mockResolvedValue({ data: { acknowledged: true } })
    await expect(acknowledgeSchedule('s1')).resolves.toEqual({ acknowledged: true })
  })
})
